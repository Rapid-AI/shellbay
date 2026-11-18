//go:build darwin || linux

package fm

import (
	"os"
	"syscall"
)

// localOwner reads the uid off a local file's os.FileInfo and resolves it to
// a username, mirroring what `ls -l` shows.
func localOwner(fi os.FileInfo) string {
	if st, ok := fi.Sys().(*syscall.Stat_t); ok {
		return lookupUser(st.Uid)
	}
	return ""
}
