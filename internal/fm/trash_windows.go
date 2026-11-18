package fm

import (
	"fmt"
	"syscall"
	"unsafe"
)

// Flags/opcodes for SHFileOperationW (shell32.dll), per the Windows Shell API.
const (
	foDelete          = 0x0003
	fofAllowUndo      = 0x0040 // send to the Recycle Bin instead of permanently deleting
	fofNoConfirmation = 0x0010
	fofSilent         = 0x0004
)

type shFileOpStructW struct {
	hwnd                  uintptr
	wFunc                 uint32
	pFrom                 *uint16
	pTo                   *uint16
	fFlags                uint16
	fAnyOperationsAborted int32
	hNameMappings         uintptr
	lpszProgressTitle     *uint16
}

// moveToSystemTrash sends p to the Windows Recycle Bin via the shell API, so
// it stays recoverable, unlike os.Remove.
func moveToSystemTrash(p string) error {
	// pFrom is a list of null-terminated strings, itself terminated by an
	// extra NUL (a "double-null-terminated" list), even for a single entry.
	u16, err := syscall.UTF16FromString(p)
	if err != nil {
		return err
	}
	u16 = append(u16, 0)

	op := shFileOpStructW{
		wFunc:  foDelete,
		pFrom:  &u16[0],
		fFlags: fofAllowUndo | fofNoConfirmation | fofSilent,
	}
	shell32 := syscall.NewLazyDLL("shell32.dll")
	ret, _, _ := shell32.NewProc("SHFileOperationW").Call(uintptr(unsafe.Pointer(&op)))
	if ret != 0 {
		return fmt.Errorf("SHFileOperationW: code %d", ret)
	}
	return nil
}
