package sshx

import (
	"encoding/base64"
	"errors"
	"fmt"
	"net"
	"os"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"
	"golang.org/x/crypto/ssh/agent"

	"shellbay/internal/vault"
)

// ErrCancelled is returned when the user dismisses a prompt.
var ErrCancelled = errors.New("cancelled")

// PromptRequest asks the user for input (password, passphrase, host key confirmation...).
type PromptRequest struct {
	Kind    string `json:"kind"` // password | passphrase | otp | hostkey | hostkey-changed
	Title   string `json:"title"`
	Message string `json:"message"`
	Detail  string `json:"detail"`
	Secret  bool   `json:"secret"`
}

// Prompter shows a prompt to the user and returns the answer. Confirmations answer "yes".
type Prompter interface {
	Ask(req PromptRequest) (string, error)
}

// Manager keeps a pool of SSH connections shared by terminals, SFTP and forwards.
type Manager struct {
	v      *vault.Vault
	prompt Prompter
	mu     sync.Mutex
	pool   map[string]*entry
	locks  map[string]*sync.Mutex
}

// NewManager creates a connection manager.
func NewManager(v *vault.Vault, p Prompter) *Manager {
	return &Manager{
		v:      v,
		prompt: p,
		pool:   map[string]*entry{},
		locks:  map[string]*sync.Mutex{},
	}
}

type entry struct {
	hostID  string
	client  *ssh.Client
	refs    int
	jump    *Lease
	cleanup func()
	done    chan struct{}
	once    sync.Once
}

func (e *entry) alive() bool {
	select {
	case <-e.done:
		return false
	default:
		return true
	}
}

// Lease is a counted reference to a pooled connection.
type Lease struct {
	m    *Manager
	e    *entry
	once sync.Once
}

// Client returns the underlying SSH client.
func (l *Lease) Client() *ssh.Client { return l.e.client }

// HostID returns the id of the host this lease is connected to.
func (l *Lease) HostID() string { return l.e.hostID }

// Release drops the reference; the connection closes when nobody uses it.
func (l *Lease) Release() {
	l.once.Do(func() { l.m.release(l.e) })
}

func (m *Manager) hostLock(id string) *sync.Mutex {
	m.mu.Lock()
	defer m.mu.Unlock()
	l, ok := m.locks[id]
	if !ok {
		l = &sync.Mutex{}
		m.locks[id] = l
	}
	return l
}

func (m *Manager) release(e *entry) {
	m.mu.Lock()
	e.refs--
	last := e.refs <= 0
	if last && m.pool[e.hostID] == e {
		delete(m.pool, e.hostID)
	}
	m.mu.Unlock()
	if last {
		m.shutdown(e)
	}
}

func (m *Manager) shutdown(e *entry) {
	e.once.Do(func() {
		close(e.done)
		m.mu.Lock()
		if m.pool[e.hostID] == e {
			delete(m.pool, e.hostID)
		}
		m.mu.Unlock()
		_ = e.client.Close()
		if e.cleanup != nil {
			e.cleanup()
		}
		if e.jump != nil {
			e.jump.Release()
		}
	})
}

func (m *Manager) watch(e *entry) {
	go func() {
		_ = e.client.Wait()
		m.shutdown(e)
	}()
	go func() {
		iv := time.Duration(m.v.Settings().KeepAliveSec) * time.Second
		if iv <= 0 {
			iv = 30 * time.Second
		}
		t := time.NewTicker(iv)
		defer t.Stop()
		for {
			select {
			case <-e.done:
				return
			case <-t.C:
				if _, _, err := e.client.SendRequest("keepalive@openssh.com", true, nil); err != nil {
					m.shutdown(e)
					return
				}
			}
		}
	}()
}

// Acquire returns a lease on a (possibly new) connection to the host.
func (m *Manager) Acquire(hostID string) (*Lease, error) {
	return m.acquire(hostID, map[string]bool{})
}

func (m *Manager) acquire(hostID string, visited map[string]bool) (*Lease, error) {
	if visited[hostID] {
		return nil, errors.New("jump host loop detected")
	}
	visited[hostID] = true

	hl := m.hostLock(hostID)
	hl.Lock()
	defer hl.Unlock()

	m.mu.Lock()
	if e, ok := m.pool[hostID]; ok && e.alive() {
		e.refs++
		m.mu.Unlock()
		return &Lease{m: m, e: e}, nil
	}
	m.mu.Unlock()

	h, ok := m.v.Host(hostID)
	if !ok {
		return nil, errors.New("host not found")
	}
	e, err := m.dial(h, visited)
	if err != nil {
		return nil, err
	}
	m.mu.Lock()
	e.refs = 1
	m.pool[hostID] = e
	m.mu.Unlock()
	m.watch(e)
	return &Lease{m: m, e: e}, nil
}

func (m *Manager) dial(h vault.Host, visited map[string]bool) (*entry, error) {
	cfg, cleanup, err := m.clientConfig(h)
	if err != nil {
		return nil, err
	}
	port := h.Port
	if port == 0 {
		port = 22
	}
	addr := net.JoinHostPort(h.Address, strconv.Itoa(port))

	var jl *Lease
	var conn net.Conn
	if h.JumpHostID != "" {
		jl, err = m.acquire(h.JumpHostID, visited)
		if err != nil {
			cleanup()
			return nil, fmt.Errorf("jump host: %w", err)
		}
		conn, err = jl.Client().Dial("tcp", addr)
		if err != nil {
			jl.Release()
			cleanup()
			return nil, fmt.Errorf("via jump host: %w", err)
		}
	} else {
		conn, err = net.DialTimeout("tcp", addr, 15*time.Second)
		if err != nil {
			cleanup()
			return nil, err
		}
	}

	c, chans, reqs, err := ssh.NewClientConn(conn, addr, cfg)
	if err != nil {
		_ = conn.Close()
		if jl != nil {
			jl.Release()
		}
		cleanup()
		return nil, err
	}
	return &entry{
		hostID:  h.ID,
		client:  ssh.NewClient(c, chans, reqs),
		jump:    jl,
		cleanup: cleanup,
		done:    make(chan struct{}),
	}, nil
}

func (m *Manager) clientConfig(h vault.Host) (*ssh.ClientConfig, func(), error) {
	cleanup := func() {}
	if strings.TrimSpace(h.Username) == "" {
		return nil, cleanup, errors.New("username is required")
	}
	var auths []ssh.AuthMethod
	switch h.AuthType {
	case "key":
		signer, err := m.signerFor(h)
		if err != nil {
			return nil, cleanup, err
		}
		auths = append(auths, ssh.PublicKeys(signer))
	case "agent":
		sock := os.Getenv("SSH_AUTH_SOCK")
		if sock == "" {
			return nil, cleanup, errors.New("ssh-agent is not running (SSH_AUTH_SOCK is empty)")
		}
		ac, err := net.Dial("unix", sock)
		if err != nil {
			return nil, cleanup, fmt.Errorf("cannot reach ssh-agent: %w", err)
		}
		cleanup = func() { _ = ac.Close() }
		auths = append(auths, ssh.PublicKeysCallback(agent.NewClient(ac).Signers))
	default:
		auths = append(auths, m.passwordAuth(h)...)
	}
	cfg := &ssh.ClientConfig{
		User:            h.Username,
		Auth:            auths,
		HostKeyCallback: m.hostKeyCallback(),
		Timeout:         15 * time.Second,
	}
	return cfg, cleanup, nil
}

func (m *Manager) passwordAuth(h vault.Host) []ssh.AuthMethod {
	saved := h.Password
	pw := ssh.RetryableAuthMethod(ssh.PasswordCallback(func() (string, error) {
		if saved != "" {
			p := saved
			saved = ""
			return p, nil
		}
		return m.prompt.Ask(PromptRequest{
			Kind:    "password",
			Title:   "Password required",
			Message: fmt.Sprintf("Password for %s@%s", h.Username, h.Address),
			Secret:  true,
		})
	}), 3)

	kbdSaved := h.Password
	kbd := ssh.RetryableAuthMethod(ssh.KeyboardInteractive(
		func(name, instruction string, questions []string, echos []bool) ([]string, error) {
			answers := make([]string, len(questions))
			for i, q := range questions {
				if i < len(echos) && !echos[i] && kbdSaved != "" && strings.Contains(strings.ToLower(q), "password") {
					answers[i] = kbdSaved
					kbdSaved = ""
					continue
				}
				secret := i < len(echos) && !echos[i]
				a, err := m.prompt.Ask(PromptRequest{
					Kind:    "otp",
					Title:   "Verification required",
					Message: strings.TrimSpace(q),
					Detail:  strings.TrimSpace(instruction),
					Secret:  secret,
				})
				if err != nil {
					return nil, err
				}
				answers[i] = a
			}
			return answers, nil
		}), 3)
	return []ssh.AuthMethod{pw, kbd}
}

func (m *Manager) signerFor(h vault.Host) (ssh.Signer, error) {
	k, ok := m.v.Key(h.KeyID)
	if !ok {
		return nil, errors.New("SSH key not found: choose a key for this host")
	}
	pemBytes := []byte(k.PrivateKey)
	if k.Passphrase != "" {
		return ssh.ParsePrivateKeyWithPassphrase(pemBytes, []byte(k.Passphrase))
	}
	s, err := ssh.ParsePrivateKey(pemBytes)
	var missing *ssh.PassphraseMissingError
	if errors.As(err, &missing) {
		pass, perr := m.prompt.Ask(PromptRequest{
			Kind:    "passphrase",
			Title:   "Key passphrase",
			Message: fmt.Sprintf("Passphrase for key \"%s\"", k.Name),
			Secret:  true,
		})
		if perr != nil {
			return nil, perr
		}
		return ssh.ParsePrivateKeyWithPassphrase(pemBytes, []byte(pass))
	}
	return s, err
}

func (m *Manager) hostKeyCallback() ssh.HostKeyCallback {
	return func(hostname string, remote net.Addr, key ssh.PublicKey) error {
		fp := ssh.FingerprintSHA256(key)
		keyB64 := base64.StdEncoding.EncodeToString(key.Marshal())
		sameType := false
		for _, k := range m.v.KnownFor(hostname) {
			if k.KeyType == key.Type() {
				if k.PublicKey == keyB64 {
					return nil
				}
				sameType = true
			}
		}
		req := PromptRequest{
			Kind:    "hostkey",
			Title:   "Trust this server?",
			Message: fmt.Sprintf("First connection to %s", hostname),
			Detail:  fmt.Sprintf("%s\n%s", key.Type(), fp),
		}
		if sameType {
			req.Kind = "hostkey-changed"
			req.Title = "Host key has changed"
			req.Message = fmt.Sprintf("The key of %s is different from the one you trusted before. This can mean the server was reinstalled, or that someone is intercepting the connection.", hostname)
		}
		ans, err := m.prompt.Ask(req)
		if err != nil || ans != "yes" {
			return errors.New("host key was not accepted")
		}
		return m.v.SaveKnown(vault.KnownHost{
			Host:        hostname,
			KeyType:     key.Type(),
			Fingerprint: fp,
			PublicKey:   keyB64,
		}, sameType)
	}
}

// Touch records that a host was just used.
func (m *Manager) Touch(hostID string) {
	_ = m.v.Update(func(d *vault.Data) error {
		for i := range d.Hosts {
			if d.Hosts[i].ID == hostID {
				d.Hosts[i].LastUsedAt = time.Now().UnixMilli()
			}
		}
		return nil
	})
}

// Exec runs a single command on the host and returns its output.
func (m *Manager) Exec(hostID, cmd string) (string, error) {
	l, err := m.Acquire(hostID)
	if err != nil {
		return "", err
	}
	defer l.Release()
	s, err := l.Client().NewSession()
	if err != nil {
		return "", err
	}
	defer s.Close()
	out, err := s.CombinedOutput(cmd)
	return string(out), err
}

// CloseAll drops every pooled connection.
func (m *Manager) CloseAll() {
	m.mu.Lock()
	list := make([]*entry, 0, len(m.pool))
	for _, e := range m.pool {
		list = append(list, e)
	}
	m.mu.Unlock()
	for _, e := range list {
		m.shutdown(e)
	}
}
