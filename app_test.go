package main

import (
	"os"
	"path/filepath"
	"testing"
)

func TestResolveDataDirMigratesExistingProfile(t *testing.T) {
	root := t.TempDir()
	old := filepath.Join(root, "Harbor")
	current := filepath.Join(root, appName)
	if err := os.Mkdir(old, 0o700); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(old, "vault.hrb"), []byte("existing vault"), 0o600); err != nil {
		t.Fatal(err)
	}

	if got := resolveDataDir(root); got != current {
		t.Fatalf("resolveDataDir = %q, want %q", got, current)
	}
	payload, err := os.ReadFile(filepath.Join(current, "vault.hrb"))
	if err != nil || string(payload) != "existing vault" {
		t.Fatalf("vault after migration: %q, %v", payload, err)
	}
	// When both folders exist, the new profile must win without merging or overwriting.
	if err := os.Mkdir(old, 0o700); err != nil {
		t.Fatal(err)
	}
	if got := resolveDataDir(root); got != current {
		t.Fatalf("resolveDataDir = %q with both profiles present, want %q", got, current)
	}
}
