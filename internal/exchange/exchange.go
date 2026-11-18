// Package exchange builds, encrypts, parses and merges Shell Bay data bundles.
// The same bundle format is used for export files and for P2P transfers.
package exchange

import (
	"encoding/json"
	"errors"
	"fmt"
	"time"

	"shellbay/internal/vault"
)

// The v1 format marker is shared by old export files and paired devices.
// The product name and suggested export extension can change independently.
const formatName = "harbor-bundle"

// Bundle is a portable subset of the vault.
type Bundle struct {
	Format     string          `json:"format"`
	Version    int             `json:"version"`
	ExportedAt int64           `json:"exportedAt"`
	Groups     []vault.Group   `json:"groups"`
	Hosts      []vault.Host    `json:"hosts"`
	Keys       []vault.Key     `json:"keys"`
	Snippets   []vault.Snippet `json:"snippets"`
	Flows      []vault.Flow    `json:"flows"`
	Forwards   []vault.Forward `json:"forwards"`
}

// Selection says what goes into a bundle.
type Selection struct {
	All            bool     `json:"all"`
	HostIDs        []string `json:"hostIds"`
	KeyIDs         []string `json:"keyIds"`
	SnippetIDs     []string `json:"snippetIds"`
	FlowIDs        []string `json:"flowIds"`
	ForwardIDs     []string `json:"forwardIds"`
	IncludeSecrets bool     `json:"includeSecrets"`
}

// Result summarises an import.
type Result struct {
	Groups   int    `json:"groups"`
	Hosts    int    `json:"hosts"`
	Keys     int    `json:"keys"`
	Snippets int    `json:"snippets"`
	Flows    int    `json:"flows"`
	Forwards int    `json:"forwards"`
	Skipped  int    `json:"skipped"`
	Summary  string `json:"summary"`
}

func (r *Result) finish() {
	r.Summary = fmt.Sprintf("%d hosts, %d keys, %d snippets, %d flows, %d port rules, %d groups added or updated",
		r.Hosts, r.Keys, r.Snippets, r.Flows, r.Forwards, r.Groups)
	if r.Skipped > 0 {
		r.Summary += fmt.Sprintf("; %d already present and left unchanged", r.Skipped)
	}
}

func set(ids []string) map[string]bool {
	m := make(map[string]bool, len(ids))
	for _, id := range ids {
		m[id] = true
	}
	return m
}

// Build selects data from the vault. Dependencies (groups, jump hosts, hosts of port rules, keys of
// hosts when secrets are included) are pulled in automatically.
func Build(d vault.Data, sel Selection) Bundle {
	b := Bundle{
		Format: formatName, Version: 1, ExportedAt: time.Now().UnixMilli(),
		Groups: []vault.Group{}, Hosts: []vault.Host{}, Keys: []vault.Key{},
		Snippets: []vault.Snippet{}, Flows: []vault.Flow{}, Forwards: []vault.Forward{},
	}
	hostSet, keySet, snipSet, fwdSet := set(sel.HostIDs), set(sel.KeyIDs), set(sel.SnippetIDs), set(sel.ForwardIDs)
	flowSet := set(sel.FlowIDs)
	if sel.All {
		for _, h := range d.Hosts {
			hostSet[h.ID] = true
		}
		for _, k := range d.Keys {
			keySet[k.ID] = true
		}
		for _, s := range d.Snippets {
			snipSet[s.ID] = true
		}
		for _, f := range d.Flows {
			flowSet[f.ID] = true
		}
		for _, f := range d.Forwards {
			fwdSet[f.ID] = true
		}
	}
	for _, f := range d.Forwards {
		if fwdSet[f.ID] {
			hostSet[f.HostID] = true
		}
	}
	byID := map[string]vault.Host{}
	for _, h := range d.Hosts {
		byID[h.ID] = h
	}
	for changed := true; changed; {
		changed = false
		for id := range hostSet {
			if j := byID[id].JumpHostID; j != "" && !hostSet[j] {
				hostSet[j] = true
				changed = true
			}
		}
	}
	groupSet := map[string]bool{}
	for _, h := range d.Hosts {
		if !hostSet[h.ID] {
			continue
		}
		if h.GroupID != "" {
			groupSet[h.GroupID] = true
		}
		if sel.IncludeSecrets && h.AuthType == "key" && h.KeyID != "" {
			keySet[h.KeyID] = true
		}
		if !sel.IncludeSecrets {
			h.Password = ""
		}
		b.Hosts = append(b.Hosts, h)
	}
	for _, g := range d.Groups {
		if groupSet[g.ID] {
			b.Groups = append(b.Groups, g)
		}
	}
	if sel.IncludeSecrets {
		for _, k := range d.Keys {
			if keySet[k.ID] {
				b.Keys = append(b.Keys, k)
			}
		}
	}
	for _, s := range d.Snippets {
		if snipSet[s.ID] {
			b.Snippets = append(b.Snippets, s)
		}
	}
	for _, f := range d.Flows {
		if flowSet[f.ID] {
			b.Flows = append(b.Flows, f)
		}
	}
	for _, f := range d.Forwards {
		if fwdSet[f.ID] {
			b.Forwards = append(b.Forwards, f)
		}
	}
	return b
}

// HasSecrets reports whether the bundle carries passwords or private keys.
func (b Bundle) HasSecrets() bool {
	if len(b.Keys) > 0 {
		return true
	}
	for _, h := range b.Hosts {
		if h.Password != "" {
			return true
		}
	}
	return false
}

// Parse decodes a JSON bundle.
func Parse(data []byte) (Bundle, error) {
	var b Bundle
	if err := json.Unmarshal(data, &b); err != nil {
		return b, errors.New("this is not a valid Shell Bay file")
	}
	if b.Format != formatName {
		return b, errors.New("this is not a Shell Bay bundle")
	}
	if len(b.Hosts) > 20000 || len(b.Keys) > 5000 || len(b.Snippets) > 20000 || len(b.Flows) > 20000 || len(b.Forwards) > 20000 {
		return b, errors.New("bundle is too large")
	}
	return b, nil
}

// EncodeFile serialises a bundle; with a password the result is encrypted.
func EncodeFile(b Bundle, password string) ([]byte, error) {
	plain, err := json.MarshalIndent(b, "", "  ")
	if err != nil {
		return nil, err
	}
	if password == "" {
		return plain, nil
	}
	return vault.SealBlob(vault.MagicExport, password, plain)
}

// IsEncrypted reports whether a file is an encrypted export.
func IsEncrypted(blob []byte) bool { return vault.HasMagic(blob, vault.MagicExport) }

// DecodeFile reads an export file (encrypted or plain).
func DecodeFile(blob []byte, password string) (Bundle, error) {
	if IsEncrypted(blob) {
		plain, err := vault.OpenBlob(vault.MagicExport, password, blob)
		if err != nil {
			return Bundle{}, err
		}
		return Parse(plain)
	}
	return Parse(blob)
}

func upsert[T any](list *[]T, item T, idOf func(T) string, overwrite bool, counter *int, skipped *int) {
	id := idOf(item)
	for i := range *list {
		if idOf((*list)[i]) == id {
			if overwrite {
				(*list)[i] = item
				*counter++
			} else {
				*skipped++
			}
			return
		}
	}
	*list = append(*list, item)
	*counter++
}

// Apply merges a bundle into the vault. Existing items with the same ID are kept unless overwrite is set.
func Apply(v *vault.Vault, b Bundle, overwrite bool) (Result, error) {
	var r Result
	if b.Format != formatName {
		return r, errors.New("this is not a Shell Bay bundle")
	}
	err := v.Update(func(d *vault.Data) error {
		imported := map[string]bool{}
		for _, g := range b.Groups {
			upsert(&d.Groups, g, func(x vault.Group) string { return x.ID }, overwrite, &r.Groups, &r.Skipped)
		}
		for _, k := range b.Keys {
			upsert(&d.Keys, k, func(x vault.Key) string { return x.ID }, overwrite, &r.Keys, &r.Skipped)
		}
		for _, h := range b.Hosts {
			if h.ID == "" || h.Address == "" {
				continue
			}
			imported[h.ID] = true
			upsert(&d.Hosts, h, func(x vault.Host) string { return x.ID }, overwrite, &r.Hosts, &r.Skipped)
		}
		for _, s := range b.Snippets {
			upsert(&d.Snippets, s, func(x vault.Snippet) string { return x.ID }, overwrite, &r.Snippets, &r.Skipped)
		}
		for _, fl := range b.Flows {
			upsert(&d.Flows, fl, func(x vault.Flow) string { return x.ID }, overwrite, &r.Flows, &r.Skipped)
		}
		for _, f := range b.Forwards {
			upsert(&d.Forwards, f, func(x vault.Forward) string { return x.ID }, overwrite, &r.Forwards, &r.Skipped)
		}

		// Repair references that point to things that are not in this vault.
		keys, hosts, groups := map[string]bool{}, map[string]bool{}, map[string]bool{}
		for _, k := range d.Keys {
			keys[k.ID] = true
		}
		for _, h := range d.Hosts {
			hosts[h.ID] = true
		}
		for _, g := range d.Groups {
			groups[g.ID] = true
		}
		for i := range d.Hosts {
			if !imported[d.Hosts[i].ID] {
				continue
			}
			h := &d.Hosts[i]
			if h.KeyID != "" && !keys[h.KeyID] {
				h.KeyID = ""
			}
			if h.JumpHostID != "" && !hosts[h.JumpHostID] {
				h.JumpHostID = ""
			}
			if h.GroupID != "" && !groups[h.GroupID] {
				h.GroupID = ""
			}
			if h.Port <= 0 || h.Port > 65535 {
				h.Port = 22
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
