package main

import (
	"errors"
	"io"
	"os"
	"path/filepath"
	"regexp"
	"sort"
	"strings"
)

const maxLogReadBytes = 8 << 20 // 8MB

// LogInfo describes one saved session log file.
type LogInfo struct {
	Name    string `json:"name"`
	Label   string `json:"label"`
	Size    int64  `json:"size"`
	ModTime int64  `json:"modTime"`
}

var logNamePattern = regexp.MustCompile(`^(.*)-(\d{8}-\d{6})\.log$`)

func (a *App) logsDir() string { return filepath.Join(a.dataDir, "logs") }

// LogList returns saved session logs, newest first.
func (a *App) LogList() ([]LogInfo, error) {
	dir := a.logsDir()
	ents, err := os.ReadDir(dir)
	if err != nil {
		if os.IsNotExist(err) {
			return []LogInfo{}, nil
		}
		return nil, err
	}
	out := make([]LogInfo, 0, len(ents))
	for _, e := range ents {
		if e.IsDir() || !strings.HasSuffix(e.Name(), ".log") {
			continue
		}
		fi, err := e.Info()
		if err != nil {
			continue
		}
		label := strings.TrimSuffix(e.Name(), ".log")
		if m := logNamePattern.FindStringSubmatch(e.Name()); m != nil {
			label = strings.ReplaceAll(m[1], "_", " ")
		}
		out = append(out, LogInfo{Name: e.Name(), Label: label, Size: fi.Size(), ModTime: fi.ModTime().UnixMilli()})
	}
	sort.Slice(out, func(i, j int) bool { return out[i].ModTime > out[j].ModTime })
	return out, nil
}

func (a *App) logPath(name string) (string, error) {
	if name == "" || strings.ContainsAny(name, "/\\") || !strings.HasSuffix(name, ".log") {
		return "", errors.New("invalid log file name")
	}
	return filepath.Join(a.logsDir(), name), nil
}

// LogRead returns the content of one log file (capped, with a truncation
// notice if the file is larger than the cap).
func (a *App) LogRead(name string) (string, error) {
	p, err := a.logPath(name)
	if err != nil {
		return "", err
	}
	f, err := os.Open(p)
	if err != nil {
		return "", err
	}
	defer f.Close()
	data, err := io.ReadAll(io.LimitReader(f, maxLogReadBytes+1))
	if err != nil {
		return "", err
	}
	if len(data) > maxLogReadBytes {
		return string(data[:maxLogReadBytes]) + "\n\n… log truncated, file is larger than 8 MB …", nil
	}
	return string(data), nil
}

// LogDelete removes one saved log file.
func (a *App) LogDelete(name string) error {
	p, err := a.logPath(name)
	if err != nil {
		return err
	}
	return os.Remove(p)
}

// LogReveal shows a log file in Finder.
func (a *App) LogReveal(name string) error {
	p, err := a.logPath(name)
	if err != nil {
		return err
	}
	return a.RevealPath(p)
}
