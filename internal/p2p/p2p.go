// Package p2p lets two Shell Bay installations exchange hosts, keys and snippets directly,
// without any server. Both sides authenticate with self-signed TLS 1.3 certificates that are
// pinned by fingerprint. A one-time invite code carries the host's certificate fingerprint
// (so the joining side cannot be redirected to an impostor) and a secret (so the host knows
// the joining side was invited).
package p2p

import (
	"bytes"
	"crypto/rand"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/tls"
	"crypto/x509"
	"encoding/base32"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net"
	"os"
	"strings"
	"sync"
	"time"

	"shellbay/internal/vault"
)

const (
	maxHandshakeFrame = 64 << 10
	maxFrame          = 64 << 20
	inviteTTL         = 10 * time.Minute
)

type frame struct {
	T       string          `json:"t"`
	Name    string          `json:"name,omitempty"`
	Port    int             `json:"port,omitempty"`
	Secret  string          `json:"secret,omitempty"`
	OK      bool            `json:"ok,omitempty"`
	Msg     string          `json:"msg,omitempty"`
	Summary string          `json:"summary,omitempty"`
	Bundle  json.RawMessage `json:"bundle,omitempty"`
}

func writeFrame(w io.Writer, f *frame) error {
	b, err := json.Marshal(f)
	if err != nil {
		return err
	}
	var hdr [4]byte
	binary.BigEndian.PutUint32(hdr[:], uint32(len(b)))
	if _, err := w.Write(hdr[:]); err != nil {
		return err
	}
	_, err = w.Write(b)
	return err
}

func readFrame(r io.Reader, max uint32) (*frame, error) {
	var hdr [4]byte
	if _, err := io.ReadFull(r, hdr[:]); err != nil {
		return nil, err
	}
	n := binary.BigEndian.Uint32(hdr[:])
	if n == 0 || n > max {
		return nil, errors.New("invalid frame size")
	}
	buf := make([]byte, n)
	if _, err := io.ReadFull(r, buf); err != nil {
		return nil, err
	}
	var f frame
	if err := json.Unmarshal(buf, &f); err != nil {
		return nil, err
	}
	return &f, nil
}

type invite struct {
	secret  []byte
	expires time.Time
	fails   int
}

// Service is the P2P endpoint.
type Service struct {
	v *vault.Vault

	mu     sync.Mutex
	ln     net.Listener
	port   int
	cert   tls.Certificate
	fpSum  [32]byte
	inited bool
	inv    *invite

	// OnOffer is called when a paired teammate pushes data. It blocks until the user decides.
	OnOffer func(from, summary string, bundle []byte) (accepted bool, msg string)
	// OnPeersChanged is called after the peer list changes.
	OnPeersChanged func()
}

// NewService creates the service.
func NewService(v *vault.Vault) *Service { return &Service{v: v} }

// Init loads (or creates) this device's identity. Call after the vault is unlocked.
func (s *Service) Init() error {
	var id vault.Identity
	if err := s.v.View(func(d *vault.Data) { id = d.Identity }); err != nil {
		return err
	}
	if id.CertPEM == "" || id.KeyPEM == "" {
		name, _ := os.Hostname()
		if name == "" {
			name = "Mac"
		}
		certPEM, keyPEM, err := GenerateIdentity(name)
		if err != nil {
			return err
		}
		id = vault.Identity{DeviceName: name, CertPEM: certPEM, KeyPEM: keyPEM}
		if err := s.v.Update(func(d *vault.Data) error { d.Identity = id; return nil }); err != nil {
			return err
		}
	}
	cert, err := tls.X509KeyPair([]byte(id.CertPEM), []byte(id.KeyPEM))
	if err != nil {
		return err
	}
	if _, err := x509.ParseCertificate(cert.Certificate[0]); err != nil {
		return err
	}
	s.mu.Lock()
	s.cert = cert
	s.fpSum = sha256.Sum256(cert.Certificate[0])
	s.inited = true
	s.mu.Unlock()
	return nil
}

// Fingerprint returns this device's certificate fingerprint (hex).
func (s *Service) Fingerprint() string {
	s.mu.Lock()
	defer s.mu.Unlock()
	return hex.EncodeToString(s.fpSum[:])
}

// DeviceName returns the name shown to teammates.
func (s *Service) DeviceName() string {
	name := ""
	_ = s.v.View(func(d *vault.Data) { name = d.Identity.DeviceName })
	if name == "" {
		name = "Shell Bay"
	}
	return name
}

// SetDeviceName renames this device.
func (s *Service) SetDeviceName(name string) error {
	name = cleanName(name)
	if name == "" {
		return errors.New("name cannot be empty")
	}
	return s.v.Update(func(d *vault.Data) error { d.Identity.DeviceName = name; return nil })
}

func cleanName(n string) string {
	n = strings.Map(func(r rune) rune {
		if r < 32 || r == 127 {
			return -1
		}
		return r
	}, n)
	n = strings.TrimSpace(n)
	if len(n) > 64 {
		n = n[:64]
	}
	return n
}

// Start begins accepting connections.
func (s *Service) Start(port int) error {
	s.mu.Lock()
	defer s.mu.Unlock()
	if !s.inited {
		return errors.New("identity is not ready")
	}
	if s.ln != nil {
		return errors.New("already listening")
	}
	if port <= 0 || port > 65535 {
		return errors.New("port is invalid")
	}
	cfg := &tls.Config{
		Certificates: []tls.Certificate{s.cert},
		ClientAuth:   tls.RequireAnyClientCert, // peers are authenticated by pinned fingerprint
		MinVersion:   tls.VersionTLS13,
	}
	ln, err := tls.Listen("tcp", fmt.Sprintf(":%d", port), cfg)
	if err != nil {
		return err
	}
	s.ln, s.port = ln, port
	go func() {
		for {
			c, err := ln.Accept()
			if err != nil {
				return
			}
			go s.handle(c)
		}
	}()
	return nil
}

// Stop stops listening.
func (s *Service) Stop() {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln != nil {
		_ = s.ln.Close()
		s.ln, s.port, s.inv = nil, 0, nil
	}
}

// Listening reports the listener state.
func (s *Service) Listening() (bool, int) {
	s.mu.Lock()
	defer s.mu.Unlock()
	return s.ln != nil, s.port
}

// ---------------------------------------------------------------- invites

var b32 = base32.StdEncoding.WithPadding(base32.NoPadding)

func encodeCode(prefix, secret []byte) string {
	raw := append(append([]byte{}, prefix...), secret...)
	s := b32.EncodeToString(raw)
	var parts []string
	for len(s) > 6 {
		parts = append(parts, s[:6])
		s = s[6:]
	}
	parts = append(parts, s)
	return strings.Join(parts, "-")
}

func decodeCode(code string) (prefix, secret []byte, err error) {
	c := strings.ToUpper(strings.NewReplacer("-", "", " ", "").Replace(code))
	raw, err := b32.DecodeString(c)
	if err != nil || len(raw) != 26 {
		return nil, nil, errors.New("invite code is invalid")
	}
	return raw[:16], raw[16:], nil
}

// CreateInvite makes a one-time code valid for ten minutes. Sharing must be enabled.
func (s *Service) CreateInvite() (code string, expires time.Time, err error) {
	s.mu.Lock()
	defer s.mu.Unlock()
	if s.ln == nil {
		return "", time.Time{}, errors.New("turn on sharing first")
	}
	secret := make([]byte, 10)
	if _, err := rand.Read(secret); err != nil {
		return "", time.Time{}, err
	}
	expires = time.Now().Add(inviteTTL)
	s.inv = &invite{secret: secret, expires: expires}
	return encodeCode(s.fpSum[:16], secret), expires, nil
}

func (s *Service) consumeInvite(hexSecret string) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	inv := s.inv
	if inv == nil || time.Now().After(inv.expires) {
		s.inv = nil
		return false
	}
	got, err := hex.DecodeString(hexSecret)
	if err != nil || subtle.ConstantTimeCompare(got, inv.secret) != 1 {
		inv.fails++
		if inv.fails >= 5 {
			s.inv = nil
		}
		return false
	}
	s.inv = nil
	return true
}

// InvitePrefix is the scheme emitted in newly generated invite links.
const InvitePrefix = "shellbay://"

// ParseInvite accepts new links, pre-rename links and plain "host:port CODE".
func ParseInvite(link string) (addr, code string, err error) {
	s := strings.TrimSpace(link)
	s = strings.TrimPrefix(strings.TrimPrefix(s, InvitePrefix), "harbor://")
	if i := strings.Index(s, "/"); i > 0 {
		addr, code = s[:i], strings.TrimSpace(s[i+1:])
	} else if f := strings.Fields(s); len(f) == 2 {
		addr, code = f[0], f[1]
	} else {
		return "", "", errors.New("invite link is invalid")
	}
	if _, _, e := net.SplitHostPort(addr); e != nil {
		return "", "", errors.New("invite link has no address and port")
	}
	return addr, code, nil
}

// ---------------------------------------------------------------- peers

func (s *Service) peerByFP(fp string) (vault.Peer, bool) {
	var p vault.Peer
	var ok bool
	_ = s.v.View(func(d *vault.Data) {
		for _, x := range d.Peers {
			if x.Fingerprint == fp {
				p, ok = x, true
				return
			}
		}
	})
	return p, ok
}

func (s *Service) peerByID(id string) (vault.Peer, bool) {
	var p vault.Peer
	var ok bool
	_ = s.v.View(func(d *vault.Data) {
		for _, x := range d.Peers {
			if x.ID == id {
				p, ok = x, true
				return
			}
		}
	})
	return p, ok
}

func (s *Service) upsertPeer(p vault.Peer) error {
	err := s.v.Update(func(d *vault.Data) error {
		for i := range d.Peers {
			if d.Peers[i].Fingerprint == p.Fingerprint {
				p.ID = d.Peers[i].ID
				p.AddedAt = d.Peers[i].AddedAt
				if p.Address == "" {
					p.Address = d.Peers[i].Address
				}
				d.Peers[i] = p
				return nil
			}
		}
		d.Peers = append(d.Peers, p)
		return nil
	})
	if err == nil && s.OnPeersChanged != nil {
		s.OnPeersChanged()
	}
	return err
}

// RemovePeer unpairs a teammate.
func (s *Service) RemovePeer(id string) error {
	err := s.v.Update(func(d *vault.Data) error {
		out := d.Peers[:0]
		for _, p := range d.Peers {
			if p.ID != id {
				out = append(out, p)
			}
		}
		d.Peers = out
		return nil
	})
	if err == nil && s.OnPeersChanged != nil {
		s.OnPeersChanged()
	}
	return err
}

// SetPeerAddress sets the host:port used to reach a teammate.
func (s *Service) SetPeerAddress(id, addr string) error {
	addr = strings.TrimSpace(addr)
	if addr != "" {
		if _, _, err := net.SplitHostPort(addr); err != nil {
			return errors.New("address must look like 192.168.1.20:7878")
		}
	}
	err := s.v.Update(func(d *vault.Data) error {
		for i := range d.Peers {
			if d.Peers[i].ID == id {
				d.Peers[i].Address = addr
			}
		}
		return nil
	})
	if err == nil && s.OnPeersChanged != nil {
		s.OnPeersChanged()
	}
	return err
}

// ---------------------------------------------------------------- client side

func (s *Service) dial(addr string) (*tls.Conn, string, error) {
	s.mu.Lock()
	cert := s.cert
	s.mu.Unlock()
	d := &net.Dialer{Timeout: 10 * time.Second}
	conn, err := tls.DialWithDialer(d, "tcp", addr, &tls.Config{
		Certificates: []tls.Certificate{cert},
		// The server certificate is self-signed; its identity is verified below by fingerprint.
		InsecureSkipVerify: true,
		MinVersion:         tls.VersionTLS13,
	})
	if err != nil {
		return nil, "", err
	}
	st := conn.ConnectionState()
	if len(st.PeerCertificates) == 0 {
		_ = conn.Close()
		return nil, "", errors.New("peer presented no certificate")
	}
	return conn, fingerprintHex(st.PeerCertificates[0].Raw), nil
}

// Join pairs with a teammate using their invite link.
func (s *Service) Join(link string) (vault.Peer, error) {
	addr, code, err := ParseInvite(link)
	if err != nil {
		return vault.Peer{}, err
	}
	prefix, secret, err := decodeCode(code)
	if err != nil {
		return vault.Peer{}, err
	}
	conn, fp, err := s.dial(addr)
	if err != nil {
		return vault.Peer{}, fmt.Errorf("cannot connect to %s: %w", addr, err)
	}
	defer conn.Close()
	raw, _ := hex.DecodeString(fp)
	if len(raw) < 16 || !bytes.Equal(raw[:16], prefix) {
		return vault.Peer{}, errors.New("the device at this address does not match the invite (wrong address, expired invite, or someone is intercepting the connection)")
	}
	_ = conn.SetDeadline(time.Now().Add(20 * time.Second))
	_, port := s.Listening()
	if err := writeFrame(conn, &frame{T: "hello", Name: s.DeviceName(), Port: port, Secret: hex.EncodeToString(secret)}); err != nil {
		return vault.Peer{}, err
	}
	w, err := readFrame(conn, maxHandshakeFrame)
	if err != nil {
		return vault.Peer{}, err
	}
	if !w.OK {
		if w.Msg == "" {
			w.Msg = "invite was rejected (expired or already used)"
		}
		return vault.Peer{}, errors.New(w.Msg)
	}
	now := time.Now().UnixMilli()
	name := cleanName(w.Name)
	if name == "" {
		name = addr
	}
	peer := vault.Peer{ID: vault.NewID(), Name: name, Address: addr, Fingerprint: fp, AddedAt: now, LastSeenAt: now}
	if err := s.upsertPeer(peer); err != nil {
		return vault.Peer{}, err
	}
	if saved, ok := s.peerByFP(fp); ok {
		peer = saved
	}
	return peer, nil
}

// Send pushes a bundle to a paired teammate and waits for them to accept or decline.
func (s *Service) Send(peerID, summary string, bundle []byte) (bool, string, error) {
	peer, ok := s.peerByID(peerID)
	if !ok {
		return false, "", errors.New("teammate not found")
	}
	if peer.Address == "" {
		return false, "", errors.New("no address for this teammate: set it in the teammate list, or ask them to turn on sharing")
	}
	conn, fp, err := s.dial(peer.Address)
	if err != nil {
		return false, "", fmt.Errorf("cannot connect to %s: %w", peer.Address, err)
	}
	defer conn.Close()
	if subtle.ConstantTimeCompare([]byte(fp), []byte(peer.Fingerprint)) != 1 {
		return false, "", errors.New("the device at this address is not the teammate you paired with (certificate mismatch)")
	}
	_ = conn.SetDeadline(time.Now().Add(8 * time.Minute))
	_, port := s.Listening()
	if err := writeFrame(conn, &frame{T: "hello", Name: s.DeviceName(), Port: port}); err != nil {
		return false, "", err
	}
	w, err := readFrame(conn, maxHandshakeFrame)
	if err != nil {
		return false, "", err
	}
	if !w.OK {
		return false, "", errors.New(w.Msg)
	}
	if err := writeFrame(conn, &frame{T: "offer", Summary: summary, Bundle: json.RawMessage(bundle)}); err != nil {
		return false, "", err
	}
	res, err := readFrame(conn, maxHandshakeFrame)
	if err != nil {
		return false, "", err
	}
	return res.OK, res.Msg, nil
}

// ---------------------------------------------------------------- server side

func (s *Service) handle(c net.Conn) {
	defer c.Close()
	tc, ok := c.(*tls.Conn)
	if !ok {
		return
	}
	_ = tc.SetDeadline(time.Now().Add(20 * time.Second))
	if err := tc.Handshake(); err != nil {
		return
	}
	certs := tc.ConnectionState().PeerCertificates
	if len(certs) == 0 {
		return
	}
	peerFP := fingerprintHex(certs[0].Raw)

	hello, err := readFrame(tc, maxHandshakeFrame)
	if err != nil || hello.T != "hello" {
		return
	}
	remoteHost, _, _ := net.SplitHostPort(c.RemoteAddr().String())
	addr := ""
	if hello.Port > 0 && remoteHost != "" {
		addr = net.JoinHostPort(remoteHost, fmt.Sprint(hello.Port))
	}
	now := time.Now().UnixMilli()
	name := cleanName(hello.Name)
	if name == "" {
		name = remoteHost
	}

	peer, trusted := s.peerByFP(peerFP)
	if !trusted {
		if !s.consumeInvite(hello.Secret) {
			_ = writeFrame(tc, &frame{T: "welcome", OK: false, Msg: "not authorised: ask for a fresh invite"})
			return
		}
		peer = vault.Peer{ID: vault.NewID(), Name: name, Address: addr, Fingerprint: peerFP, AddedAt: now, LastSeenAt: now}
	} else {
		peer.LastSeenAt = now
		if addr != "" {
			peer.Address = addr
		}
	}
	if err := s.upsertPeer(peer); err != nil {
		_ = writeFrame(tc, &frame{T: "welcome", OK: false, Msg: "internal error"})
		return
	}
	if err := writeFrame(tc, &frame{T: "welcome", OK: true, Name: s.DeviceName()}); err != nil {
		return
	}

	_ = tc.SetDeadline(time.Now().Add(7 * time.Minute))
	req, err := readFrame(tc, maxFrame)
	if err != nil {
		return // pairing-only connection
	}
	if req.T != "offer" {
		return
	}
	if s.OnOffer == nil {
		_ = writeFrame(tc, &frame{T: "result", OK: false, Msg: "not accepting data"})
		return
	}
	accepted, msg := s.OnOffer(peer.Name, req.Summary, []byte(req.Bundle))
	_ = writeFrame(tc, &frame{T: "result", OK: accepted, Msg: msg})
}
