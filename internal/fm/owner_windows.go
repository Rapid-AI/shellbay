//go:build windows

package fm

import "os"

// localOwner has no cheap equivalent on Windows: os.FileInfo.Sys() returns
// *syscall.Win32FileAttributeData there, which carries no uid/owner — the
// real owner lives in the file's security descriptor and needs separate
// Win32 calls we don't need just for the file manager's listing column.
func localOwner(fi os.FileInfo) string { return "" }
