package exchange

import (
	"errors"
	"os"
	"os/user"
	"path/filepath"
	"strconv"
	"strings"
	"time"

	"golang.org/x/crypto/ssh"

	"shellbay/internal/vault"
)

type sshEntry struct {
	alias        string
	hostName     string
	user         string
	port         int
	identityFile string
	proxyJump    string
}

func expandHome(p string) string {
	if strings.HasPrefix(p, "~/") {
		if home, err := os.UserHomeDir(); err == nil {
			return filepath.Join(home, p[2:])
		}
	}
	return p
}

func splitKV(line string) (string, string) {
	i := strings.IndexAny(line, " \t=")
	if i < 0 {
		return strings.ToLower(line), ""
	}
	k := strings.ToLower(line[:i])
	v := strings.TrimSpace(strings.TrimLeft(line[i:], " \t="))
	return k, strings.Trim(v, `"`)
}

func parseSSHConfig(text string) []*sshEntry {
	var entries []*sshEntry
	var current []*sshEntry
	for _, raw := range strings.Split(text, "\n") {
		line := strings.TrimSpace(raw)
		if line == "" || strings.HasPrefix(line, "#") {
			continue
		}
		k, v := splitKV(line)
		if k == "host" {
			current = nil
			for _, alias := range strings.Fields(v) {
				if strings.ContainsAny(alias, "*?!") {
					continue
				}
				e := &sshEntry{alias: alias}
				entries = append(entries, e)
				current = append(current, e)
			}
			continue
		}
		for _, e := range current {
			switch k {
			case "hostname":
				e.hostName = v
			case "user":
				e.user = v
			case "port":
				if n, err := strconv.Atoi(v); err == nil {
					e.port = n
				}
			case "identityfile":
				if e.identityFile == "" {
					e.identityFile = v
				}
			case "proxyjump":
				e.proxyJump = v
			}
		}
	}
	return entries
}

// ImportSSHConfig reads an OpenSSH config file (default ~/.ssh/config) into the vault.
func ImportSSHConfig(v *vault.Vault, path string) (Result, error) {
	if path == "" {
		home, err := os.UserHomeDir()
		if err != nil {
			return Result{}, err
		}
		path = filepath.Join(home, ".ssh", "config")
	}
	data, err := os.ReadFile(path)
	if err != nil {
		return Result{}, err
	}
	entries := parseSSHConfig(string(data))
	if len(entries) == 0 {
		return Result{}, errors.New("no hosts found in this file")
	}
	defUser := ""
	if u, err := user.Current(); err == nil {
		defUser = u.Username
	}

	var r Result
	err = v.Update(func(d *vault.Data) error {
		aliasToID := map[string]string{}
		type pending struct {
			idx  int
			jump string
		}
		var jumps []pending

		for _, e := range entries {
			addr := e.hostName
			if addr == "" {
				addr = e.alias
			}
			port := e.port
			if port == 0 {
				port = 22
			}
			usr := e.user
			if usr == "" {
				usr = defUser
			}
			dup := false
			for _, h := range d.Hosts {
				if h.Address == addr && h.Port == port && h.Username == usr {
					aliasToID[e.alias] = h.ID
					dup = true
					r.Skipped++
					break
				}
			}
			if dup {
				continue
			}
			h := vault.Host{
				ID: vault.NewID(), Label: e.alias, Address: addr, Port: port, Username: usr,
				AuthType: "agent", Tags: []string{}, CreatedAt: time.Now().UnixMilli(),
			}
			if e.identityFile != "" {
				if keyID := importKeyFile(d, expandHome(e.identityFile), e.alias, &r); keyID != "" {
					h.AuthType, h.KeyID = "key", keyID
				}
			}
			d.Hosts = append(d.Hosts, h)
			aliasToID[e.alias] = h.ID
			r.Hosts++
			if e.proxyJump != "" {
				jumps = append(jumps, pending{idx: len(d.Hosts) - 1, jump: e.proxyJump})
			}
		}
		for _, p := range jumps {
			first := strings.TrimSpace(strings.Split(p.jump, ",")[0])
			if i := strings.LastIndex(first, "@"); i >= 0 {
				first = first[i+1:]
			}
			if i := strings.LastIndex(first, ":"); i >= 0 {
				first = first[:i]
			}
			if id, ok := aliasToID[first]; ok {
				d.Hosts[p.idx].JumpHostID = id
				continue
			}
			for _, h := range d.Hosts {
				if h.Address == first {
					d.Hosts[p.idx].JumpHostID = h.ID
					break
				}
			}
		}
		return nil
	})
	if err != nil {
		return Result{}, err
	}
	r.finish()
	return r, nil
}

func importKeyFile(d *vault.Data, path, label string, r *Result) string {
	b, err := os.ReadFile(path)
	if err != nil || len(b) == 0 || len(b) > 64*1024 {
		return ""
	}
	pemText := string(b)
	for _, k := range d.Keys {
		if k.PrivateKey == pemText {
			return k.ID
		}
	}
	k := vault.Key{
		ID: vault.NewID(), Name: label, PrivateKey: pemText, Type: "unknown",
		CreatedAt: time.Now().UnixMilli(),
	}
	if signer, err := ssh.ParsePrivateKey(b); err == nil {
		pub := signer.PublicKey()
		k.Type = pub.Type()
		k.PublicKey = strings.TrimSpace(string(ssh.MarshalAuthorizedKey(pub)))
		k.Fingerprint = ssh.FingerprintSHA256(pub)
	} else {
		var missing *ssh.PassphraseMissingError
		if !errors.As(err, &missing) {
			return "" // not a private key
		}
		k.Type = "encrypted"
	}
	d.Keys = append(d.Keys, k)
	r.Keys++
	return k.ID
}
