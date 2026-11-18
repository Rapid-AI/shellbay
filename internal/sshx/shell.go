package sshx

import (
	"context"
	"errors"
	"regexp"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
)

// Shell is a raw interactive SSH session for expect-style automation. Unlike
// Terminals, its output is captured privately (not broadcast through a
// shared OnData callback) so a flow can run in the background without its
// bytes leaking into any visible terminal tab's event stream.
type Shell struct {
	lease *Lease
	sess  *ssh.Session
	stdin interface{ Write([]byte) (int, error) }

	mu   sync.Mutex
	buf  []byte
	pos  int
	done chan struct{}
}

type shellWriter struct{ s *Shell }

func (w *shellWriter) Write(p []byte) (int, error) {
	w.s.mu.Lock()
	w.s.buf = append(w.s.buf, p...)
	w.s.mu.Unlock()
	return len(p), nil
}

// OpenShell starts a hidden interactive shell on the host for automation use.
func (m *Manager) OpenShell(hostID string) (*Shell, error) {
	lease, err := m.Acquire(hostID)
	if err != nil {
		return nil, err
	}
	sess, err := lease.Client().NewSession()
	if err != nil {
		lease.Release()
		return nil, err
	}
	modes := ssh.TerminalModes{ssh.ECHO: 0, ssh.TTY_OP_ISPEED: 38400, ssh.TTY_OP_OSPEED: 38400}
	if err := sess.RequestPty("xterm-256color", 40, 200, modes); err != nil {
		_ = sess.Close()
		lease.Release()
		return nil, err
	}
	stdin, err := sess.StdinPipe()
	if err != nil {
		_ = sess.Close()
		lease.Release()
		return nil, err
	}
	s := &Shell{lease: lease, sess: sess, stdin: stdin, done: make(chan struct{})}
	sess.Stdout = &shellWriter{s: s}
	sess.Stderr = &shellWriter{s: s}
	if err := sess.Shell(); err != nil {
		_ = sess.Close()
		lease.Release()
		return nil, err
	}
	go func() {
		_ = sess.Wait()
		close(s.done)
	}()
	m.Touch(hostID)
	return s, nil
}

// Write sends bytes to the shell's stdin.
func (s *Shell) Write(p []byte) error {
	_, err := s.stdin.Write(p)
	return err
}

// WaitFor blocks until pattern (a regexp) matches output received since the
// last successful WaitFor, the timeout elapses, ctx is cancelled, or the
// session ends. It returns the full match.
func (s *Shell) WaitFor(ctx context.Context, pattern string, timeout time.Duration) (string, error) {
	re, err := regexp.Compile(pattern)
	if err != nil {
		return "", err
	}
	if timeout <= 0 {
		timeout = 30 * time.Second
	}
	deadline := time.Now().Add(timeout)
	t := time.NewTicker(20 * time.Millisecond)
	defer t.Stop()
	sessionEnded := false
	for {
		s.mu.Lock()
		if loc := re.FindIndex(s.buf[s.pos:]); loc != nil {
			match := string(s.buf[s.pos+loc[0] : s.pos+loc[1]])
			s.pos += loc[1]
			s.mu.Unlock()
			return match, nil
		}
		s.mu.Unlock()
		if sessionEnded {
			// Give the buffer one last check (above) in case the pattern was
			// the final thing printed before the session closed, then give up.
			return "", errors.New("session ended before the pattern matched")
		}
		select {
		case <-ctx.Done():
			return "", ctx.Err()
		case <-s.done:
			sessionEnded = true
		case <-t.C:
			if time.Now().After(deadline) {
				return "", errors.New("timed out waiting for pattern")
			}
		}
	}
}

// Close ends the session and releases the underlying connection.
func (s *Shell) Close() {
	_ = s.sess.Close()
	s.lease.Release()
}
