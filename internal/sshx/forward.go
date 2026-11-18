package sshx

import (
	"errors"
	"io"
	"net"
	"strconv"
	"sync"

	"shellbay/internal/vault"
)

type runner struct {
	ln    net.Listener
	lease *Lease
}

// Forwards manages running port forwarding rules.
type Forwards struct {
	mgr      *Manager
	mu       sync.Mutex
	run      map[string]*runner
	OnStatus func(id, state, errMsg string)
}

// NewForwards creates a forward manager.
func NewForwards(m *Manager) *Forwards {
	return &Forwards{mgr: m, run: map[string]*runner{}}
}

func (f *Forwards) status(id, state, msg string) {
	if f.OnStatus != nil {
		f.OnStatus(id, state, msg)
	}
}

// Running returns the IDs of active rules.
func (f *Forwards) Running() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	out := make([]string, 0, len(f.run))
	for id := range f.run {
		out = append(out, id)
	}
	return out
}

// Start opens the listener for a rule.
func (f *Forwards) Start(fw vault.Forward) error {
	f.mu.Lock()
	if _, ok := f.run[fw.ID]; ok {
		f.mu.Unlock()
		return errors.New("rule is already running")
	}
	f.mu.Unlock()

	if fw.BindPort <= 0 || fw.BindPort > 65535 {
		return errors.New("bind port is invalid")
	}
	if fw.Type != "dynamic" && (fw.DestAddr == "" || fw.DestPort <= 0) {
		return errors.New("destination is required")
	}

	lease, err := f.mgr.Acquire(fw.HostID)
	if err != nil {
		f.status(fw.ID, "error", err.Error())
		return err
	}
	bindAddr := fw.BindAddr
	if bindAddr == "" {
		bindAddr = "127.0.0.1"
	}
	bind := net.JoinHostPort(bindAddr, strconv.Itoa(fw.BindPort))

	var ln net.Listener
	if fw.Type == "remote" {
		ln, err = lease.Client().Listen("tcp", bind)
	} else {
		ln, err = net.Listen("tcp", bind)
	}
	if err != nil {
		lease.Release()
		f.status(fw.ID, "error", err.Error())
		return err
	}

	r := &runner{ln: ln, lease: lease}
	f.mu.Lock()
	f.run[fw.ID] = r
	f.mu.Unlock()
	f.status(fw.ID, "running", "")
	go f.serve(fw, r)
	return nil
}

func (f *Forwards) serve(fw vault.Forward, r *runner) {
	for {
		c, err := r.ln.Accept()
		if err != nil {
			break
		}
		go f.handle(fw, r, c)
	}
	f.mu.Lock()
	if f.run[fw.ID] == r {
		delete(f.run, fw.ID)
	}
	f.mu.Unlock()
	r.lease.Release()
	f.status(fw.ID, "stopped", "")
}

func (f *Forwards) handle(fw vault.Forward, r *runner, c net.Conn) {
	switch fw.Type {
	case "local":
		dest := net.JoinHostPort(fw.DestAddr, strconv.Itoa(fw.DestPort))
		rc, err := r.lease.Client().Dial("tcp", dest)
		if err != nil {
			_ = c.Close()
			return
		}
		pipe(c, rc)
	case "remote":
		dest := net.JoinHostPort(fw.DestAddr, strconv.Itoa(fw.DestPort))
		rc, err := net.Dial("tcp", dest)
		if err != nil {
			_ = c.Close()
			return
		}
		pipe(c, rc)
	case "dynamic":
		serveSocks(c, r.lease.Client().Dial)
	default:
		_ = c.Close()
	}
}

// Stop closes a running rule.
func (f *Forwards) Stop(id string) {
	f.mu.Lock()
	r := f.run[id]
	f.mu.Unlock()
	if r != nil {
		_ = r.ln.Close()
	}
}

// StopAll closes every rule.
func (f *Forwards) StopAll() {
	for _, id := range f.Running() {
		f.Stop(id)
	}
}

func pipe(a, b net.Conn) {
	var wg sync.WaitGroup
	wg.Add(2)
	cp := func(dst, src net.Conn) {
		defer wg.Done()
		_, _ = io.Copy(dst, src)
		if tc, ok := dst.(interface{ CloseWrite() error }); ok {
			_ = tc.CloseWrite()
		} else {
			_ = dst.Close()
		}
	}
	go cp(a, b)
	go cp(b, a)
	wg.Wait()
	_ = a.Close()
	_ = b.Close()
}

// serveSocks implements the CONNECT subset of SOCKS5 without authentication.
func serveSocks(c net.Conn, dial func(network, addr string) (net.Conn, error)) {
	buf := make([]byte, 262)
	if _, err := io.ReadFull(c, buf[:2]); err != nil || buf[0] != 5 {
		_ = c.Close()
		return
	}
	n := int(buf[1])
	if _, err := io.ReadFull(c, buf[:n]); err != nil {
		_ = c.Close()
		return
	}
	if _, err := c.Write([]byte{5, 0}); err != nil {
		_ = c.Close()
		return
	}
	if _, err := io.ReadFull(c, buf[:4]); err != nil || buf[0] != 5 {
		_ = c.Close()
		return
	}
	cmd, atyp := buf[1], buf[3]
	if cmd != 1 {
		_, _ = c.Write([]byte{5, 7, 0, 1, 0, 0, 0, 0, 0, 0})
		_ = c.Close()
		return
	}
	var host string
	switch atyp {
	case 1:
		if _, err := io.ReadFull(c, buf[:4]); err != nil {
			_ = c.Close()
			return
		}
		host = net.IP(append([]byte(nil), buf[:4]...)).String()
	case 3:
		if _, err := io.ReadFull(c, buf[:1]); err != nil {
			_ = c.Close()
			return
		}
		l := int(buf[0])
		if _, err := io.ReadFull(c, buf[:l]); err != nil {
			_ = c.Close()
			return
		}
		host = string(buf[:l])
	case 4:
		if _, err := io.ReadFull(c, buf[:16]); err != nil {
			_ = c.Close()
			return
		}
		host = net.IP(append([]byte(nil), buf[:16]...)).String()
	default:
		_, _ = c.Write([]byte{5, 8, 0, 1, 0, 0, 0, 0, 0, 0})
		_ = c.Close()
		return
	}
	if _, err := io.ReadFull(c, buf[:2]); err != nil {
		_ = c.Close()
		return
	}
	port := int(buf[0])<<8 | int(buf[1])
	rc, err := dial("tcp", net.JoinHostPort(host, strconv.Itoa(port)))
	if err != nil {
		_, _ = c.Write([]byte{5, 5, 0, 1, 0, 0, 0, 0, 0, 0})
		_ = c.Close()
		return
	}
	if _, err := c.Write([]byte{5, 0, 0, 1, 0, 0, 0, 0, 0, 0}); err != nil {
		_ = rc.Close()
		_ = c.Close()
		return
	}
	pipe(c, rc)
}
