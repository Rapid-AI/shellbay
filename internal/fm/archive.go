package fm

import (
	"archive/zip"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"
)

// StartArchive queues a job that zips the given paths (files and/or
// directories, walked recursively) into a single destZip on the same file
// system, reusing the transfer queue's job/progress/cancel machinery so the
// existing Transfers UI needs no changes to show it.
func (m *Manager) StartArchive(fsID string, paths []string, destZip string) (string, error) {
	f, err := m.Get(fsID)
	if err != nil {
		return "", err
	}
	if len(paths) == 0 {
		return "", errors.New("nothing selected")
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{cancel: cancel}
	j.Job = Job{
		ID: newID(), Title: fmt.Sprintf("Archive: %s", path.Base(destZip)), Kind: "archive", State: "queued",
		SrcFS: fsID, DstFS: fsID, DstDir: path.Dir(destZip),
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
		m.finish(j, m.runArchive(ctx, j, f, paths, destZip))
	}()
	return j.ID, nil
}

func (m *Manager) runArchive(ctx context.Context, j *job, f FS, paths []string, destZip string) error {
	sizes, counts, err := m.plan(ctx, f, paths)
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

	w, err := f.Create(destZip)
	if err != nil {
		return err
	}
	zw := zip.NewWriter(w)
	finish := func(err error) error {
		if cerr := zw.Close(); err == nil {
			err = cerr
		}
		if cerr := w.Close(); err == nil {
			err = cerr
		}
		return err
	}
	for _, p := range paths {
		if err := ctx.Err(); err != nil {
			return finish(err)
		}
		e, err := f.Stat(p)
		if err != nil {
			return finish(err)
		}
		if err := m.zipAdd(ctx, j, f, zw, e, e.Name); err != nil {
			return finish(err)
		}
	}
	return finish(nil)
}

func (m *Manager) zipAdd(ctx context.Context, j *job, f FS, zw *zip.Writer, e Entry, rel string) error {
	if err := ctx.Err(); err != nil {
		return err
	}
	if e.IsDir {
		if e.IsLink {
			return nil
		}
		kids, err := f.List(e.Path)
		if err != nil {
			return err
		}
		for _, k := range kids {
			if err := m.zipAdd(ctx, j, f, zw, k, path.Join(rel, k.Name)); err != nil {
				return err
			}
		}
		return nil
	}
	j.setCurrent(e.Name)
	hdr := &zip.FileHeader{Name: rel, Method: zip.Deflate}
	hdr.Modified = time.UnixMilli(e.ModTime)
	zf, err := zw.CreateHeader(hdr)
	if err != nil {
		return err
	}
	r, err := f.Open(e.Path)
	if err != nil {
		return err
	}
	defer r.Close()
	if err := copyStream(ctx, zf, r, func(n int64) { j.add(m, n) }); err != nil {
		return err
	}
	j.fileDone(1)
	return nil
}

// StartExtract queues a job that unzips zipPath into destDir on the same
// file system.
func (m *Manager) StartExtract(fsID, zipPath, destDir string) (string, error) {
	f, err := m.Get(fsID)
	if err != nil {
		return "", err
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{cancel: cancel}
	j.Job = Job{
		ID: newID(), Title: fmt.Sprintf("Extract: %s", path.Base(zipPath)), Kind: "extract", State: "queued",
		SrcFS: fsID, DstFS: fsID, DstDir: destDir,
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
		m.finish(j, m.runExtract(ctx, j, f, zipPath, destDir))
	}()
	return j.ID, nil
}

func (m *Manager) runExtract(ctx context.Context, j *job, f FS, zipPath, destDir string) error {
	ra, size, cleanup, err := openZipReaderAt(f, zipPath)
	if err != nil {
		return err
	}
	defer cleanup()
	zr, err := zip.NewReader(ra, size)
	if err != nil {
		return err
	}
	var total int64
	for _, zf := range zr.File {
		total += int64(zf.UncompressedSize64)
	}
	j.mu.Lock()
	j.Total, j.Files, j.State = total, len(zr.File), "running"
	j.mu.Unlock()
	m.emit(j)

	if err := f.Mkdir(destDir); err != nil {
		return err
	}
	for _, zf := range zr.File {
		if err := ctx.Err(); err != nil {
			return err
		}
		if err := extractEntry(ctx, j, m, f, destDir, zf); err != nil {
			return err
		}
	}
	return nil
}

// extractEntry writes one zip entry under destDir. Prefixing the entry name
// with "/" before Clean neutralizes "zip-slip" (a ../../ entry trying to
// write outside destDir): Clean collapses any leading ".." against the
// synthetic root instead of letting it escape upward.
func extractEntry(ctx context.Context, j *job, m *Manager, f FS, destDir string, zf *zip.File) error {
	clean := path.Clean("/" + strings.ReplaceAll(zf.Name, "\\", "/"))
	target := f.Join(destDir, clean)
	if zf.FileInfo().IsDir() {
		return f.Mkdir(target)
	}
	if err := f.Mkdir(path.Dir(target)); err != nil {
		return err
	}
	j.setCurrent(path.Base(target))
	r, err := zf.Open()
	if err != nil {
		return err
	}
	defer r.Close()
	w, err := f.Create(target)
	if err != nil {
		return err
	}
	err = copyStream(ctx, w, r, func(n int64) { j.add(m, n) })
	cerr := w.Close()
	if err == nil {
		err = cerr
	}
	if err != nil {
		return err
	}
	j.fileDone(1)
	return nil
}

// openZipReaderAt gets random-access bytes for a zip file on f. Local disk
// and SFTP handles already support io.ReaderAt; a streaming-only source
// (plain FTP) is buffered to a temp local file first.
func openZipReaderAt(f FS, p string) (io.ReaderAt, int64, func(), error) {
	rc, err := f.Open(p)
	if err != nil {
		return nil, 0, nil, err
	}
	if ra, ok := rc.(io.ReaderAt); ok {
		e, err := f.Stat(p)
		if err != nil {
			_ = rc.Close()
			return nil, 0, nil, err
		}
		return ra, e.Size, func() { _ = rc.Close() }, nil
	}
	_ = rc.Close()

	tmp, err := os.CreateTemp("", "shell-bay-zip-*")
	if err != nil {
		return nil, 0, nil, err
	}
	cleanupTmp := func() { _ = tmp.Close(); _ = os.Remove(tmp.Name()) }
	src, err := f.Open(p)
	if err != nil {
		cleanupTmp()
		return nil, 0, nil, err
	}
	n, err := io.Copy(tmp, src)
	_ = src.Close()
	if err != nil {
		cleanupTmp()
		return nil, 0, nil, err
	}
	if _, err := tmp.Seek(0, io.SeekStart); err != nil {
		cleanupTmp()
		return nil, 0, nil, err
	}
	return tmp, n, cleanupTmp, nil
}
