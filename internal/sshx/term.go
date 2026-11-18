package sshx

import (
	"errors"
	"fmt"
	"os"
	"os/exec"
	"path/filepath"
	"regexp"
	goruntime "runtime"
	"sync"
	"time"

	"github.com/creack/pty"
	"golang.org/x/crypto/ssh"

	"shellbay/internal/vault"
)

type term struct {
	write  func([]byte) error
	resize func(rows, cols int) error
	close  func()
	logw   *logWriter
}

// Terminals manages interactive sessions.
type Terminals struct {
	mgr     *Manager
	mu      sync.Mutex
	items   map[string]*term
	LogDir  string
	OnData  func(id string, data []byte)
	OnClose func(id string, reason string)
}

// NewTerminals creates a terminal manager.
func NewTerminals(m *Manager) *Terminals {
	return &Terminals{mgr: m, items: map[string]*term{}}
}

type emitWriter struct {
	t  *Terminals
	id string
	tm *term
	mu sync.Mutex
}

func (w *emitWriter) Write(p []byte) (int, error) {
	w.mu.Lock()
	defer w.mu.Unlock()
	if w.tm != nil {
		_, _ = w.tm.logw.Write(p)
	}
	if w.t.OnData != nil {
		w.t.OnData(w.id, append([]byte(nil), p...))
	}
	return len(p), nil
}

var unsafeName = regexp.MustCompile(`[^A-Za-z0-9._-]+`)

func (t *Terminals) openLog(label string) *logWriter {
	s := t.mgr.v.Settings()
	if !s.LogSessions || t.LogDir == "" {
		return nil
	}
	if err := os.MkdirAll(t.LogDir, 0o700); err != nil {
		return nil
	}
	name := fmt.Sprintf("%s-%s.log", unsafeName.ReplaceAllString(label, "_"), time.Now().Format("20060102-150405"))
	f, err := os.OpenFile(filepath.Join(t.LogDir, name), os.O_CREATE|os.O_WRONLY|os.O_APPEND, 0o600)
	if err != nil {
		return nil
	}
	return newLogWriter(f, s.LogFormat != "raw", s.LogTimestamps)
}

func (t *Terminals) register(id string, tm *term) {
	t.mu.Lock()
	t.items[id] = tm
	t.mu.Unlock()
}

func (t *Terminals) finish(id, reason string) {
	t.mu.Lock()
	tm, ok := t.items[id]
	delete(t.items, id)
	t.mu.Unlock()
	if !ok {
		return
	}
	tm.logw.Close()
	if t.OnClose != nil {
		t.OnClose(id, reason)
	}
}

func normSize(rows, cols int) (int, int) {
	if rows <= 0 {
		rows = 24
	}
	if cols <= 0 {
		cols = 80
	}
	return rows, cols
}

// Open starts a remote shell on the host.
func (t *Terminals) Open(hostID string, rows, cols int) (string, error) {
	rows, cols = normSize(rows, cols)
	h, ok := t.mgr.v.Host(hostID)
	if !ok {
		return "", errors.New("host not found")
	}
	lease, err := t.mgr.Acquire(hostID)
	if err != nil {
		return "", err
	}
	sess, err := lease.Client().NewSession()
	if err != nil {
		lease.Release()
		return "", err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 1, ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
	if err := sess.RequestPty("xterm-256color", rows, cols, modes); err != nil {
		_ = sess.Close()
		lease.Release()
		return "", err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		lease.Release()
		return "", err
	}
	id := vault.NewID()
	tm := &term{logw: t.openLog(h.Label)}
	w := &emitWriter{t: t, id: id, tm: tm}
	sess.Stdout = w
	sess.Stderr = w
	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		lease.Release()
		return "", err
	}
	tm.write = func(b []byte) error { _, err := stdin.Write(b); return err }
	tm.resize = func(r, c int) error { return sess.WindowChange(r, c) }
	tm.close = func() { _ = sess.Close() }
	t.register(id, tm)
	t.mgr.Touch(hostID)

	go func() {
		err := sess.Wait()
		lease.Release()
		reason := "Session closed"
		if err != nil {
			reason = err.Error()
		}
		t.finish(id, reason)
	}()

	if h.StartupCommand != "" {
		_, _ = stdin.Write([]byte(h.StartupCommand + "\n"))
	}
	return id, nil
}

// localShellCmd builds the command used to start a local interactive shell,
// following each OS's own convention: a login POSIX shell on macOS/Linux
// (so profile/rc files run, matching what Terminal.app/GNOME Terminal do),
// PowerShell (falling back to cmd.exe) on Windows, which has neither a
// $SHELL env var nor a "-l" login flag.
func localShellCmd() *exec.Cmd {
	if goruntime.GOOS == "windows" {
		if comspec := os.Getenv("COMSPEC"); comspec != "" {
			if _, err := exec.LookPath("powershell.exe"); err == nil {
				return exec.Command("powershell.exe", "-NoLogo")
			}
			return exec.Command(comspec)
		}
		return exec.Command("cmd.exe")
	}
	shell := os.Getenv("SHELL")
	if shell == "" {
		shell = "/bin/sh"
		if goruntime.GOOS == "darwin" {
			shell = "/bin/zsh"
		}
	}
	return exec.Command(shell, "-l")
}

// OpenLocal starts a shell on this machine.
func (t *Terminals) OpenLocal(rows, cols int) (string, error) {
	rows, cols = normSize(rows, cols)
	cmd := localShellCmd()
	if home, err := os.UserHomeDir(); err == nil {
		cmd.Dir = home
	}
	env := os.Environ()
	env = append(env, "TERM=xterm-256color", "COLORTERM=truecolor")
	if goruntime.GOOS != "windows" && os.Getenv("LANG") == "" {
		env = append(env, "LANG=en_US.UTF-8")
	}
	cmd.Env = env
	f, err := pty.StartWithSize(cmd, &pty.Winsize{Rows: uint16(rows), Cols: uint16(cols)})
	if err != nil {
		return "", err
	}
	id := vault.NewID()
	tm := &term{
		write: func(b []byte) error { _, err := f.Write(b); return err },
		resize: func(r, c int) error {
			return pty.Setsize(f, &pty.Winsize{Rows: uint16(r), Cols: uint16(c)})
		},
		close: func() {
			_ = f.Close()
			if cmd.Process != nil {
				_ = cmd.Process.Kill()
			}
		},
		logw: t.openLog("Local shell"),
	}
	t.register(id, tm)
	go func() {
		buf := make([]byte, 32*1024)
		for {
			n, err := f.Read(buf)
			if n > 0 {
				_, _ = tm.logw.Write(buf[:n])
				if t.OnData != nil {
					t.OnData(id, append([]byte(nil), buf[:n]...))
				}
			}
			if err != nil {
				break
			}
		}
		_ = cmd.Wait()
		_ = f.Close()
		t.finish(id, "Shell exited")
	}()
	return id, nil
}

func (t *Terminals) get(id string) (*term, error) {
	t.mu.Lock()
	defer t.mu.Unlock()
	tm, ok := t.items[id]
	if !ok {
		return nil, errors.New("session is closed")
	}
	return tm, nil
}

// Write sends input to a session.
func (t *Terminals) Write(id string, data []byte) error {
	tm, err := t.get(id)
	if err != nil {
		return err
	}
	return tm.write(data)
}

// Resize changes the terminal size.
func (t *Terminals) Resize(id string, rows, cols int) error {
	tm, err := t.get(id)
	if err != nil {
		return err
	}
	rows, cols = normSize(rows, cols)
	return tm.resize(rows, cols)
}

// Close terminates a session.
func (t *Terminals) Close(id string) {
	tm, err := t.get(id)
	if err != nil {
		return
	}
	tm.close()
	t.finish(id, "Closed")
}

// CloseAll terminates every session.
func (t *Terminals) CloseAll() {
	t.mu.Lock()
	ids := make([]string, 0, len(t.items))
	for id := range t.items {
		ids = append(ids, id)
	}
	t.mu.Unlock()
	for _, id := range ids {
		t.Close(id)
	}
}
