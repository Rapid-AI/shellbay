package fm

import (
	"errors"
	"fmt"
	"io"
	"os"
	"path"
	"strings"
	"time"

	"github.com/jlaffaye/ftp"
)

// FTPFS is a remote file system over plain FTP (no TLS in this version).
type FTPFS struct {
	id     string
	hostID string
	c      *ftp.ServerConn
	home   string
}

// NewFTP dials and logs into an FTP server. An empty password logs in as
// "anonymous", matching how most public FTP servers expect to be used.
func NewFTP(id, hostID, host string, port int, user, password string) (*FTPFS, error) {
	if port <= 0 {
		port = 21
	}
	c, err := ftp.Dial(fmt.Sprintf("%s:%d", host, port), ftp.DialWithTimeout(15*time.Second))
	if err != nil {
		return nil, err
	}
	if user == "" {
		user = "anonymous"
	}
	if err := c.Login(user, password); err != nil {
		_ = c.Quit()
		return nil, err
	}
	home, err := c.CurrentDir()
	if err != nil || home == "" {
		home = "/"
	}
	return &FTPFS{id: id, hostID: hostID, c: c, home: home}, nil
}

func (f *FTPFS) ID() string { return f.id }

func (f *FTPFS) HostID() string { return f.hostID }

func (f *FTPFS) Home() (string, error) { return f.home, nil }

func ftpToEntry(dir string, e *ftp.Entry) Entry {
	isDir := e.Type == ftp.EntryTypeFolder
	isLink := e.Type == ftp.EntryTypeLink
	mode := os.FileMode(0o644)
	if isDir {
		mode = os.ModeDir | 0o755
	}
	return Entry{
		Name: e.Name, Path: path.Join(dir, e.Name), Size: int64(e.Size),
		IsDir: isDir, IsLink: isLink, Mode: uint32(mode.Perm()), ModeStr: mode.String(),
		ModTime: e.Time.UnixMilli(),
	}
}

func (f *FTPFS) List(dir string) ([]Entry, error) {
	ents, err := f.c.List(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(ents))
	for _, e := range ents {
		if e.Name == "." || e.Name == ".." {
			continue
		}
		out = append(out, ftpToEntry(dir, e))
	}
	return out, nil
}

// Stat tries the single-file MLST command first (not all servers support
// it) and falls back to listing the parent directory and matching by name.
func (f *FTPFS) Stat(p string) (Entry, error) {
	clean := path.Clean(p)
	if clean == "." || clean == "/" || clean == "" {
		mode := os.ModeDir | 0o755
		return Entry{Name: "/", Path: "/", IsDir: true, Mode: uint32(mode.Perm()), ModeStr: mode.String()}, nil
	}
	if e, err := f.c.GetEntry(clean); err == nil && e != nil {
		return ftpToEntry(path.Dir(clean), e), nil
	}
	dir := path.Dir(clean)
	name := path.Base(clean)
	ents, err := f.c.List(dir)
	if err != nil {
		return Entry{}, err
	}
	for _, e := range ents {
		if e.Name == name {
			return ftpToEntry(dir, e), nil
		}
	}
	return Entry{}, errors.New("not found")
}

// Mkdir creates p and any missing parent directories, in the spirit of
// os.MkdirAll. Plain FTP has no atomic "mkdir -p", so segments that already
// exist are tolerated rather than treated as an error.
func (f *FTPFS) Mkdir(p string) error {
	clean := strings.TrimSuffix(path.Clean(p), "/")
	if clean == "" || clean == "." || clean == "/" {
		return nil
	}
	cur := ""
	for _, part := range strings.Split(strings.TrimPrefix(clean, "/"), "/") {
		if part == "" {
			continue
		}
		cur += "/" + part
		_ = f.c.MakeDir(cur) // ignore "already exists" and similar; verified by the final Stat below
	}
	_, err := f.Stat(clean)
	return err
}

func (f *FTPFS) Remove(p string) error {
	e, err := f.Stat(p)
	if err != nil {
		return err
	}
	if e.IsDir && !e.IsLink {
		return f.c.RemoveDirRecur(p)
	}
	return f.c.Delete(p)
}

func (f *FTPFS) Rename(oldp, newp string) error { return f.c.Rename(oldp, newp) }

func (f *FTPFS) RemoveEmptyDir(p string) error { return f.c.RemoveDir(p) }

// Chmod is not supported over plain FTP; surfaced clearly rather than
// silently doing nothing.
func (f *FTPFS) Chmod(string, os.FileMode) error {
	return errors.New("permissions are not supported over FTP")
}

func (f *FTPFS) Open(p string) (io.ReadCloser, error) {
	r, err := f.c.Retr(p)
	if err != nil {
		return nil, err
	}
	return r, nil
}

func (f *FTPFS) OpenAt(p string, offset int64) (io.ReadCloser, error) {
	if offset <= 0 {
		return f.Open(p)
	}
	r, err := f.c.RetrFrom(p, uint64(offset))
	if err != nil {
		return nil, err
	}
	return r, nil
}

// ftpUpload adapts FTP's blocking Stor/StorFrom (which read from an
// io.Reader until EOF) to the FS interface's streaming io.WriteCloser, via
// the standard io.Pipe + goroutine idiom.
type ftpUpload struct {
	pw   *io.PipeWriter
	done chan error
}

func (u *ftpUpload) Write(p []byte) (int, error) { return u.pw.Write(p) }

func (u *ftpUpload) Close() error {
	_ = u.pw.Close()
	return <-u.done
}

func (f *FTPFS) upload(p string, offset int64) io.WriteCloser {
	pr, pw := io.Pipe()
	done := make(chan error, 1)
	go func() {
		var err error
		if offset > 0 {
			err = f.c.StorFrom(p, pr, uint64(offset))
		} else {
			err = f.c.Stor(p, pr)
		}
		_ = pr.CloseWithError(err)
		done <- err
	}()
	return &ftpUpload{pw: pw, done: done}
}

func (f *FTPFS) Create(p string) (io.WriteCloser, error) { return f.upload(p, 0), nil }

func (f *FTPFS) CreateAt(p string, offset int64) (io.WriteCloser, error) {
	return f.upload(p, offset), nil
}

func (f *FTPFS) Join(elem ...string) string { return path.Join(elem...) }

func (f *FTPFS) Close() { _ = f.c.Quit() }
