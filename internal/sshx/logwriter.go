package sshx

import (
	"os"
	"regexp"
	"strings"
	"sync"
	"time"
)

// ansiRe matches common ANSI/VT100 escape sequences (CSI codes, OSC
// sequences, and single-byte C1 escapes) so "plain" log mode can strip them.
var ansiRe = regexp.MustCompile(`\x1b(?:\[[0-9;?]*[a-zA-Z]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[@-Z\\-_])`)

// logWriter buffers a terminal's output stream line by line (split on '\n')
// so it can, for "plain" log mode, strip ANSI color/cursor codes and
// collapse same-line carriage-return redraws (progress bars, spinners) down
// to their final state before writing to the session's log file. "raw" mode
// writes bytes through unchanged. Optionally prefixes each line with a
// wall-clock timestamp, SecureCRT-style.
type logWriter struct {
	mu         sync.Mutex
	f          *os.File
	plain      bool
	timestamps bool
	buf        []byte
}

func newLogWriter(f *os.File, plain, timestamps bool) *logWriter {
	if f == nil {
		return nil
	}
	return &logWriter{f: f, plain: plain, timestamps: timestamps}
}

func (w *logWriter) Write(p []byte) (int, error) {
	if w == nil {
		return len(p), nil
	}
	w.mu.Lock()
	defer w.mu.Unlock()
	w.buf = append(w.buf, p...)
	for {
		i := indexByte(w.buf, '\n')
		if i < 0 {
			break
		}
		w.writeLine(w.buf[:i+1])
		w.buf = w.buf[i+1:]
	}
	return len(p), nil
}

func indexByte(b []byte, c byte) int {
	for i, x := range b {
		if x == c {
			return i
		}
	}
	return -1
}

func (w *logWriter) writeLine(line []byte) {
	s := string(line)
	if w.plain {
		s = ansiRe.ReplaceAllString(s, "")
		if i := strings.LastIndexByte(s, '\r'); i >= 0 {
			s = s[i+1:]
		}
		s = stripControl(s)
		if !strings.HasSuffix(s, "\n") {
			s += "\n"
		}
	}
	if w.timestamps {
		_, _ = w.f.WriteString("[" + time.Now().Format("15:04:05") + "] ")
	}
	_, _ = w.f.WriteString(s)
}

func stripControl(s string) string {
	var b strings.Builder
	b.Grow(len(s))
	for _, r := range s {
		if r == '\n' || r == '\t' || r >= 0x20 {
			b.WriteRune(r)
		}
	}
	return b.String()
}

// Close flushes any trailing partial line (no final '\n' when the session
// ended) and closes the underlying file.
func (w *logWriter) Close() {
	if w == nil {
		return
	}
	w.mu.Lock()
	if len(w.buf) > 0 {
		w.writeLine(w.buf)
		w.buf = nil
	}
	w.mu.Unlock()
	_ = w.f.Close()
}
