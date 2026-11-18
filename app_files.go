package main

import (
	"errors"
	"os"
	"path/filepath"
	"runtime"
	"sort"
	"strings"

	"shellbay/internal/fm"
	"shellbay/internal/vault"
)

// Place is a quick-access location in a file pane.
type Place struct {
	Name string `json:"name"`
	Path string `json:"path"`
}

// LocalPlaces lists shortcuts for the local pane. Paths belong to the host
// OS; remote panes use the home path provided by their protocol instead.
func (a *App) LocalPlaces() []Place {
	var out []Place
	if home, err := os.UserHomeDir(); err == nil {
		out = append(out, Place{"Home", home})
		for _, n := range []string{"Desktop", "Documents", "Downloads"} {
			p := filepath.Join(home, n)
			if fi, err := os.Stat(p); err == nil && fi.IsDir() {
				out = append(out, Place{n, p})
			}
		}
	}
	switch runtime.GOOS {
	case "windows":
		if home, err := os.UserHomeDir(); err == nil && filepath.VolumeName(home) != "" {
			volume := filepath.VolumeName(home)
			out = append(out, Place{volume, volume + string(filepath.Separator)})
		}
		return out
	case "darwin":
		out = append(out, Place{"Applications", "/Applications"}, Place{"File System", "/"})
	default:
		return append(out, Place{"File System", "/"})
	}
	if vols, err := os.ReadDir("/Volumes"); err == nil {
		for _, v := range vols {
			if v.IsDir() || v.Type()&os.ModeSymlink != 0 {
				p := filepath.Join("/Volumes", v.Name())
				if p == "/Volumes/Macintosh HD" {
					continue
				}
				out = append(out, Place{v.Name(), p})
			}
		}
	}
	return out
}

// SftpOpen connects to a host and returns a file system ID for a pane.
func (a *App) SftpOpen(hostID string) (string, error) {
	lease, err := a.ssh.Acquire(hostID)
	if err != nil {
		return "", err
	}
	id := "sftp-" + vault.NewID()
	s, err := fm.NewSFTP(id, lease)
	if err != nil {
		lease.Release()
		return "", err
	}
	a.files.Register(s)
	a.mu.Lock()
	a.sftps[id] = s
	a.mu.Unlock()
	a.ssh.Touch(hostID)
	return id, nil
}

// SftpClose disconnects a remote pane.
func (a *App) SftpClose(fsID string) {
	a.mu.Lock()
	s := a.sftps[fsID]
	delete(a.sftps, fsID)
	a.mu.Unlock()
	if s != nil {
		a.files.Unregister(fsID)
		s.Close()
	}
}

// FsHome returns the starting directory of a file system.
func (a *App) FsHome(fsID string) (string, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return "", err
	}
	return f.Home()
}

// FsList lists a directory.
func (a *App) FsList(fsID, dir string) ([]fm.Entry, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return nil, err
	}
	return f.List(dir)
}

// FsStat returns details about one path.
func (a *App) FsStat(fsID, p string) (fm.Entry, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return fm.Entry{}, err
	}
	return f.Stat(p)
}

// FsMkdir creates a directory (and parents).
func (a *App) FsMkdir(fsID, p string) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	return f.Mkdir(p)
}

// FsNewFile creates an empty file.
func (a *App) FsNewFile(fsID, p string) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	return fm.NewFile(f, p)
}

// FsRename renames or moves within one file system.
func (a *App) FsRename(fsID, oldPath, newPath string) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	if _, err := f.Stat(newPath); err == nil {
		return errors.New("something with this name already exists")
	}
	return f.Rename(oldPath, newPath)
}

// FsDelete permanently removes paths.
func (a *App) FsDelete(fsID string, paths []string) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	for _, p := range paths {
		if p == "/" || p == "" {
			return errors.New("refusing to delete the root folder")
		}
		if err := f.Remove(p); err != nil {
			return err
		}
	}
	return nil
}

// FsTrash moves local paths to the Trash.
func (a *App) FsTrash(paths []string) error {
	for _, p := range paths {
		if p == "/" || p == "" {
			return errors.New("refusing to delete the root folder")
		}
	}
	return fm.TrashLocal(paths)
}

// FsChmod changes permissions (mode is the numeric permission bits, e.g. 0o755 = 493).
func (a *App) FsChmod(fsID, p string, mode uint32, recursive bool) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	return fm.ChmodTree(f, p, os.FileMode(mode&0o777), recursive)
}

// FsSize computes the recursive size of a path.
func (a *App) FsSize(fsID, p string) (fm.SizeInfo, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return fm.SizeInfo{}, err
	}
	return fm.DirSize(f, p)
}

// FsSearch finds files by name below root.
func (a *App) FsSearch(fsID, root, pattern string) ([]fm.Entry, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return nil, err
	}
	res := fm.Search(f, root, pattern, 500)
	if res == nil {
		res = []fm.Entry{}
	}
	sort.Slice(res, func(i, j int) bool { return strings.ToLower(res[i].Path) < strings.ToLower(res[j].Path) })
	return res, nil
}

// FsReadText loads a text file for the built-in editor.
func (a *App) FsReadText(fsID, p string) (string, error) {
	f, err := a.files.Get(fsID)
	if err != nil {
		return "", err
	}
	return fm.ReadText(f, p)
}

// FsWriteText saves the built-in editor's content.
func (a *App) FsWriteText(fsID, p, text string) error {
	f, err := a.files.Get(fsID)
	if err != nil {
		return err
	}
	return fm.WriteText(f, p, text)
}

// FsTransfer queues a copy or move between any two panes. conflict: overwrite | skip | rename.
// A single-file transfer that matches an interrupted one (same source,
// destination and direction) transparently continues it instead of
// restarting from zero.
func (a *App) FsTransfer(srcFS, dstFS string, paths []string, dstDir string, move bool, conflict string) (string, error) {
	if len(paths) == 1 && conflict == "overwrite" {
		if jid, err := a.tryAutoResume(srcFS, dstFS, paths[0], dstDir, move); jid != "" || err != nil {
			return jid, err
		}
	}
	return a.files.Start(srcFS, dstFS, paths, dstDir, move, conflict)
}

// FsSyncPreview compares two directory trees and returns the add/update/
// remove plan needed to bring dstDir up to date with srcDir, for the user to
// review before anything is changed.
func (a *App) FsSyncPreview(srcFS, dstFS, srcDir, dstDir string) ([]fm.SyncAction, error) {
	src, err := a.files.Get(srcFS)
	if err != nil {
		return nil, err
	}
	dst, err := a.files.Get(dstFS)
	if err != nil {
		return nil, err
	}
	acts, err := fm.DiffDirs(src, dst, srcDir, dstDir)
	if err != nil {
		return nil, err
	}
	sort.Slice(acts, func(i, j int) bool { return acts[i].Path < acts[j].Path })
	return acts, nil
}

// FsSyncApply runs the accepted subset of a sync plan (from FsSyncPreview)
// and returns the queued job ID.
func (a *App) FsSyncApply(srcFS, dstFS, srcDir, dstDir string, actions []fm.SyncAction) (string, error) {
	return a.files.StartSync(srcFS, dstFS, srcDir, dstDir, actions)
}

// FsArchive queues a job that zips the given paths into destZip on the same
// pane, returning the job ID (tracked like any other transfer).
func (a *App) FsArchive(fsID string, paths []string, destZip string) (string, error) {
	return a.files.StartArchive(fsID, paths, destZip)
}

// FsExtract queues a job that unzips zipPath into destDir on the same pane.
func (a *App) FsExtract(fsID, zipPath, destDir string) (string, error) {
	return a.files.StartExtract(fsID, zipPath, destDir)
}

// FtpOpen connects to an FTP host and returns a file system ID for a pane.
func (a *App) FtpOpen(hostID string) (string, error) {
	h, ok := a.v.Host(hostID)
	if !ok {
		return "", errors.New("host not found")
	}
	id := "ftp-" + vault.NewID()
	s, err := fm.NewFTP(id, hostID, h.Address, h.Port, h.Username, h.Password)
	if err != nil {
		return "", err
	}
	a.files.Register(s)
	a.mu.Lock()
	a.ftps[id] = s
	a.mu.Unlock()
	a.ssh.Touch(hostID)
	return id, nil
}

// FtpClose disconnects an FTP pane.
func (a *App) FtpClose(fsID string) {
	a.mu.Lock()
	s := a.ftps[fsID]
	delete(a.ftps, fsID)
	a.mu.Unlock()
	if s != nil {
		a.files.Unregister(fsID)
		s.Close()
	}
}

// TransferList returns the transfer queue.
func (a *App) TransferList() []fm.Job { return a.files.List() }

// TransferCancel cancels one job.
func (a *App) TransferCancel(id string) { a.files.Cancel(id) }

// TransferClear forgets finished jobs.
func (a *App) TransferClear() {
	a.files.ClearFinished()
	a.emit("transfer:list", a.files.List())
}
