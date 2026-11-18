package fm

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"encoding/hex"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"sync"
	"time"

	"github.com/pkg/sftp"
)

// Job describes a transfer for the UI.
type Job struct {
	ID        string  `json:"id"`
	Title     string  `json:"title"`
	Kind      string  `json:"kind"`  // "" (copy/move) | sync
	State     string  `json:"state"` // queued | planning | running | done | error | canceled
	Total     int64   `json:"total"`
	Done      int64   `json:"done"`
	Files     int     `json:"files"`
	FilesDone int     `json:"filesDone"`
	Current   string  `json:"current"`
	Error     string  `json:"error"`
	Speed     float64 `json:"speed"`
	Move      bool    `json:"move"`
	SrcFS     string  `json:"srcFs"`
	DstFS     string  `json:"dstFs"`
	DstDir    string  `json:"dstDir"`
	StartedAt int64   `json:"startedAt"`
	EndedAt   int64   `json:"endedAt"`
	// Resumable is true for a job moving exactly one file end to end, the
	// only shape that can be safely continued after an error or restart.
	Resumable bool   `json:"resumable"`
	SrcPath   string `json:"srcPath"`
	DstPath   string `json:"dstPath"`
}

type job struct {
	mu sync.Mutex
	Job
	cancel     context.CancelFunc
	lastEmit   time.Time
	speedAt    time.Time
	speedBytes int64
}

func (j *job) snap() Job {
	j.mu.Lock()
	defer j.mu.Unlock()
	return j.Job
}

// Manager owns registered file systems and the transfer queue.
type Manager struct {
	mu       sync.Mutex
	fss      map[string]FS
	jobs     map[string]*job
	order    []string
	sem      chan struct{}
	OnUpdate func(Job)
}

// NewManager creates a manager with the local disk registered.
func NewManager() *Manager {
	m := &Manager{
		fss:  map[string]FS{},
		jobs: map[string]*job{},
		sem:  make(chan struct{}, 2),
	}
	m.fss["local"] = LocalFS{}
	return m
}

func newID() string {
	b := make([]byte, 8)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

// Register adds a file system.
func (m *Manager) Register(f FS) {
	m.mu.Lock()
	m.fss[f.ID()] = f
	m.mu.Unlock()
}

// Unregister removes a file system.
func (m *Manager) Unregister(id string) {
	m.mu.Lock()
	delete(m.fss, id)
	m.mu.Unlock()
}

// Get returns a registered file system.
func (m *Manager) Get(id string) (FS, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	f, ok := m.fss[id]
	if !ok {
		return nil, errors.New("connection is closed, reconnect and try again")
	}
	return f, nil
}

func (m *Manager) emit(j *job) {
	if m.OnUpdate != nil {
		m.OnUpdate(j.snap())
	}
}

func (j *job) add(m *Manager, n int64) {
	j.mu.Lock()
	j.Done += n
	now := time.Now()
	emit := now.Sub(j.lastEmit) > 150*time.Millisecond
	if emit {
		dt := now.Sub(j.speedAt).Seconds()
		if dt > 0 {
			inst := float64(j.Done-j.speedBytes) / dt
			if j.Speed == 0 {
				j.Speed = inst
			} else {
				j.Speed = 0.6*j.Speed + 0.4*inst
			}
		}
		j.speedAt = now
		j.speedBytes = j.Done
		j.lastEmit = now
	}
	snap := j.Job
	j.mu.Unlock()
	if emit && m.OnUpdate != nil {
		m.OnUpdate(snap)
	}
}

func (j *job) setCurrent(name string) {
	j.mu.Lock()
	j.Current = name
	j.mu.Unlock()
}

func (j *job) fileDone(n int) {
	j.mu.Lock()
	j.FilesDone += n
	j.mu.Unlock()
}

// Start queues a transfer and returns the job ID.
// conflict is one of: overwrite | skip | rename.
func (m *Manager) Start(srcID, dstID string, paths []string, dstDir string, move bool, conflict string) (string, error) {
	src, err := m.Get(srcID)
	if err != nil {
		return "", err
	}
	dst, err := m.Get(dstID)
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", errors.New("nothing selected")
	}
	if conflict != "skip" && conflict != "rename" {
		conflict = "overwrite"
	}
	verb := "Copy"
	if move {
		verb = "Move"
	}
	title := fmt.Sprintf("%s %d items", verb, len(paths))
	if len(paths) == 1 {
		title = fmt.Sprintf("%s %s", verb, path.Base(paths[0]))
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{cancel: cancel}
	j.Job = Job{
		ID: newID(), Title: title, State: "queued", Move: move,
		SrcFS: srcID, DstFS: dstID, DstDir: dstDir,
		StartedAt: time.Now().UnixMilli(),
	}
	m.mu.Lock()
	m.jobs[j.ID] = j
	m.order = append(m.order, j.ID)
	m.mu.Unlock()
	m.emit(j)

	go func() {
		select {
		case m.sem <- struct{}{}:
		case <-ctx.Done():
			m.finish(j, context.Canceled)
			return
		}
		defer func() { <-m.sem }()
		j.mu.Lock()
		j.State = "planning"
		j.speedAt = time.Now()
		j.mu.Unlock()
		m.emit(j)
		err := m.run(ctx, j, src, dst, paths, dstDir, move, conflict)
		m.finish(j, err)
	}()
	return j.ID, nil
}

func (m *Manager) finish(j *job, err error) {
	j.mu.Lock()
	switch {
	case err == nil:
		j.State = "done"
		j.Done = j.Total
	case errors.Is(err, context.Canceled):
		j.State = "canceled"
	default:
		j.State = "error"
		j.Error = err.Error()
	}
	j.Current = ""
	j.Speed = 0
	j.EndedAt = time.Now().UnixMilli()
	j.mu.Unlock()
	m.emit(j)
}

// Cancel stops a queued or running job.
func (m *Manager) Cancel(id string) {
	m.mu.Lock()
	j := m.jobs[id]
	m.mu.Unlock()
	if j != nil {
		j.cancel()
	}
}

// List returns all known jobs, oldest first.
func (m *Manager) List() []Job {
	m.mu.Lock()
	defer m.mu.Unlock()
	out := make([]Job, 0, len(m.order))
	for _, id := range m.order {
		if j, ok := m.jobs[id]; ok {
			out = append(out, j.snap())
		}
	}
	return out
}

// ClearFinished forgets completed jobs.
func (m *Manager) ClearFinished() {
	m.mu.Lock()
	defer m.mu.Unlock()
	keep := m.order[:0]
	for _, id := range m.order {
		j := m.jobs[id]
		if j == nil {
			continue
		}
		s := j.snap().State
		if s == "done" || s == "error" || s == "canceled" {
			delete(m.jobs, id)
			continue
		}
		keep = append(keep, id)
	}
	m.order = keep
}

// ---------------------------------------------------------------- engine

func (m *Manager) plan(ctx context.Context, f FS, paths []string) (sizes []int64, counts []int, err error) {
	var walk func(e Entry, top bool) (int64, int, error)
	walk = func(e Entry, top bool) (int64, int, error) {
		if err := ctx.Err(); err != nil {
			return 0, 0, err
		}
		if e.IsLink && e.IsDir && !top {
			return 0, 0, nil
		}
		if !e.IsDir {
			return e.Size, 1, nil
		}
		kids, err := f.List(e.Path)
		if err != nil {
			return 0, 0, err
		}
		var size int64
		var cnt int
		for _, k := range kids {
			s, c, err := walk(k, false)
			if err != nil {
				return 0, 0, err
			}
			size += s
			cnt += c
		}
		return size, cnt, nil
	}
	for _, p := range paths {
		e, err := f.Stat(p)
		if err != nil {
			return nil, nil, err
		}
		s, c, err := walk(e, true)
		if err != nil {
			return nil, nil, err
		}
		sizes = append(sizes, s)
		counts = append(counts, c)
	}
	return sizes, counts, nil
}

func (m *Manager) run(ctx context.Context, j *job, src, dst FS, paths []string, dstDir string, move bool, policy string) error {
	sizes, counts, err := m.plan(ctx, src, paths)
	if err != nil {
		return err
	}
	var total int64
	var files int
	for i := range sizes {
		total += sizes[i]
		files += counts[i]
	}
	j.mu.Lock()
	j.Total, j.Files, j.State = total, files, "running"
	j.mu.Unlock()
	m.emit(j)

	if err := dst.Mkdir(dstDir); err != nil {
		return err
	}
	for i, p := range paths {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := m.transferTop(ctx, j, src, dst, p, dstDir, move, policy, sizes[i], counts[i], len(paths) == 1); err != nil {
			return err
		}
	}
	return nil
}

func suffixed(p string, n int, isDir bool) string {
	dir, base := path.Split(p)
	if isDir {
		return fmt.Sprintf("%s%s (%d)", dir, base, n)
	}
	ext := path.Ext(base)
	stem := strings.TrimSuffix(base, ext)
	return fmt.Sprintf("%s%s (%d)%s", dir, stem, n, ext)
}

// resolveTarget applies the conflict policy to a top-level item.
func resolveTarget(dst FS, target, policy string, isDir bool) (string, bool) {
	if _, err := dst.Stat(target); err != nil {
		return target, false
	}
	switch policy {
	case "skip":
		if isDir {
			return target, false // directories merge
		}
		return target, true
	case "rename":
		for n := 1; n < 10000; n++ {
			cand := suffixed(target, n, isDir)
			if _, err := dst.Stat(cand); err != nil {
				return cand, false
			}
		}
	}
	return target, false
}

func (m *Manager) transferTop(ctx context.Context, j *job, src, dst FS, sp, dstDir string, move bool, policy string, itemSize int64, itemFiles int, singleItem bool) error {
	ent, err := src.Stat(sp)
	if err != nil {
		return err
	}
	target := dst.Join(dstDir, ent.Name)
	same := src.ID() == dst.ID()
	if same && ent.IsDir && (target == ent.Path || strings.HasPrefix(dstDir+"/", ent.Path+"/")) {
		return fmt.Errorf("cannot copy folder %q into itself", ent.Name)
	}
	if same && target == ent.Path && policy != "rename" {
		return fmt.Errorf("%q: source and destination are the same", ent.Name)
	}
	final, skip := resolveTarget(dst, target, policy, ent.IsDir)
	if skip {
		j.add(m, itemSize)
		j.fileDone(itemFiles)
		return nil
	}
	// Merge an existing directory under Skip, even on one file system. A
	// server-side rename could replace the whole directory without checking
	// individual names.
	if move && same && policy != "skip" {
		if err := src.Rename(ent.Path, final); err == nil {
			j.add(m, itemSize)
			j.fileDone(itemFiles)
			return nil
		}
	}
	if singleItem && !ent.IsDir && !ent.IsLink {
		j.mu.Lock()
		j.Resumable = true
		j.mu.Unlock()
	}
	_, err = m.transferEntry(ctx, j, src, dst, ent, final, policy, true, move)
	return err
}

// transferEntry returns true when it handled every source entry. Move removes
// each file only after that file has been copied. Skipped entries leave their
// parent intact, and directory cleanup never recursively deletes new entries.
func (m *Manager) transferEntry(ctx context.Context, j *job, src, dst FS, ent Entry, target, policy string, top, move bool) (bool, error) {
	if err := ctx.Err(); err != nil {
		return false, err
	}
	if ent.IsDir {
		if ent.IsLink && !top {
			return false, nil
		}
		if err := dst.Mkdir(target); err != nil {
			return false, err
		}
		kids, err := src.List(ent.Path)
		if err != nil {
			return false, err
		}
		complete := true
		for _, k := range kids {
			copied, err := m.transferEntry(ctx, j, src, dst, k, dst.Join(target, k.Name), policy, false, move && !ent.IsLink)
			if err != nil {
				return false, err
			}
			complete = complete && copied
		}
		if move && complete {
			if ent.IsLink {
				return true, src.Remove(ent.Path)
			}
			return true, src.RemoveEmptyDir(ent.Path)
		}
		return complete, nil
	}
	if !top && policy == "skip" {
		if _, err := dst.Stat(target); err == nil {
			j.add(m, ent.Size)
			j.fileDone(1)
			return false, nil
		}
	}
	if err := m.copyFile(ctx, j, src, dst, ent, target); err != nil {
		return false, err
	}
	if move {
		return true, src.Remove(ent.Path)
	}
	return true, nil
}

func (m *Manager) copyFile(ctx context.Context, j *job, src, dst FS, ent Entry, target string) error {
	j.setCurrent(ent.Name)
	j.mu.Lock()
	resumable := j.Resumable
	if resumable {
		j.SrcPath, j.DstPath = ent.Path, target
	}
	j.mu.Unlock()
	r, err := src.Open(ent.Path)
	if err != nil {
		return err
	}
	defer r.Close()
	w, err := dst.Create(target)
	if err != nil {
		return err
	}
	err = copyStream(ctx, w, r, func(n int64) { j.add(m, n) })
	cerr := w.Close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		// A resumable (single-file) job keeps its partial output on disk so
		// Resume/ResumeFromRecord can continue it instead of starting over.
		if !resumable {
			_ = dst.Remove(target)
		}
		return err
	}
	if ent.Mode != 0 {
		_ = dst.Chmod(target, os.FileMode(ent.Mode))
	}
	j.fileDone(1)
	return nil
}

// ResumeRecord carries enough information to continue a transfer whose
// in-memory Job no longer exists (e.g. after an app restart).
type ResumeRecord struct {
	Title     string
	SrcPath   string
	DstPath   string
	BytesDone int64
	Total     int64
	Move      bool
}

// ResumeFromRecord re-creates a job from a persisted record, used when the
// app restarted and the original in-memory Job is gone.
func (m *Manager) ResumeFromRecord(srcID, dstID string, rec ResumeRecord) (string, error) {
	return m.startResume(srcID, dstID, rec)
}

func (m *Manager) startResume(srcID, dstID string, prev ResumeRecord) (string, error) {
	src, err := m.Get(srcID)
	if err != nil {
		return "", err
	}
	dst, err := m.Get(dstID)
	if err != nil {
		return "", err
	}
	ent, err := src.Stat(prev.SrcPath)
	if err != nil {
		return "", err
	}
	if ent.IsDir || ent.IsLink || (src.ID() == dst.ID() && src.Join(prev.SrcPath) == dst.Join(prev.DstPath)) {
		return "", errors.New("resume requires distinct regular source and destination files")
	}
	// A replaced or resized destination cannot identify the saved prefix.
	// Reject it rather than overwriting a file that may belong to the user.
	startAt := prev.BytesDone
	if fi, err := dst.Stat(prev.DstPath); err == nil {
		if fi.IsDir || fi.IsLink || fi.Size != startAt {
			return "", errors.New("the partial destination changed; start a new transfer")
		}
	} else if errors.Is(err, os.ErrNotExist) {
		startAt = 0
	} else {
		return "", err
	}
	if startAt < 0 || startAt > ent.Size || (prev.Total > 0 && ent.Size != prev.Total) {
		return "", errors.New("the source changed; start a new transfer")
	}

	ctx, cancel := context.WithCancel(context.Background())
	j := &job{cancel: cancel}
	j.Job = Job{
		ID: newID(), Title: prev.Title, State: "queued", Move: prev.Move,
		SrcFS: srcID, DstFS: dstID, Resumable: true,
		SrcPath: prev.SrcPath, DstPath: prev.DstPath,
		Total: ent.Size, Done: startAt, Files: 1,
		StartedAt: time.Now().UnixMilli(),
	}
	j.speedBytes = startAt
	m.mu.Lock()
	m.jobs[j.ID] = j
	m.order = append(m.order, j.ID)
	m.mu.Unlock()
	m.emit(j)

	go func() {
		select {
		case m.sem <- struct{}{}:
		case <-ctx.Done():
			m.finish(j, context.Canceled)
			return
		}
		defer func() { <-m.sem }()
		j.mu.Lock()
		j.State = "running"
		j.speedAt = time.Now()
		j.mu.Unlock()
		m.emit(j)
		err := m.resumeCopy(ctx, j, src, dst, ent, startAt)
		m.finish(j, err)
	}()
	return j.ID, nil
}

func (m *Manager) resumeCopy(ctx context.Context, j *job, src, dst FS, ent Entry, startAt int64) error {
	target := j.snap().DstPath
	j.setCurrent(ent.Name)
	if startAt > 0 {
		// Confirm that an existing prefix belongs to this source before
		// modifying the destination, including for a resumed copy.
		if err := verifyTransfer(ctx, src, dst, ent.Path, target, startAt); err != nil {
			return err
		}
	}
	r, err := src.OpenAt(ent.Path, startAt)
	if err != nil {
		return err
	}
	w, err := dst.CreateAt(target, startAt)
	if err != nil {
		_ = r.Close()
		return err
	}
	err = copyStream(ctx, w, r, func(n int64) { j.add(m, n) })
	rerr := r.Close()
	cerr := w.Close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		return err // keep the partial file on disk so it can be resumed again
	}
	if rerr != nil {
		return rerr
	}
	if j.snap().Move {
		// Offsets and sizes alone cannot prove that the partial file was
		// written from this source. Check the entire result before removing it.
		if err := verifyTransfer(ctx, src, dst, ent.Path, target, -1); err != nil {
			return err
		}
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := src.Remove(ent.Path); err != nil {
			return err
		}
	}
	if ent.Mode != 0 {
		_ = dst.Chmod(target, os.FileMode(ent.Mode))
	}
	j.fileDone(1)
	return nil
}

// verifyTransfer compares either the saved prefix or the entire files before
// the move can remove its source. Read each endpoint in turn, so checks also
// work with protocols that allow only one pending file operation.
func verifyTransfer(ctx context.Context, src, dst FS, source, target string, limit int64) error {
	sourceSum, err := transferDigest(ctx, src, source, limit)
	if err != nil {
		return err
	}
	targetSum, err := transferDigest(ctx, dst, target, limit)
	if err != nil {
		return err
	}
	if sourceSum != targetSum {
		return errors.New("the destination differs from the source; the source was kept")
	}
	return nil
}

func transferDigest(ctx context.Context, fs FS, filePath string, limit int64) (string, error) {
	input, err := fs.Open(filePath)
	if err != nil {
		return "", err
	}
	defer input.Close()
	hash := sha256.New()
	reader := &countReader{r: input, ctx: ctx}
	if limit >= 0 {
		_, err = io.CopyN(hash, reader, limit)
	} else {
		_, err = io.Copy(hash, reader)
	}
	if err != nil {
		return "", err
	}
	return hex.EncodeToString(hash.Sum(nil)), nil
}

type countReader struct {
	r   io.Reader
	ctx context.Context
	fn  func(int64)
}

func (c *countReader) Read(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := c.r.Read(p)
	if n > 0 && c.fn != nil {
		c.fn(int64(n))
	}
	return n, err
}

type countWriter struct {
	w   io.Writer
	ctx context.Context
	fn  func(int64)
}

func (c *countWriter) Write(p []byte) (int, error) {
	if err := c.ctx.Err(); err != nil {
		return 0, err
	}
	n, err := c.w.Write(p)
	if n > 0 {
		c.fn(int64(n))
	}
	return n, err
}

func copyStream(ctx context.Context, dst io.Writer, src io.Reader, fn func(int64)) error {
	// Downloads: let pkg/sftp read ahead concurrently.
	if sf, ok := src.(*sftp.File); ok {
		_, err := sf.WriteTo(&countWriter{w: dst, ctx: ctx, fn: fn})
		return err
	}
	// Uploads: let pkg/sftp pipeline the writes.
	if df, ok := dst.(*sftp.File); ok {
		_, err := df.ReadFrom(&countReader{r: src, ctx: ctx, fn: fn})
		return err
	}
	buf := make([]byte, 256*1024)
	_, err := io.CopyBuffer(dst, &countReader{r: src, ctx: ctx, fn: fn}, buf)
	return err
}
