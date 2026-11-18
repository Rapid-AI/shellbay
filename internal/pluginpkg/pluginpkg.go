// Package pluginpkg manages user-installed plugin files on disk. A plugin is
// a JSON manifest with either JavaScript for a frontend Web Worker or a
// declarative command dictionary. Go validates and stores either format.
package pluginpkg

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
// (see app_suggest.go's commandNamePattern, internal/themepkg's idPattern).
var idPattern = regexp.MustCompile(`^[a-z0-9][a-z0-9-]{0,63}$`)
var commandPattern = regexp.MustCompile(`^[a-zA-Z0-9_./-]{1,40}$`)

// knownCapabilities is the allow-list of capability names a manifest may
// declare. An unknown name fails validation loudly at install time instead
// of silently doing nothing — see Manifest.validate.
var knownCapabilities = map[string]bool{
	"suggest.commands": true,
}

// maxCodeBytes keeps a plugin's inlined JS source bounded; v1 plugins are
// small rule sets, not real programs.
const maxCodeBytes = 256 * 1024

// Suggestion is one flag or subcommand displayed by the terminal.
type Suggestion struct {
	Flag string `json:"flag"`
	Desc string `json:"desc"`
}

// Manifest is a plugin file's shape.
type Manifest struct {
	ID           string   `json:"id"`
	Name         string   `json:"name"`
	Version      string   `json:"version"`
	Author       string   `json:"author,omitempty"`
	Capabilities []string `json:"capabilities"`
	// Code is the plugin's JS source, run inside a sandboxed Web Worker on
	// the frontend with no access to window, the DOM, or the Wails bridge.
	Code string `json:"code,omitempty"`
	// Commands supplies suggestions without running JavaScript.
	Commands map[string][]Suggestion `json:"commands,omitempty"`
}

func (m Manifest) validate() error {
	if !idPattern.MatchString(m.ID) {
		return errors.New("plugin id must be lowercase letters, digits, hyphens (max 64 chars)")
	}
	if strings.TrimSpace(m.Name) == "" {
		return errors.New("plugin is missing a name")
	}
	if strings.TrimSpace(m.Version) == "" {
		return errors.New("plugin is missing a version")
	}
	if len(m.Capabilities) == 0 {
		return errors.New("plugin must declare at least one capability")
	}
	for _, c := range m.Capabilities {
		if !knownCapabilities[c] {
			return errors.New("unknown capability \"" + c + "\"")
		}
	}
	if (strings.TrimSpace(m.Code) == "") == (len(m.Commands) == 0) {
		return errors.New("plugin must provide either code or a command dictionary")
	}
	if len(m.Code) > maxCodeBytes {
		return errors.New("plugin code is too large")
	}
	if len(m.Commands) > 0 {
		return validateCommands(m.Commands)
	}
	return nil
}

func validateCommands(commands map[string][]Suggestion) error {
	payload, err := json.Marshal(commands)
	if err != nil {
		return err
	}
	if len(payload) > maxCodeBytes {
		return errors.New("command dictionary is too large")
	}
	for command, entries := range commands {
		if !commandPattern.MatchString(command) || len(entries) == 0 {
			return errors.New("invalid command dictionary entry: " + command)
		}
		for _, entry := range entries {
			if strings.TrimSpace(entry.Flag) == "" || strings.ContainsAny(entry.Flag, "\r\n\x00") {
				return errors.New("invalid suggestion for " + command)
			}
		}
	}
	return nil
}

// Store manages the on-disk directory of installed plugin files.
type Store struct{ dir string }

// New returns a Store rooted at dir (created lazily on first write).
func New(dir string) *Store { return &Store{dir: dir} }

func (s *Store) path(id string) string { return filepath.Join(s.dir, id+".json") }

// List returns every installed plugin, sorted by name. Files that fail to
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

// InstallFile validates the plugin at srcPath and copies it into the store,
// named after its own id (overwriting a prior install of the same id).
func (s *Store) InstallFile(srcPath string) (Manifest, error) {
	b, err := os.ReadFile(srcPath)
	if err != nil {
		return Manifest{}, err
	}
	var m Manifest
	if err := json.Unmarshal(b, &m); err != nil {
		return Manifest{}, errors.New("not a valid plugin file: " + err.Error())
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

// Delete removes an installed plugin.
func (s *Store) Delete(id string) error {
	if !idPattern.MatchString(id) {
		return errors.New("invalid plugin id")
	}
	err := os.Remove(s.path(id))
	if errors.Is(err, os.ErrNotExist) {
		return nil
	}
	return err
}
