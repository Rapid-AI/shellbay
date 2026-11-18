package fm

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"time"
)

// moveToSystemTrash implements the freedesktop.org Trash specification
// (https://specifications.freedesktop.org/trash-spec/trashspec-latest.html):
// the file is moved under $XDG_DATA_HOME/Trash/files and a sibling
// .trashinfo record is written under Trash/info so file managers (Nautilus,
// Dolphin, etc.) can list and restore it.
func moveToSystemTrash(p string) error {
	base := os.Getenv("XDG_DATA_HOME")
	if base == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return err
		}
		base = filepath.Join(home, ".local", "share")
	}
	trashDir := filepath.Join(base, "Trash")
	filesDir := filepath.Join(trashDir, "files")
	infoDir := filepath.Join(trashDir, "info")
	if err := os.MkdirAll(filesDir, 0o700); err != nil {
		return err
	}
	if err := os.MkdirAll(infoDir, 0o700); err != nil {
		return err
	}

	name := filepath.Base(p)
	dest := filepath.Join(filesDir, name)
	infoPath := filepath.Join(infoDir, name+".trashinfo")
	for i := 1; pathExists(dest) || pathExists(infoPath); i++ {
		name = fmt.Sprintf("%s-%d", filepath.Base(p), i)
		dest = filepath.Join(filesDir, name)
		infoPath = filepath.Join(infoDir, name+".trashinfo")
	}

	abs, err := filepath.Abs(p)
	if err != nil {
		abs = p
	}
	info := fmt.Sprintf("[Trash Info]\nPath=%s\nDeletionDate=%s\n",
		escapeTrashPath(abs), time.Now().Format("2006-01-02T15:04:05"))
	if err := os.WriteFile(infoPath, []byte(info), 0o600); err != nil {
		return err
	}
	if err := os.Rename(p, dest); err != nil {
		_ = os.Remove(infoPath)
		return err
	}
	return nil
}

func pathExists(p string) bool {
	_, err := os.Lstat(p)
	return err == nil
}

// escapeTrashPath percent-encodes p per RFC 2396, as the Trash spec requires
// for the Path field of a .trashinfo file.
func escapeTrashPath(p string) string {
	var b strings.Builder
	for i := 0; i < len(p); i++ {
		c := p[i]
		switch {
		case c >= 'A' && c <= 'Z', c >= 'a' && c <= 'z', c >= '0' && c <= '9',
			c == '/', c == '-', c == '_', c == '.', c == '~':
			b.WriteByte(c)
		default:
			fmt.Fprintf(&b, "%%%02X", c)
		}
	}
	return b.String()
}
