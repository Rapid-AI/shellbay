package fm

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"path/filepath"
	"strings"
	"time"
)

const maxEditBytes = 2 << 20

// ReadText loads a small text file for the editor.
func ReadText(f FS, p string) (string, error) {
	r, err := f.Open(p)
	if err != nil {
		return "", err
	}
	defer r.Close()
	data, err := io.ReadAll(io.LimitReader(r, maxEditBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxEditBytes {
		return "", errors.New("file is larger than 2 MB, open it in an external editor")
	}
	head := data
	if len(head) > 8000 {
		head = head[:8000]
	}
	if bytes.IndexByte(head, 0) >= 0 {
		return "", errors.New("this looks like a binary file")
	}
	return string(data), nil
}

// WriteText saves text back to a file.
func WriteText(f FS, p, text string) error {
	w, err := f.Create(p)
	if err != nil {
		return err
	}
	if _, err := io.WriteString(w, text); err != nil {
		_ = w.Close()
		return err
	}
	return w.Close()
}

// NewFile creates an empty file.
func NewFile(f FS, p string) error {
	if _, err := f.Stat(p); err == nil {
		return errors.New("a file with this name already exists")
	}
	w, err := f.Create(p)
	if err != nil {
		return err
	}
	return w.Close()
}

// Search walks a tree breadth-first and returns entries whose name matches.
// The pattern may contain * and ? wildcards, otherwise it is a substring match.
func Search(f FS, root, pattern string, limit int) []Entry {
	ctx, cancel := context.WithTimeout(context.Background(), 30*time.Second)
	defer cancel()
	pattern = strings.ToLower(strings.TrimSpace(pattern))
	if pattern == "" {
		return nil
	}
	glob := strings.ContainsAny(pattern, "*?")
	var out []Entry
	queue := []string{root}
	visited := 0
	for len(queue) > 0 && len(out) < limit && visited < 50000 {
		if ctx.Err() != nil {
			break
		}
		dir := queue[0]
		queue = queue[1:]
		kids, err := f.List(dir)
		if err != nil {
			continue
		}
		for _, k := range kids {
			visited++
			name := strings.ToLower(k.Name)
			ok := false
			if glob {
				ok, _ = path.Match(pattern, name)
			} else {
				ok = strings.Contains(name, pattern)
			}
			if ok {
				out = append(out, k)
				if len(out) >= limit {
					break
				}
			}
			if k.IsDir && !k.IsLink {
				queue = append(queue, k.Path)
			}
		}
	}
	return out
}

// SizeInfo is the result of a recursive size calculation.
type SizeInfo struct {
	Bytes int64 `json:"bytes"`
	Files int   `json:"files"`
	Dirs  int   `json:"dirs"`
}

// DirSize sums up everything below p.
func DirSize(f FS, p string) (SizeInfo, error) {
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	var info SizeInfo
	var walk func(e Entry) error
	walk = func(e Entry) error {
		if err := ctx.Err(); err != nil {
			return err
		}
		if !e.IsDir {
			info.Bytes += e.Size
			info.Files++
			return nil
		}
		info.Dirs++
		if e.IsLink {
			return nil
		}
		kids, err := f.List(e.Path)
		if err != nil {
			return nil
		}
		for _, k := range kids {
			if err := walk(k); err != nil {
				return err
			}
		}
		return nil
	}
	e, err := f.Stat(p)
	if err != nil {
		return info, err
	}
	err = walk(e)
	return info, err
}

// ChmodTree changes permissions, optionally recursively.
func ChmodTree(f FS, p string, mode os.FileMode, recursive bool) error {
	if err := f.Chmod(p, mode); err != nil {
		return err
	}
	if !recursive {
		return nil
	}
	e, err := f.Stat(p)
	if err != nil || !e.IsDir || e.IsLink {
		return err
	}
	kids, err := f.List(p)
	if err != nil {
		return err
	}
	for _, k := range kids {
		if k.IsLink {
			continue
		}
		if err := ChmodTree(f, k.Path, mode, true); err != nil {
			return err
		}
	}
	return nil
}

// TrashLocal moves local paths to the OS trash/recycle bin (Finder on macOS,
// Explorer's Recycle Bin on Windows, the freedesktop.org Trash on Linux —
// see moveToSystemTrash in the per-OS trash_*.go files). Falls back to
// renaming into a local ".Trash" folder if the OS trash isn't reachable.
func TrashLocal(paths []string) error {
	for _, p := range paths {
		if err := moveToSystemTrash(p); err == nil {
			continue
		}
		home, herr := os.UserHomeDir()
		if herr != nil {
			return herr
		}
		trash := filepath.Join(home, ".Trash")
		if err := os.MkdirAll(trash, 0o700); err != nil {
			return err
		}
		dest := filepath.Join(trash, filepath.Base(p))
		if _, err := os.Lstat(dest); err == nil {
			dest = fmt.Sprintf("%s-%d", dest, time.Now().Unix())
		}
		if err := os.Rename(p, dest); err != nil {
			return err
		}
	}
	return nil
}
