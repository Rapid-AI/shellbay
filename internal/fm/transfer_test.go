package fm

import (
	"os"
	"path/filepath"
	"testing"
	"time"
)

// A directory merge must leave any skipped contents in the original folder.
func TestMoveFolderWithSkip(t *testing.T) {
	src := filepath.Join(t.TempDir(), "folder")
	dst := t.TempDir()
	writeFixture(t, filepath.Join(src, "nested", "conflict"), "source data")
	writeFixture(t, filepath.Join(src, "nested", "unique"), "only in source")
	writeFixture(t, filepath.Join(dst, "folder", "nested", "conflict"), "destination data")

	manager := NewManager()
	id, err := manager.Start("local", "local", []string{src}, dst, true, "skip")
	checkError(t, err)
	waitTransfer(t, manager, id, "done")

	expectFile(t, filepath.Join(src, "nested", "conflict"), "source data")
	expectFile(t, filepath.Join(dst, "folder", "nested", "conflict"), "destination data")
	expectFile(t, filepath.Join(dst, "folder", "nested", "unique"), "only in source")
	expectMissing(t, filepath.Join(src, "nested", "unique"))
}

func TestResumeMove(t *testing.T) {
	for _, tc := range []struct {
		name, partial, result string
	}{
		{"matching prefix", "first", "done"},
		{"unrelated prefix", "wrong", "error"},
	} {
		t.Run(tc.name, func(t *testing.T) {
			src := filepath.Join(t.TempDir(), "file")
			dst := filepath.Join(t.TempDir(), "file")
			const content = "first and second"
			writeFixture(t, src, content)
			writeFixture(t, dst, tc.partial)
			manager := NewManager()
			id, err := manager.ResumeFromRecord("local", "local", ResumeRecord{
				SrcPath: src, DstPath: dst, BytesDone: int64(len(tc.partial)),
				Total: int64(len(content)), Move: true,
			})
			checkError(t, err)
			waitTransfer(t, manager, id, tc.result)

			if tc.result == "done" {
				expectFile(t, dst, content)
				expectMissing(t, src)
			} else {
				expectFile(t, src, content)
				expectFile(t, dst, tc.partial)
			}
		})
	}
}

func waitTransfer(t *testing.T, manager *Manager, id, state string) {
	t.Helper()
	deadline := time.Now().Add(5 * time.Second)
	for time.Now().Before(deadline) {
		for _, job := range manager.List() {
			if job.ID != id {
				continue
			}
			switch job.State {
			case "done", "error", "canceled":
				if job.State != state {
					t.Fatalf("transfer ended in %q, want %q: %s", job.State, state, job.Error)
				}
				return
			}
		}
		time.Sleep(10 * time.Millisecond)
	}
	t.Fatalf("transfer %s did not finish", id)
}

func writeFixture(t *testing.T, name, value string) {
	t.Helper()
	checkError(t, os.MkdirAll(filepath.Dir(name), 0o700))
	checkError(t, os.WriteFile(name, []byte(value), 0o600))
}

func expectFile(t *testing.T, name, want string) {
	t.Helper()
	content, err := os.ReadFile(name)
	checkError(t, err)
	if string(content) != want {
		t.Fatalf("%s contains %q, want %q", name, content, want)
	}
}

func expectMissing(t *testing.T, name string) {
	t.Helper()
	if _, err := os.Stat(name); !os.IsNotExist(err) {
		t.Fatalf("%s should no longer exist: %v", name, err)
	}
}

func checkError(t *testing.T, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}
