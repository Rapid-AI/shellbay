package fm

import (
	"context"
	"errors"
	"fmt"
	"path"
	"time"
)

// SyncAction describes one file-level change needed to make dst's tree match
// src's tree. Path is relative to the two compared roots.
type SyncAction struct {
	Kind string `json:"kind"` // add | update | remove
	Path string `json:"path"`
	Size int64  `json:"size"`
}

type fileStamp struct {
	size int64
	mod  int64
}

func walkFiles(f FS, root string) (map[string]fileStamp, error) {
	out := map[string]fileStamp{}
	var walk func(dir, rel string) error
	walk = func(dir, rel string) error {
		ents, err := f.List(dir)
		if err != nil {
			return err
		}
		for _, e := range ents {
			r := path.Join(rel, e.Name)
			if e.IsDir {
				if err := walk(e.Path, r); err != nil {
					return err
				}
				continue
			}
			out[r] = fileStamp{size: e.Size, mod: e.ModTime}
		}
		return nil
	}
	if err := walk(root, ""); err != nil {
		return nil, err
	}
	return out, nil
}

// DiffDirs compares two directory trees file by file and returns the
// add/update actions needed to bring dst up to date with src, plus the
// files found only under dst ("remove") for callers that want to mirror
// deletions. Identical files are omitted.
func DiffDirs(src, dst FS, srcRoot, dstRoot string) ([]SyncAction, error) {
	srcFiles, err := walkFiles(src, srcRoot)
	if err != nil {
		return nil, err
	}
	dstFiles, err := walkFiles(dst, dstRoot)
	if err != nil {
		return nil, err
	}
	var out []SyncAction
	for p, si := range srcFiles {
		if di, ok := dstFiles[p]; !ok {
			out = append(out, SyncAction{Kind: "add", Path: p, Size: si.size})
		} else if di.size != si.size || di.mod < si.mod {
			out = append(out, SyncAction{Kind: "update", Path: p, Size: si.size})
		}
	}
	for p, di := range dstFiles {
		if _, ok := srcFiles[p]; !ok {
			out = append(out, SyncAction{Kind: "remove", Path: p, Size: di.size})
		}
	}
	return out, nil
}

// StartSync queues a job that applies a (possibly filtered) plan from
// DiffDirs: copies add/update entries from src and removes "remove" entries
// from dst.
func (m *Manager) StartSync(srcID, dstID, srcDir, dstDir string, actions []SyncAction) (string, error) {
	src, err := m.Get(srcID)
	if err != nil {
		return "", err
	}
	dst, err := m.Get(dstID)
	if err != nil {
		return "", err
	}
	if len(actions) == 0 {
		return "", errors.New("nothing to sync")
	}
	var total int64
	for _, act := range actions {
		if act.Kind != "remove" {
			total += act.Size
		}
	}
	ctx, cancel := context.WithCancel(context.Background())
	j := &job{cancel: cancel}
	j.Job = Job{
		ID: newID(), Title: fmt.Sprintf("Sync %d items", len(actions)), State: "queued", Kind: "sync",
		SrcFS: srcID, DstFS: dstID, DstDir: dstDir, Total: total, Files: len(actions),
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
		j.State = "running"
		j.speedAt = time.Now()
		j.mu.Unlock()
		m.emit(j)
		err := m.runSync(ctx, j, src, dst, srcDir, dstDir, actions)
		m.finish(j, err)
	}()
	return j.ID, nil
}

func (m *Manager) runSync(ctx context.Context, j *job, src, dst FS, srcDir, dstDir string, actions []SyncAction) error {
	if err := dst.Mkdir(dstDir); err != nil {
		return err
	}
	for _, act := range actions {
		if err := ctx.Err(); err != nil {
			return err
		}
		target := dst.Join(dstDir, act.Path)
		if act.Kind == "remove" {
			j.setCurrent(act.Path)
			if err := dst.Remove(target); err != nil {
				return err
			}
			j.fileDone(1)
			continue
		}
		srcPath := src.Join(srcDir, act.Path)
		ent, err := src.Stat(srcPath)
		if err != nil {
			return err
		}
		if dir := path.Dir(target); dir != "." && dir != target {
			if err := dst.Mkdir(dir); err != nil {
				return err
			}
		}
		if err := m.copyFile(ctx, j, src, dst, ent, target); err != nil {
			return err
		}
	}
	return nil
}
