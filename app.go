package main

import (
	"context"
	"crypto"
	"crypto/ed25519"
	"crypto/rand"
	"crypto/rsa"
	"encoding/base64"
	"encoding/json"
	"encoding/pem"
	"errors"
	"fmt"
	"net"
	"os"
	"os/exec"
	"path/filepath"
	"runtime"
	"strconv"
	"strings"
	"sync"
	"time"

	"golang.org/x/crypto/ssh"

	wruntime "github.com/wailsapp/wails/v2/pkg/runtime"

	"shellbay/internal/exchange"
	"shellbay/internal/flow"
	"shellbay/internal/fm"
	"shellbay/internal/p2p"
	"shellbay/internal/pluginpkg"
	"shellbay/internal/sshx"
	"shellbay/internal/themepkg"
	"shellbay/internal/vault"
)

const (
	appName    = "Shell Bay"
	appVersion = "1.0.0"
)

type promptAnswer struct {
	value  string
	cancel bool
}

type offerAnswer struct {
	accept    bool
	overwrite bool
}

// App is the object exposed to the frontend. Every exported method is callable from JS.
type App struct {
	ctx     context.Context
	dataDir string

	v            *vault.Vault
	ssh          *sshx.Manager
	terms        *sshx.Terminals
	fwd          *sshx.Forwards
	files        *fm.Manager
	share        *p2p.Service
	resumable    *resumeStore
	flows        *flow.Runner
	suggestCache *suggestCache
	themes       *themepkg.Store
	plugins      *pluginpkg.Store

	mu       sync.Mutex
	resumeMu sync.Mutex
	prompts  map[string]chan promptAnswer
	offers   map[string]chan offerAnswer
	sftps    map[string]*fm.SFTPFS
	ftps     map[string]*fm.FTPFS
	flowRuns map[string]context.CancelFunc
}

type uiPrompter struct{ a *App }

// Ask bridges a blocking SSH challenge to a modal in the WebView. A buffered
// response channel allows the UI to answer before the SSH goroutine starts waiting.
func (p *uiPrompter) Ask(req sshx.PromptRequest) (string, error) {
	id := vault.NewID()
	ch := make(chan promptAnswer, 1)
	p.a.mu.Lock()
	p.a.prompts[id] = ch
	p.a.mu.Unlock()
	defer func() {
		p.a.mu.Lock()
		delete(p.a.prompts, id)
		p.a.mu.Unlock()
	}()
	p.a.emit("prompt:request", map[string]any{
		"id": id, "kind": req.Kind, "title": req.Title,
		"message": req.Message, "detail": req.Detail, "secret": req.Secret,
	})
	select {
	case ans := <-ch:
		if ans.cancel {
			return "", sshx.ErrCancelled
		}
		return ans.value, nil
	case <-time.After(3 * time.Minute):
		return "", errors.New("no answer was given in time")
	}
}

// NewApp wires the native services to the Wails bridge. The SSH manager
// grants leases to terminals, forwarding and file panes. The vault owns
// saved configuration, while the managers below own live state.
func NewApp() *App {
	dir, err := os.UserConfigDir()
	if err != nil || dir == "" {
		dir, _ = os.UserHomeDir()
	}
	dir = resolveDataDir(dir)
	_ = os.MkdirAll(dir, 0o700)

	a := &App{
		dataDir:  dir,
		prompts:  map[string]chan promptAnswer{},
		offers:   map[string]chan offerAnswer{},
		sftps:    map[string]*fm.SFTPFS{},
		ftps:     map[string]*fm.FTPFS{},
		flowRuns: map[string]context.CancelFunc{},
	}
	a.v = vault.New(filepath.Join(dir, "vault.hrb"))
	a.ssh = sshx.NewManager(a.v, &uiPrompter{a})
	a.flows = &flow.Runner{SSH: a.ssh}
	a.suggestCache = newSuggestCache()
	a.themes = themepkg.New(filepath.Join(dir, "themes"))
	a.plugins = pluginpkg.New(filepath.Join(dir, "plugins"))

	a.terms = sshx.NewTerminals(a.ssh)
	a.terms.LogDir = filepath.Join(dir, "logs")
	// Base64 preserves arbitrary PTY bytes across Wails' JSON event bridge.
	// The frontend decodes the stream and routes it by session ID.
	a.terms.OnData = func(id string, data []byte) {
		a.emit("term:data", map[string]any{"id": id, "data": base64.StdEncoding.EncodeToString(data)})
	}
	a.terms.OnClose = func(id, reason string) {
		a.emit("term:close", map[string]any{"id": id, "reason": reason})
	}

	a.fwd = sshx.NewForwards(a.ssh)
	a.fwd.OnStatus = func(id, state, msg string) {
		a.emit("fwd:status", map[string]any{"id": id, "state": state, "error": msg})
	}

	a.resumable = newResumeStore(dir)
	a.files = fm.NewManager()
	a.files.OnUpdate = func(j fm.Job) {
		// Persist the record before exposing the Resume action in the UI.
		a.trackResume(j)
		a.emit("transfer:update", j)
	}

	a.share = p2p.NewService(a.v)
	a.share.OnOffer = a.handleOffer
	a.share.OnPeersChanged = func() { a.emit("vault:changed", nil) }
	return a
}

// resolveDataDir moves the entire existing profile on the first launch after
// the rename. A failed rename keeps using the old profile so the user's vault
// and installed extensions still open. An existing new profile always wins.
func resolveDataDir(base string) string {
	current := filepath.Join(base, appName)
	if _, err := os.Lstat(current); !errors.Is(err, os.ErrNotExist) {
		return current
	}
	legacy := filepath.Join(base, "Harbor")
	if info, err := os.Stat(legacy); err == nil && info.IsDir() {
		if err := os.Rename(legacy, current); err != nil {
			return legacy
		}
	}
	return current
}

func (a *App) startup(ctx context.Context) { a.ctx = ctx }

func (a *App) shutdown(ctx context.Context) {
	a.closeEverything()
}

func (a *App) emit(name string, data any) {
	if a.ctx == nil {
		return
	}
	wruntime.EventsEmit(a.ctx, name, data)
}

// closeEverything stops live services before the vault drops its decrypted
// configuration. Release file-system connections outside the map lock so
// that protocol shutdown cannot block unrelated bookkeeping.
func (a *App) closeEverything() {
	a.fwd.StopAll()
	a.terms.CloseAll()
	a.mu.Lock()
	for _, cancel := range a.flowRuns {
		cancel()
	}
	a.flowRuns = map[string]context.CancelFunc{}
	a.mu.Unlock()
	a.mu.Lock()
	list := make([]*fm.SFTPFS, 0, len(a.sftps))
	for id, s := range a.sftps {
		list = append(list, s)
		a.files.Unregister(id)
	}
	a.sftps = map[string]*fm.SFTPFS{}
	a.mu.Unlock()
	for _, s := range list {
		s.Close()
	}
	a.mu.Lock()
	flist := make([]*fm.FTPFS, 0, len(a.ftps))
	for id, s := range a.ftps {
		flist = append(flist, s)
		a.files.Unregister(id)
	}
	a.ftps = map[string]*fm.FTPFS{}
	a.mu.Unlock()
	for _, s := range flist {
		s.Close()
	}
	a.ssh.CloseAll()
	a.share.Stop()
}

// ------------------------------------------------------------------ app info

// AppInfo returns static information for the About section.
func (a *App) AppInfo() map[string]string {
	return map[string]string{"version": appVersion, "dataDir": a.dataDir}
}

// ------------------------------------------------------------------ vault

// VaultStatus is uninitialized, locked or unlocked.
func (a *App) VaultStatus() string {
	switch {
	case a.v.Unlocked():
		return "unlocked"
	case a.v.Exists():
		return "locked"
	}
	return "uninitialized"
}

func (a *App) afterUnlock() {
	if err := a.share.Init(); err != nil {
		return
	}
	s := a.v.Settings()
	if s.ShareEnabled {
		_ = a.share.Start(s.SharePort)
	}
}

// VaultCreate sets the master password on first run.
func (a *App) VaultCreate(password string) error {
	if err := a.v.Create(password); err != nil {
		return err
	}
	a.afterUnlock()
	return nil
}

// VaultUnlock opens the vault.
func (a *App) VaultUnlock(password string) error {
	if err := a.v.Unlock(password); err != nil {
		return err
	}
	a.afterUnlock()
	return nil
}

// VaultLock closes all connections and wipes the keys from memory.
func (a *App) VaultLock() {
	a.closeEverything()
	a.v.Lock()
}

// VaultChangePassword re-encrypts the vault.
func (a *App) VaultChangePassword(oldPw, newPw string) error {
	return a.v.ChangePassword(oldPw, newPw)
}

// GetData returns everything the UI needs (without the P2P private key).
func (a *App) GetData() (vault.Data, error) {
	d, err := a.v.Snapshot()
	if err != nil {
		return d, err
	}
	d.Identity.CertPEM = ""
	d.Identity.KeyPEM = ""
	return d, nil
}

// AnswerPrompt completes a prompt shown by the UI.
func (a *App) AnswerPrompt(id, value string, cancel bool) {
	a.mu.Lock()
	ch := a.prompts[id]
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- promptAnswer{value: value, cancel: cancel}:
		default:
		}
	}
}

// ------------------------------------------------------------------ hosts, groups

// SaveHost creates or updates a host.
func (a *App) SaveHost(h vault.Host) (vault.Host, error) {
	h.Label = strings.TrimSpace(h.Label)
	h.Address = strings.TrimSpace(h.Address)
	h.Username = strings.TrimSpace(h.Username)
	if h.Address == "" {
		return h, errors.New("address is required")
	}
	if h.Label == "" {
		h.Label = h.Address
	}
	if h.Port <= 0 || h.Port > 65535 {
		h.Port = 22
	}
	if h.AuthType != "key" && h.AuthType != "agent" {
		h.AuthType = "password"
	}
	if h.Tags == nil {
		h.Tags = []string{}
	}
	if h.JumpHostID != "" && h.JumpHostID == h.ID {
		h.JumpHostID = ""
	}
	err := a.v.Update(func(d *vault.Data) error {
		if h.ID != "" {
			for i := range d.Hosts {
				if d.Hosts[i].ID == h.ID {
					h.CreatedAt = d.Hosts[i].CreatedAt
					h.LastUsedAt = d.Hosts[i].LastUsedAt
					d.Hosts[i] = h
					return nil
				}
			}
		}
		if h.ID == "" {
			h.ID = vault.NewID()
		}
		h.CreatedAt = time.Now().UnixMilli()
		d.Hosts = append(d.Hosts, h)
		return nil
	})
	return h, err
}

// DeleteHost removes a host and everything that depends on it.
func (a *App) DeleteHost(id string) error {
	var stop []string
	err := a.v.Update(func(d *vault.Data) error {
		hosts := d.Hosts[:0]
		for _, h := range d.Hosts {
			if h.ID != id {
				if h.JumpHostID == id {
					h.JumpHostID = ""
				}
				hosts = append(hosts, h)
			}
		}
		d.Hosts = hosts
		fw := d.Forwards[:0]
		for _, f := range d.Forwards {
			if f.HostID == id {
				stop = append(stop, f.ID)
				continue
			}
			fw = append(fw, f)
		}
		d.Forwards = fw
		return nil
	})
	for _, fid := range stop {
		a.fwd.Stop(fid)
	}
	return err
}

// PingResult is a one-shot TCP reachability + latency probe outcome, for the
// hosts list's status indicator.
type PingResult struct {
	Reachable bool  `json:"reachable"`
	Ms        int64 `json:"ms"`
}

// PingHost dials the host's address:port once. A dead/unreachable host is an
// expected, common outcome here, not a Go error — only a missing host ID
// returns one.
func (a *App) PingHost(id string) (PingResult, error) {
	var h vault.Host
	found := false
	_ = a.v.View(func(d *vault.Data) {
		for _, x := range d.Hosts {
			if x.ID == id {
				h, found = x, true
			}
		}
	})
	if !found {
		return PingResult{}, errors.New("host not found")
	}
	port := h.Port
	if port <= 0 {
		port = 22
	}
	start := time.Now()
	conn, err := net.DialTimeout("tcp", net.JoinHostPort(h.Address, strconv.Itoa(port)), 2500*time.Millisecond)
	if err != nil {
		return PingResult{Reachable: false}, nil
	}
	conn.Close()
	return PingResult{Reachable: true, Ms: time.Since(start).Milliseconds()}, nil
}

// SaveGroup creates or renames a group.
func (a *App) SaveGroup(g vault.Group) (vault.Group, error) {
	g.Name = strings.TrimSpace(g.Name)
	if g.Name == "" {
		return g, errors.New("group name is required")
	}
	err := a.v.Update(func(d *vault.Data) error {
		if g.ID != "" {
			for i := range d.Groups {
				if d.Groups[i].ID == g.ID {
					d.Groups[i] = g
					return nil
				}
			}
		}
		if g.ID == "" {
			g.ID = vault.NewID()
		}
		d.Groups = append(d.Groups, g)
		return nil
	})
	return g, err
}

// DeleteGroup removes a group; its hosts become ungrouped.
func (a *App) DeleteGroup(id string) error {
	return a.v.Update(func(d *vault.Data) error {
		gs := d.Groups[:0]
		for _, g := range d.Groups {
			if g.ID != id {
				gs = append(gs, g)
			}
		}
		d.Groups = gs
		for i := range d.Hosts {
			if d.Hosts[i].GroupID == id {
				d.Hosts[i].GroupID = ""
			}
		}
		return nil
	})
}

// ForgetKnownHost removes a trusted host key.
func (a *App) ForgetKnownHost(host, keyType string) error {
	return a.v.Update(func(d *vault.Data) error {
		out := d.KnownHosts[:0]
		for _, k := range d.KnownHosts {
			if !(k.Host == host && k.KeyType == keyType) {
				out = append(out, k)
			}
		}
		d.KnownHosts = out
		return nil
	})
}

// ------------------------------------------------------------------ keys

func keyFromSigner(name string, pemBytes []byte, signer ssh.Signer) vault.Key {
	pub := signer.PublicKey()
	return vault.Key{
		ID:          vault.NewID(),
		Name:        name,
		Type:        pub.Type(),
		PrivateKey:  string(pemBytes),
		PublicKey:   strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub))) + " " + name,
		Fingerprint: ssh.FingerprintSHA256(pub),
		CreatedAt:   time.Now().UnixMilli(),
	}
}

// KeyGenerate creates a new key pair (ed25519 or rsa).
func (a *App) KeyGenerate(name, keyType, passphrase string) (vault.Key, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return vault.Key{}, errors.New("key name is required")
	}
	var priv crypto.PrivateKey
	if keyType == "rsa" {
		k, err := rsa.GenerateKey(rand.Reader, 4096)
		if err != nil {
			return vault.Key{}, err
		}
		priv = k
	} else {
		_, k, err := ed25519.GenerateKey(rand.Reader)
		if err != nil {
			return vault.Key{}, err
		}
		priv = k
	}
	var block *pem.Block
	var err error
	if passphrase != "" {
		block, err = ssh.MarshalPrivateKeyWithPassphrase(priv, name, []byte(passphrase))
	} else {
		block, err = ssh.MarshalPrivateKey(priv, name)
	}
	if err != nil {
		return vault.Key{}, err
	}
	signer, err := ssh.NewSignerFromKey(priv)
	if err != nil {
		return vault.Key{}, err
	}
	k := keyFromSigner(name, pem.EncodeToMemory(block), signer)
	err = a.v.Update(func(d *vault.Data) error { d.Keys = append(d.Keys, k); return nil })
	return k, err
}

// KeyImport stores an existing private key.
func (a *App) KeyImport(name, pemText, passphrase string) (vault.Key, error) {
	name = strings.TrimSpace(name)
	if name == "" {
		return vault.Key{}, errors.New("key name is required")
	}
	b := []byte(strings.TrimSpace(pemText) + "\n")
	var signer ssh.Signer
	var err error
	if passphrase != "" {
		signer, err = ssh.ParsePrivateKeyWithPassphrase(b, []byte(passphrase))
	} else {
		signer, err = ssh.ParsePrivateKey(b)
	}
	if err != nil {
		var missing *ssh.PassphraseMissingError
		if errors.As(err, &missing) {
			return vault.Key{}, errors.New("this key is encrypted: enter its passphrase")
		}
		return vault.Key{}, fmt.Errorf("not a valid private key: %w", err)
	}
	k := keyFromSigner(name, b, signer)
	err = a.v.Update(func(d *vault.Data) error { d.Keys = append(d.Keys, k); return nil })
	return k, err
}

// KeyRename changes a key's display name.
func (a *App) KeyRename(id, name string) error {
	name = strings.TrimSpace(name)
	if name == "" {
		return errors.New("name cannot be empty")
	}
	return a.v.Update(func(d *vault.Data) error {
		for i := range d.Keys {
			if d.Keys[i].ID == id {
				d.Keys[i].Name = name
			}
		}
		return nil
	})
}

// KeyDelete removes a key and detaches it from hosts.
func (a *App) KeyDelete(id string) error {
	return a.v.Update(func(d *vault.Data) error {
		ks := d.Keys[:0]
		for _, k := range d.Keys {
			if k.ID != id {
				ks = append(ks, k)
			}
		}
		d.Keys = ks
		for i := range d.Hosts {
			if d.Hosts[i].KeyID == id {
				d.Hosts[i].KeyID = ""
			}
		}
		return nil
	})
}

// KeyDeploy appends the public key to ~/.ssh/authorized_keys on a host.
func (a *App) KeyDeploy(keyID, hostID string) (string, error) {
	k, ok := a.v.Key(keyID)
	if !ok {
		return "", errors.New("key not found")
	}
	if k.PublicKey == "" {
		return "", errors.New("the public key of this key is not known")
	}
	pub := strings.NewReplacer("'", "", "\n", "", "\r", "").Replace(k.PublicKey)
	cmd := fmt.Sprintf("mkdir -p ~/.ssh && chmod 700 ~/.ssh && touch ~/.ssh/authorized_keys && "+
		"(grep -qxF '%s' ~/.ssh/authorized_keys || echo '%s' >> ~/.ssh/authorized_keys) && "+
		"chmod 600 ~/.ssh/authorized_keys && echo done", pub, pub)
	out, err := a.ssh.Exec(hostID, cmd)
	if err != nil {
		return "", fmt.Errorf("%v: %s", err, strings.TrimSpace(out))
	}
	return "Key installed on the server", nil
}

// ------------------------------------------------------------------ snippets, forwards, settings

// SaveSnippet creates or updates a snippet.
func (a *App) SaveSnippet(s vault.Snippet) (vault.Snippet, error) {
	s.Name = strings.TrimSpace(s.Name)
	if s.Name == "" || strings.TrimSpace(s.Command) == "" {
		return s, errors.New("name and command are required")
	}
	if s.Tags == nil {
		s.Tags = []string{}
	}
	err := a.v.Update(func(d *vault.Data) error {
		if s.ID != "" {
			for i := range d.Snippets {
				if d.Snippets[i].ID == s.ID {
					d.Snippets[i] = s
					return nil
				}
			}
		}
		if s.ID == "" {
			s.ID = vault.NewID()
		}
		d.Snippets = append(d.Snippets, s)
		return nil
	})
	return s, err
}

// DeleteSnippet removes a snippet.
func (a *App) DeleteSnippet(id string) error {
	return a.v.Update(func(d *vault.Data) error {
		out := d.Snippets[:0]
		for _, s := range d.Snippets {
			if s.ID != id {
				out = append(out, s)
			}
		}
		d.Snippets = out
		return nil
	})
}

// SaveForward creates or updates a port forwarding rule.
func (a *App) SaveForward(f vault.Forward) (vault.Forward, error) {
	if f.HostID == "" {
		return f, errors.New("choose a host")
	}
	if f.Type != "remote" && f.Type != "dynamic" {
		f.Type = "local"
	}
	if f.BindPort <= 0 || f.BindPort > 65535 {
		return f, errors.New("bind port is invalid")
	}
	if f.Type != "dynamic" && (strings.TrimSpace(f.DestAddr) == "" || f.DestPort <= 0 || f.DestPort > 65535) {
		return f, errors.New("destination address and port are required")
	}
	if strings.TrimSpace(f.Name) == "" {
		f.Name = fmt.Sprintf("%s :%d", f.Type, f.BindPort)
	}
	err := a.v.Update(func(d *vault.Data) error {
		if f.ID != "" {
			for i := range d.Forwards {
				if d.Forwards[i].ID == f.ID {
					d.Forwards[i] = f
					return nil
				}
			}
		}
		if f.ID == "" {
			f.ID = vault.NewID()
		}
		d.Forwards = append(d.Forwards, f)
		return nil
	})
	return f, err
}

// DeleteForward stops and removes a rule.
func (a *App) DeleteForward(id string) error {
	a.fwd.Stop(id)
	return a.v.Update(func(d *vault.Data) error {
		out := d.Forwards[:0]
		for _, f := range d.Forwards {
			if f.ID != id {
				out = append(out, f)
			}
		}
		d.Forwards = out
		return nil
	})
}

// FwdStart opens a rule.
func (a *App) FwdStart(id string) error {
	var rule vault.Forward
	found := false
	_ = a.v.View(func(d *vault.Data) {
		for _, f := range d.Forwards {
			if f.ID == id {
				rule, found = f, true
			}
		}
	})
	if !found {
		return errors.New("rule not found")
	}
	return a.fwd.Start(rule)
}

// FwdStop closes a rule.
func (a *App) FwdStop(id string) { a.fwd.Stop(id) }

// FwdRunning lists active rule IDs.
func (a *App) FwdRunning() []string { return a.fwd.Running() }

// SaveSettings stores preferences.
func (a *App) SaveSettings(s vault.Settings) error {
	if s.FontSize < 8 || s.FontSize > 32 {
		s.FontSize = 13
	}
	if s.Scrollback < 1000 {
		s.Scrollback = 1000
	}
	if s.Scrollback > 200000 {
		s.Scrollback = 200000
	}
	if s.KeepAliveSec < 5 {
		s.KeepAliveSec = 30
	}
	return a.v.Update(func(d *vault.Data) error {
		s.ShareEnabled = d.Settings.ShareEnabled
		s.SharePort = d.Settings.SharePort
		d.Settings = s
		return nil
	})
}

// ------------------------------------------------------------------ terminals

// TermOpen starts a remote shell and returns the session ID.
func (a *App) TermOpen(hostID string, rows, cols int) (string, error) {
	id, err := a.terms.Open(hostID, rows, cols)
	if err == nil {
		go a.detectOS(hostID)
	}
	return id, err
}

// detectOS runs a one-shot "uname -s" on a host whose OS hasn't been
// identified yet, best-effort, to drive the small OS badge on host cards.
func (a *App) detectOS(hostID string) {
	h, ok := a.v.Host(hostID)
	if !ok || h.OS != "" {
		return
	}
	out, err := a.ssh.Exec(hostID, "uname -s")
	if err != nil {
		return
	}
	name := strings.ToLower(strings.TrimSpace(strings.SplitN(out, "\n", 2)[0]))
	switch {
	case name == "":
		return
	case strings.Contains(name, "linux"):
		name = "linux"
	case strings.Contains(name, "darwin"):
		name = "darwin"
	case strings.HasPrefix(name, "cygwin"), strings.HasPrefix(name, "mingw"), strings.HasPrefix(name, "msys"):
		name = "windows"
	case strings.Contains(name, "bsd"):
		name = "bsd"
	default:
		name = strings.Fields(name)[0]
	}
	_ = a.v.Update(func(d *vault.Data) error {
		for i := range d.Hosts {
			if d.Hosts[i].ID == hostID {
				d.Hosts[i].OS = name
			}
		}
		return nil
	})
}

// TermOpenLocal starts a shell on this Mac.
func (a *App) TermOpenLocal(rows, cols int) (string, error) {
	return a.terms.OpenLocal(rows, cols)
}

// TermWrite sends keystrokes to a session.
func (a *App) TermWrite(id, data string) error { return a.terms.Write(id, []byte(data)) }

// TermResize informs the PTY about the new size.
func (a *App) TermResize(id string, rows, cols int) error { return a.terms.Resize(id, rows, cols) }

// TermClose ends a session.
func (a *App) TermClose(id string) { a.terms.Close(id) }

// ------------------------------------------------------------------ misc helpers

// PickOpenFile shows a native open dialog.
func (a *App) PickOpenFile(title string) (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{Title: title})
}

// ReadLocalText reads a small local text file (for key import).
func (a *App) ReadLocalText(path string) (string, error) {
	fi, err := os.Stat(path)
	if err != nil {
		return "", err
	}
	if fi.Size() > 1<<20 {
		return "", errors.New("file is too large")
	}
	b, err := os.ReadFile(path)
	return string(b), err
}

// openInFileManager opens path with the OS's default handler (Finder/Explorer/
// the desktop's file manager via xdg-open).
func openInFileManager(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", path).Start()
	case "windows":
		return exec.Command("explorer", filepath.FromSlash(path)).Start()
	default:
		return exec.Command("xdg-open", path).Start()
	}
}

// revealInFileManager shows path selected inside its parent folder.
func revealInFileManager(path string) error {
	switch runtime.GOOS {
	case "darwin":
		return exec.Command("open", "-R", path).Start()
	case "windows":
		return exec.Command("explorer", "/select,", filepath.FromSlash(path)).Start()
	default:
		return exec.Command("xdg-open", filepath.Dir(path)).Start()
	}
}

// OpenPath opens a local file with its default application.
func (a *App) OpenPath(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("path must be absolute")
	}
	return openInFileManager(path)
}

// RevealPath shows a local file in the OS file manager.
func (a *App) RevealPath(path string) error {
	if !filepath.IsAbs(path) {
		return errors.New("path must be absolute")
	}
	return revealInFileManager(path)
}

// OpenDataDir opens Shell Bay's data folder in the OS file manager.
func (a *App) OpenDataDir() error { return openInFileManager(a.dataDir) }

// OpenLogsDir opens the session logs folder.
func (a *App) OpenLogsDir() error {
	dir := filepath.Join(a.dataDir, "logs")
	_ = os.MkdirAll(dir, 0o700)
	return openInFileManager(dir)
}

// Platform reports the host OS ("darwin", "windows", "linux", ...) so the
// frontend can adapt chrome (traffic-light inset, shortcut labels, etc.).
func (a *App) Platform() string { return runtime.GOOS }

// ------------------------------------------------------------------ UI themes

// ThemesList returns every user-installed UI theme (built-ins ship in the
// frontend bundle and aren't listed here).
func (a *App) ThemesList() ([]themepkg.Manifest, error) { return a.themes.List() }

// ThemePickFile shows a native open dialog filtered to theme JSON files.
func (a *App) ThemePickFile() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   "Install theme",
		Filters: []wruntime.FileFilter{{DisplayName: "Shell Bay theme (*.json)", Pattern: "*.json"}},
	})
}

// ThemeImportFile validates and installs a theme file, returning its manifest.
func (a *App) ThemeImportFile(path string) (themepkg.Manifest, error) {
	return a.themes.InstallFile(path)
}

// ThemeDelete removes a user-installed theme (built-ins can't be deleted).
func (a *App) ThemeDelete(id string) error { return a.themes.Delete(id) }

// ------------------------------------------------------------------ plugins

// PluginsList returns every installed plugin. Go never executes a plugin's
// code — it only stores the manifest; the frontend runs it in a sandboxed
// Web Worker (see frontend/src/pluginEngine.ts).
func (a *App) PluginsList() ([]pluginpkg.Manifest, error) { return a.plugins.List() }

// PluginPickFile shows a native open dialog filtered to plugin JSON files.
func (a *App) PluginPickFile() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title:   "Install plugin",
		Filters: []wruntime.FileFilter{{DisplayName: "Shell Bay plugin (*.json)", Pattern: "*.json"}},
	})
}

// PluginImportFile validates and installs a plugin file, returning its manifest.
func (a *App) PluginImportFile(path string) (pluginpkg.Manifest, error) {
	return a.plugins.InstallFile(path)
}

// PluginDelete removes an installed plugin.
func (a *App) PluginDelete(id string) error { return a.plugins.Delete(id) }

// ------------------------------------------------------------------ import / export

// ExportFile asks for a location and writes the selected data. Returns the path ("" if cancelled).
func (a *App) ExportFile(sel exchange.Selection, password string) (string, error) {
	if sel.IncludeSecrets && password == "" {
		return "", errors.New("a file password is required when passwords and private keys are included")
	}
	d, err := a.v.Snapshot()
	if err != nil {
		return "", err
	}
	b := exchange.Build(d, sel)
	data, err := exchange.EncodeFile(b, password)
	if err != nil {
		return "", err
	}
	ext := "json"
	if password != "" {
		ext = "shellbay"
	}
	path, err := wruntime.SaveFileDialog(a.ctx, wruntime.SaveDialogOptions{
		Title:           "Export Shell Bay data",
		DefaultFilename: "shell-bay-export-" + time.Now().Format("2006-01-02") + "." + ext,
		Filters: []wruntime.FileFilter{
			{DisplayName: "Shell Bay export", Pattern: "*.shellbay;*.json"},
		},
	})
	if err != nil || path == "" {
		return "", err
	}
	if err := os.WriteFile(path, data, 0o600); err != nil {
		return "", err
	}
	return path, nil
}

// ImportPick shows an open dialog for export files.
func (a *App) ImportPick() (string, error) {
	return wruntime.OpenFileDialog(a.ctx, wruntime.OpenDialogOptions{
		Title: "Import Shell Bay data",
		Filters: []wruntime.FileFilter{
			{DisplayName: "Shell Bay export (including legacy exports)", Pattern: "*.shellbay;*.harbor;*.json"},
		},
	})
}

// ImportInspect tells whether a file needs a password.
func (a *App) ImportInspect(path string) (bool, error) {
	blob, err := os.ReadFile(path)
	if err != nil {
		return false, err
	}
	if exchange.IsEncrypted(blob) {
		return true, nil
	}
	if _, err := exchange.Parse(blob); err != nil {
		return false, err
	}
	return false, nil
}

// ImportFile merges an export file into the vault.
func (a *App) ImportFile(path, password string, overwrite bool) (exchange.Result, error) {
	blob, err := os.ReadFile(path)
	if err != nil {
		return exchange.Result{}, err
	}
	if exchange.IsEncrypted(blob) && password == "" {
		return exchange.Result{}, errors.New("this file is encrypted: enter its password")
	}
	b, err := exchange.DecodeFile(blob, password)
	if err != nil {
		return exchange.Result{}, err
	}
	return exchange.Apply(a.v, b, overwrite)
}

// ImportSSHConfig reads an OpenSSH config (empty path = ~/.ssh/config).
func (a *App) ImportSSHConfig(path string) (exchange.Result, error) {
	return exchange.ImportSSHConfig(a.v, path)
}

// ------------------------------------------------------------------ team sharing (P2P)

// ShareStatus describes this device in the P2P network.
type ShareStatus struct {
	Listening   bool       `json:"listening"`
	Port        int        `json:"port"`
	DeviceName  string     `json:"deviceName"`
	Fingerprint string     `json:"fingerprint"`
	Addresses   []p2p.Addr `json:"addresses"`
}

// InviteInfo is a freshly created invite.
type InviteInfo struct {
	Code      string `json:"code"`
	Link      string `json:"link"`
	ExpiresAt int64  `json:"expiresAt"`
}

// ShareStatus returns the current P2P state.
func (a *App) ShareStatus() ShareStatus {
	on, port := a.share.Listening()
	if !on {
		port = a.v.Settings().SharePort
	}
	addrs := p2p.LocalAddresses()
	if addrs == nil {
		addrs = []p2p.Addr{}
	}
	return ShareStatus{
		Listening: on, Port: port, DeviceName: a.share.DeviceName(),
		Fingerprint: a.share.Fingerprint(), Addresses: addrs,
	}
}

// ShareEnable starts accepting teammate connections on the given port.
func (a *App) ShareEnable(port int) error {
	if err := a.share.Start(port); err != nil {
		return err
	}
	return a.v.Update(func(d *vault.Data) error {
		d.Settings.ShareEnabled = true
		d.Settings.SharePort = port
		return nil
	})
}

// ShareDisable stops accepting teammate connections.
func (a *App) ShareDisable() error {
	a.share.Stop()
	return a.v.Update(func(d *vault.Data) error { d.Settings.ShareEnabled = false; return nil })
}

// ShareSetName renames this device.
func (a *App) ShareSetName(name string) error { return a.share.SetDeviceName(name) }

// ShareInvite creates a one-time invite for the given local IP address.
func (a *App) ShareInvite(address string) (InviteInfo, error) {
	address = strings.TrimSpace(address)
	if address == "" {
		return InviteInfo{}, errors.New("choose the address teammates will connect to")
	}
	code, exp, err := a.share.CreateInvite()
	if err != nil {
		return InviteInfo{}, err
	}
	_, port := a.share.Listening()
	link := fmt.Sprintf("%s%s/%s", p2p.InvitePrefix, net.JoinHostPort(address, strconv.Itoa(port)), code)
	return InviteInfo{Code: code, Link: link, ExpiresAt: exp.UnixMilli()}, nil
}

// ShareJoin pairs with a teammate using their invite link.
func (a *App) ShareJoin(link string) (vault.Peer, error) { return a.share.Join(link) }

// ShareRemovePeer unpairs a teammate.
func (a *App) ShareRemovePeer(id string) error { return a.share.RemovePeer(id) }

// ShareSetPeerAddress sets the host:port used to reach a teammate.
func (a *App) ShareSetPeerAddress(id, addr string) error { return a.share.SetPeerAddress(id, addr) }

// ShareSend pushes the selected data to a teammate and waits for their answer.
func (a *App) ShareSend(peerID string, sel exchange.Selection) (string, error) {
	d, err := a.v.Snapshot()
	if err != nil {
		return "", err
	}
	b := exchange.Build(d, sel)
	if len(b.Hosts)+len(b.Keys)+len(b.Snippets)+len(b.Flows)+len(b.Forwards) == 0 {
		return "", errors.New("nothing selected")
	}
	raw, err := json.Marshal(b)
	if err != nil {
		return "", err
	}
	summary := fmt.Sprintf("%d hosts, %d keys, %d snippets, %d flows, %d port rules", len(b.Hosts), len(b.Keys), len(b.Snippets), len(b.Flows), len(b.Forwards))
	if b.HasSecrets() {
		summary += " (with passwords or private keys)"
	}
	ok, msg, err := a.share.Send(peerID, summary, raw)
	if err != nil {
		return "", err
	}
	if !ok {
		if msg == "" {
			msg = "Declined"
		}
		return "", errors.New(msg)
	}
	return msg, nil
}

func (a *App) handleOffer(from, summary string, raw []byte) (bool, string) {
	b, err := exchange.Parse(raw)
	if err != nil {
		return false, err.Error()
	}
	id := vault.NewID()
	ch := make(chan offerAnswer, 1)
	a.mu.Lock()
	a.offers[id] = ch
	a.mu.Unlock()
	defer func() {
		a.mu.Lock()
		delete(a.offers, id)
		a.mu.Unlock()
	}()
	a.emit("share:offer", map[string]any{"id": id, "from": from, "summary": summary, "hasSecrets": b.HasSecrets()})
	select {
	case ans := <-ch:
		if !ans.accept {
			return false, "Declined"
		}
		res, err := exchange.Apply(a.v, b, ans.overwrite)
		if err != nil {
			return false, err.Error()
		}
		a.emit("vault:changed", nil)
		return true, res.Summary
	case <-time.After(5 * time.Minute):
		return false, "No answer"
	}
}

// ShareRespond is called by the UI when the user accepts or declines an incoming offer.
func (a *App) ShareRespond(id string, accept, overwrite bool) {
	a.mu.Lock()
	ch := a.offers[id]
	a.mu.Unlock()
	if ch != nil {
		select {
		case ch <- offerAnswer{accept: accept, overwrite: overwrite}:
		default:
		}
	}
}
