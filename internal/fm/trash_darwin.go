package fm

import (
	"fmt"
	"os/exec"
	"strings"
)

// moveToSystemTrash asks Finder to delete p, which moves it to the Trash
// (so it stays recoverable, unlike os.Remove).
func moveToSystemTrash(p string) error {
	esc := strings.NewReplacer(`\`, `\\`, `"`, `\"`).Replace(p)
	script := fmt.Sprintf(`tell application "Finder" to delete POSIX file "%s"`, esc)
	return exec.Command("osascript", "-e", script).Run()
}
