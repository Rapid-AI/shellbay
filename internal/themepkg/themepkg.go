// Package themepkg manages user-installed UI theme files on disk. Shell Bay's
// built-in themes (classic-dark/light, simple-dark/light) ship inside the
// frontend bundle and never touch this package — this is only the store for
// themes a user installs from a .json file, so they survive reinstalls and
// can be listed/removed without reaching into the vault.
package themepkg

import (
	"encoding/json"
	"errors"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

// idPattern mirrors the slug conventions used elsewhere in this codebase
// (see app_suggest.go's commandNamePattern): lowercase, digits, hyphens,
// must start alphanumeric. Keeps filenames predictable and rules out path
// traversal without needing to sanitize separately.
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)

// reservedIDs are the built-in theme ids a user theme must not collide with.
var reservedIDs = map[string]bool{
	"classic-dark": true, "classic-light": true,
	"simple-dark": true, "simple-light": true,
}

// Manifest is a theme file's shape. Colors keys are bare CSS custom-property
// names (no leading "--") matching frontend/src/style.css's token set;
// unlisted keys fall back to the Base scheme's value. Terminal, if present,
// mirrors themes.ts's TermTheme.theme shape and is passed through as-is —
// this package doesn't interpret it.
type Manifest struct {
	ID     string `json:"id"`
	Name   string `json:"name"`
	Author string `json:"author,omitempty"`
	Base   string `json:"base"` // "dark" | "light"
	// Family links this theme to a dark/light counterpart for the frontend's
	// adaptive light/dark/system picker (see themeEngine.ts's resolveTheme).
	// Reserved names ("classic", "simple") are blocked below since those
	// belong to the built-in pairs; an installed theme can still declare its
	// own family to pair up two of its own theme files.
	Family   string            `json:"family,omitempty"`
	Colors   map[string]string `json:"colors"`
	Radii    map[string]string `json:"radii,omitempty"`
	Terminal map[string]string `json:"terminal,omitempty"`
}

var reservedFamilies = map[string]bool{"classic": true, "simple": true}

func (m Manifest) validate() error {
	if !idPattern.MatchString(m.ID) {
		return errors.New("theme id must be lowercase letters, digits, hyphens (max 64 chars)")
	}
	if reservedIDs[m.ID] {
		return errors.New("theme id \"" + m.ID + "\" is reserved for a built-in theme")
	}
	if reservedFamilies[m.Family] {
		return errors.New("theme family \"" + m.Family + "\" is reserved for a built-in theme family")
	}
	if strings.TrimSpace(m.Name) == "" {
		return errors.New("theme is missing a name")
	}
	if m.Base != "dark" && m.Base != "light" {
		return errors.New(`theme "base" must be "dark" or "light"`)
	}
	return nil
}

// Store manages the on-disk directory of user-installed theme files.
type Store struct{ dir string }

// New returns a Store rooted at dir (created lazily on first write).
func New(dir string) *Store { return &Store{dir: dir} }

func (s *Store) path(id string) string { return filepath.Join(s.dir, id+".json") }

// List returns every installed theme, sorted by name. Files that fail to
// parse or validate are skipped rather than failing the whole listing.
func (s *Store) List() ([]Manifest, error) {
	entries, err := os.ReadDir(s.dir)
	if errors.Is(err, os.ErrNotExist) {
		return []Manifest{}, nil
	}
	if err != nil {
		return nil, err
	}
	out := make([]Manifest, 0, len(entries))
	for _, e := range entries {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".json") {
			continue
		}
		b, err := os.ReadFile(filepath.Join(s.dir, e.Name()))
		if err != nil {
			continue
		}
		var m Manifest
		if json.Unmarshal(b, &m) != nil || m.validate() != nil {
			continue
		}
		out = append(out, m)
	}
	sort.Slice(out, func(i, j int) bool { return out[i].Name < out[j].Name })
	return out, nil
}

// InstallFile validates the theme at srcPath and copies it into the store,
// named after its own id (overwriting a prior install of the same id).
func (s *Store) InstallFile(srcPath string) (Manifest, error) {
	b, err := os.ReadFile(srcPath)
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return Manifest{}, errors.New("not a valid theme file: " + err.Error())
	}
	if err := m.validate(); err != nil {
		return Manifest{}, err
	}
	if err := os.MkdirAll(s.dir, 0o700); err != nil {
		return Manifest{}, err
	}
	norm, err := json.MarshalIndent(m, "", "  ")
	if err != nil {
		return Manifest{}, err
	}
	if err := os.WriteFile(s.path(m.ID), norm, 0o600); err != nil {
		return Manifest{}, err
	}
	return m, nil
}

// Delete removes an installed theme. Refuses reserved (built-in) ids.
func (s *Store) Delete(id string) error {
	if reservedIDs[id] {
		return errors.New("built-in themes can't be deleted")
	}
	if !idPattern.MatchString(id) {
		return errors.New("invalid theme id")
	}
	err := os.Remove(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
