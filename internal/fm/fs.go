package fm

import (
	"fmt"
	"io"
	"os"
	"os/user"
	"path"
	"path/filepath"
	"strconv"
	"sync"

	"github.com/pkg/sftp"

	"shellbay/internal/sshx"
)

// Entry is one file or directory.
type Entry struct {
	Name    string `json:"name"`
	Path    string `json:"path"`
	Size    int64  `json:"size"`
	IsDir   bool   `json:"isDir"`
	IsLink  bool   `json:"isLink"`
	Mode    uint32 `json:"mode"`
	ModeStr string `json:"modeStr"`
	ModTime int64  `json:"modTime"`
	Owner   string `json:"owner"`
}

// FS is a minimal file system interface shared by local disk and SFTP.
type FS interface {
	ID() string
	Home() (string, error)
	List(dir string) ([]Entry, error)
	Stat(p string) (Entry, error)
	Mkdir(p string) error
	Remove(p string) error
	// RemoveEmptyDir fails if the directory still contains entries.
	RemoveEmptyDir(p string) error
	Rename(oldp, newp string) error
	Chmod(p string, mode os.FileMode) error
	Open(p string) (io.ReadCloser, error)
	Create(p string) (io.WriteCloser, error)
	// OpenAt and CreateAt seek to offset before returning, so an interrupted
	// copy can continue without re-reading or re-writing bytes already moved.
	OpenAt(p string, offset int64) (io.ReadCloser, error)
	CreateAt(p string, offset int64) (io.WriteCloser, error)
	Join(elem ...string) string
	Close()
}

var (
	userMu    sync.Mutex
	userCache = map[uint32]string{}
)

func lookupUser(uid uint32) string {
	userMu.Lock()
	defer userMu.Unlock()
	if n, ok := userCache[uid]; ok {
		return n
	}
	name := strconv.Itoa(int(uid))
	if u, err := user.LookupId(name); err == nil {
		name = u.Username
	}
	userCache[uid] = name
	return name
}

func ownerOf(fi os.FileInfo) string {
	if st, ok := fi.Sys().(*sftp.FileStat); ok {
		return fmt.Sprintf("%d:%d", st.UID, st.GID)
	}
	return localOwner(fi)
}

func toEntry(p string, fi os.FileInfo) Entry {
	return Entry{
		Name:    fi.Name(),
		Path:    p,
		Size:    fi.Size(),
		IsDir:   fi.IsDir(),
		IsLink:  fi.Mode()&os.ModeSymlink != 0,
		Mode:    uint32(fi.Mode().Perm()),
		ModeStr: fi.Mode().String(),
		ModTime: fi.ModTime().UnixMilli(),
		Owner:   ownerOf(fi),
	}
}

// ---------------------------------------------------------------- local

// LocalFS is the local disk.
type LocalFS struct{}

func (LocalFS) ID() string { return "local" }

func (LocalFS) Home() (string, error) { return os.UserHomeDir() }

func (LocalFS) List(dir string) ([]Entry, error) {
	des, err := os.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(des))
	for _, de := range des {
		fi, err := de.Info()
		if err != nil {
			continue
		}
		e := toEntry(filepath.Join(dir, de.Name()), fi)
		if e.IsLink {
			if st, err := os.Stat(e.Path); err == nil {
				e.IsDir = st.IsDir()
				e.Size = st.Size()
			}
		}
		out = append(out, e)
	}
	return out, nil
}

func (LocalFS) Stat(p string) (Entry, error) {
	fi, err := os.Lstat(p)
	if err != nil {
		return Entry{}, err
	}
	e := toEntry(p, fi)
	if e.IsLink {
		if st, err := os.Stat(p); err == nil {
			e.IsDir = st.IsDir()
			e.Size = st.Size()
		}
	}
	return e, nil
}

func (LocalFS) Mkdir(p string) error { return os.MkdirAll(p, 0o755) }

func (LocalFS) Remove(p string) error {
	fi, err := os.Lstat(p)
	if err != nil {
		return err
	}
	if fi.Mode()&os.ModeSymlink != 0 {
		return os.Remove(p)
	}
	return os.RemoveAll(p)
}

func (LocalFS) Rename(oldp, newp string) error { return os.Rename(oldp, newp) }

func (LocalFS) RemoveEmptyDir(p string) error { return os.Remove(p) }

func (LocalFS) Chmod(p string, mode os.FileMode) error { return os.Chmod(p, mode) }

func (LocalFS) Open(p string) (io.ReadCloser, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (LocalFS) Create(p string) (io.WriteCloser, error) {
	f, err := os.Create(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (LocalFS) OpenAt(p string, offset int64) (io.ReadCloser, error) {
	f, err := os.Open(p)
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			return nil, err
		}
	}
	return f, nil
}

func (LocalFS) CreateAt(p string, offset int64) (io.WriteCloser, error) {
	f, err := os.OpenFile(p, os.O_WRONLY|os.O_CREATE, 0o644)
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			return nil, err
		}
	} else if err := f.Truncate(0); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

func (LocalFS) Join(elem ...string) string { return filepath.Join(elem...) }

func (LocalFS) Close() {}

// ---------------------------------------------------------------- sftp

// SFTPFS is a remote file system over SFTP.
type SFTPFS struct {
	id    string
	c     *sftp.Client
	lease *sshx.Lease
}

// NewSFTP opens an SFTP subsystem on a pooled SSH connection.
func NewSFTP(id string, lease *sshx.Lease) (*SFTPFS, error) {
	c, err := sftp.NewClient(lease.Client())
	if err != nil {
		return nil, err
	}
	return &SFTPFS{id: id, c: c, lease: lease}, nil
}

func (s *SFTPFS) ID() string { return s.id }

func (s *SFTPFS) Home() (string, error) { return s.c.Getwd() }

func (s *SFTPFS) List(dir string) ([]Entry, error) {
	infos, err := s.c.ReadDir(dir)
	if err != nil {
		return nil, err
	}
	out := make([]Entry, 0, len(infos))
	for _, fi := range infos {
		p := path.Join(dir, fi.Name())
		e := toEntry(p, fi)
		if e.IsLink {
			if st, err := s.c.Stat(p); err == nil {
				e.IsDir = st.IsDir()
				e.Size = st.Size()
			}
		}
		out = append(out, e)
	}
	return out, nil
}

func (s *SFTPFS) Stat(p string) (Entry, error) {
	fi, err := s.c.Lstat(p)
	if err != nil {
		return Entry{}, err
	}
	e := toEntry(p, fi)
	if e.Name == "" || e.Name == "." {
		e.Name = path.Base(p)
	}
	if e.IsLink {
		if st, err := s.c.Stat(p); err == nil {
			e.IsDir = st.IsDir()
			e.Size = st.Size()
		}
	}
	return e, nil
}

func (s *SFTPFS) Mkdir(p string) error { return s.c.MkdirAll(p) }

func (s *SFTPFS) Remove(p string) error {
	fi, err := s.c.Lstat(p)
	if err != nil {
		return err
	}
	if fi.IsDir() {
		infos, err := s.c.ReadDir(p)
		if err != nil {
			return err
		}
		for _, c := range infos {
			if err := s.Remove(path.Join(p, c.Name())); err != nil {
				return err
			}
		}
		return s.c.RemoveDirectory(p)
	}
	return s.c.Remove(p)
}

func (s *SFTPFS) RemoveEmptyDir(p string) error { return s.c.RemoveDirectory(p) }

func (s *SFTPFS) Rename(oldp, newp string) error {
	if err := s.c.PosixRename(oldp, newp); err == nil {
		return nil
	}
	return s.c.Rename(oldp, newp)
}

func (s *SFTPFS) Chmod(p string, mode os.FileMode) error { return s.c.Chmod(p, mode) }

func (s *SFTPFS) Open(p string) (io.ReadCloser, error) {
	f, err := s.c.Open(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *SFTPFS) Create(p string) (io.WriteCloser, error) {
	f, err := s.c.Create(p)
	if err != nil {
		return nil, err
	}
	return f, nil
}

func (s *SFTPFS) OpenAt(p string, offset int64) (io.ReadCloser, error) {
	f, err := s.c.Open(p)
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			return nil, err
		}
	}
	return f, nil
}

func (s *SFTPFS) CreateAt(p string, offset int64) (io.WriteCloser, error) {
	f, err := s.c.OpenFile(p, os.O_WRONLY|os.O_CREATE)
	if err != nil {
		return nil, err
	}
	if offset > 0 {
		if _, err := f.Seek(offset, io.SeekStart); err != nil {
			f.Close()
			return nil, err
		}
	} else if err := f.Truncate(0); err != nil {
		f.Close()
		return nil, err
	}
	return f, nil
}

// HostID identifies the SSH host behind this SFTP connection, used to match
// a persisted resume record back to a live connection after a restart.
func (s *SFTPFS) HostID() string { return s.lease.HostID() }

func (s *SFTPFS) Join(elem ...string) string { return path.Join(elem...) }

func (s *SFTPFS) Close() {
	_ = s.c.Close()
	s.lease.Release()
}
