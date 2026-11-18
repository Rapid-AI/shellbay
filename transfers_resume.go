package main

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"sync"
	"time"

	"shellbay/internal/fm"
)

// resumableRecord is a transfer that stopped partway through and can be
// continued. It stores file paths and host IDs outside the encrypted vault,
// with owner-only permissions. Credentials stay in the vault.
type resumableRecord struct {
	ID        string `json:"id"`
	Title     string `json:"title"`
	SrcHostID string `json:"srcHostId"` // "" means the local disk
	DstHostID string `json:"dstHostId"`
	SrcPath   string `json:"srcPath"`
	DstPath   string `json:"dstPath"`
	BytesDone int64  `json:"bytesDone"`
	Total     int64  `json:"total"`
	Move      bool   `json:"move"`
	SavedAt   int64  `json:"savedAt"`
}

type resumeStore struct {
	mu   sync.Mutex
	path string
	recs map[string]resumableRecord
}

func newResumeStore(dataDir string) *resumeStore {
	s := &resumeStore{path: filepath.Join(dataDir, "transfers.json"), recs: map[string]resumableRecord{}}
	if b, err := os.ReadFile(s.path); err == nil {
		_ = json.Unmarshal(b, &s.recs)
	}
	return s
}

func (s *resumeStore) saveLocked() {
	b, err := json.MarshalIndent(s.recs, "", "  ")
	if err != nil {
		return
	}
	tmp := s.path + ".tmp"
	if err := os.WriteFile(tmp, b, 0o600); err == nil {
		_ = os.Rename(tmp, s.path)
	}
}

func (s *resumeStore) put(r resumableRecord) {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.recs[r.ID] = r
	s.saveLocked()
}

func (s *resumeStore) remove(id string) {
	s.mu.Lock()
	defer s.mu.Unlock()
	_, ok := s.recs[id]
	delete(s.recs, id)
	if ok {
		s.saveLocked()
	}
}

func (s *resumeStore) get(id string) (resumableRecord, bool) {
	s.mu.Lock()
	defer s.mu.Unlock()
	r, ok := s.recs[id]
	return r, ok
}

func (s *resumeStore) list() []resumableRecord {
	s.mu.Lock()
	defer s.mu.Unlock()
	out := make([]resumableRecord, 0, len(s.recs))
	for _, r := range s.recs {
		out = append(out, r)
	}
	return out
}

// fsHostID identifies the host behind a registered file system, "" for the
// local disk.
func fsHostID(f fm.FS) string {
	if s, ok := f.(interface{ HostID() string }); ok {
		return s.HostID()
	}
	return ""
}

// trackResume keeps the on-disk resume record for a job in sync with its
// latest state: dropped once it finishes or has no usable progress, kept
// (and refreshed) while it's stopped partway through a single-file transfer.
func (a *App) trackResume(j fm.Job) {
	if !j.Resumable || j.SrcPath == "" || j.DstPath == "" {
		return
	}
	switch j.State {
	case "error", "canceled":
		if j.Done <= 0 || j.Done >= j.Total {
			a.resumable.remove(j.ID)
			return
		}
		srcF, err1 := a.files.Get(j.SrcFS)
		dstF, err2 := a.files.Get(j.DstFS)
		if err1 != nil || err2 != nil {
			return
		}
		a.resumable.put(resumableRecord{
			ID: j.ID, Title: j.Title, SrcHostID: fsHostID(srcF), DstHostID: fsHostID(dstF),
			SrcPath: j.SrcPath, DstPath: j.DstPath, BytesDone: j.Done, Total: j.Total,
			Move: j.Move, SavedAt: time.Now().UnixMilli(),
		})
	case "done":
		a.resumable.remove(j.ID)
	}
}

// ResumableTransfers lists interrupted transfers that can still be continued,
// including ones left over from before the app last restarted.
func (a *App) ResumableTransfers() []resumableRecord { return a.resumable.list() }

// ResumeDismiss forgets an interrupted transfer without resuming it.
func (a *App) ResumeDismiss(id string) { a.resumable.remove(id) }

// FsResumeTransfer continues an interrupted transfer using the given,
// currently open source and destination. The record binds the saved paths
// to the original hosts, and is consumed once a continuation is queued.
func (a *App) FsResumeTransfer(id, srcFS, dstFS string) (string, error) {
	a.resumeMu.Lock()
	defer a.resumeMu.Unlock()
	rec, ok := a.resumable.get(id)
	if !ok {
		return "", os.ErrNotExist
	}
	return a.resumeRecord(rec, srcFS, dstFS)
}

func (a *App) resumeRecord(rec resumableRecord, srcFS, dstFS string) (string, error) {
	src, err := a.files.Get(srcFS)
	if err != nil {
		return "", err
	}
	dst, err := a.files.Get(dstFS)
	if err != nil {
		return "", err
	}
	if fsHostID(src) != rec.SrcHostID || fsHostID(dst) != rec.DstHostID {
		return "", errors.New("reconnect to the original source and destination before resuming")
	}
	jid, err := a.files.ResumeFromRecord(srcFS, dstFS, fm.ResumeRecord{
		Title: rec.Title, SrcPath: rec.SrcPath, DstPath: rec.DstPath,
		BytesDone: rec.BytesDone, Total: rec.Total, Move: rec.Move,
	})
	if err != nil {
		return "", err
	}
	a.resumable.remove(rec.ID)
	return jid, nil
}

// tryAutoResume lets a plain retry (the user just re-running the same copy)
// transparently continue a matching interrupted transfer instead of
// restarting it from zero. Used by FsTransfer.
func (a *App) tryAutoResume(srcFS, dstFS string, srcPath, dstDir string, move bool) (string, error) {
	a.resumeMu.Lock()
	defer a.resumeMu.Unlock()
	srcF, err := a.files.Get(srcFS)
	if err != nil {
		return "", err
	}
	dstF, err := a.files.Get(dstFS)
	if err != nil {
		return "", err
	}
	ent, err := srcF.Stat(srcPath)
	if err != nil || ent.IsDir {
		return "", nil
	}
	target := dstF.Join(dstDir, ent.Name)
	srcHost, dstHost := fsHostID(srcF), fsHostID(dstF)
	for _, rec := range a.resumable.list() {
		if rec.SrcHostID != srcHost || rec.DstHostID != dstHost || rec.Move != move {
			continue
		}
		if rec.SrcPath != srcPath || rec.DstPath != target {
			continue
		}
		return a.resumeRecord(rec, srcFS, dstFS)
	}
	return "", nil
}
