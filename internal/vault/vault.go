package vault

import (
	"crypto/subtle"
	"encoding/json"
	"errors"
	"os"
	"sync"
	"time"
)

// ErrLocked is returned when the vault has not been unlocked.
var ErrLocked = errors.New("vault is locked")

// Vault stores saved configuration in one password-encrypted file. The
// mutex protects the key and decrypted snapshot while native services and
// Wails handlers read and update them concurrently.
type Vault struct {
	mu       sync.RWMutex
	path     string
	key      []byte
	salt     []byte
	data     *Data
	unlocked bool
}

// New creates a vault bound to a file path.
func New(path string) *Vault { return &Vault{path: path} }

// Exists reports whether the vault file exists.
func (v *Vault) Exists() bool {
	_, err := os.Stat(v.path)
	return err == nil
}

// Unlocked reports whether the vault is open.
func (v *Vault) Unlocked() bool {
	v.mu.RLock()
	defer v.mu.RUnlock()
	return v.unlocked
}

// Create initialises a new vault with a master password.
func (v *Vault) Create(password string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.Exists() {
		return errors.New("vault already exists")
	}
	if len(password) < 8 {
		return errors.New("master password must be at least 8 characters")
	}
	v.salt = randBytes(saltLen)
	v.key = deriveKey(password, v.salt)
	d := Data{}
	d.Normalize()
	v.data = &d
	if err := v.saveLocked(); err != nil {
		v.key, v.data = nil, nil
		return err
	}
	v.unlocked = true
	return nil
}

// Unlock decrypts the vault file.
func (v *Vault) Unlock(password string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	blob, err := os.ReadFile(v.path)
	if err != nil {
		return err
	}
	salt, nonce, ct, err := unpack(magicVault, blob)
	if err != nil {
		return err
	}
	key := deriveKey(password, salt)
	plain, err := open(magicVault, key, nonce, ct)
	if err != nil {
		return err
	}
	var d Data
	if err := json.Unmarshal(plain, &d); err != nil {
		return err
	}
	d.Normalize()
	v.salt = append([]byte(nil), salt...)
	v.key = key
	v.data = &d
	v.unlocked = true
	_ = os.WriteFile(v.path+".bak", blob, 0o600)
	return nil
}

// Lock wipes the key and data from memory.
func (v *Vault) Lock() {
	v.mu.Lock()
	defer v.mu.Unlock()
	for i := range v.key {
		v.key[i] = 0
	}
	v.key = nil
	v.data = nil
	v.unlocked = false
}

// ChangePassword re-encrypts the vault with a new password.
func (v *Vault) ChangePassword(oldPw, newPw string) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.unlocked {
		return ErrLocked
	}
	if subtle.ConstantTimeCompare(deriveKey(oldPw, v.salt), v.key) != 1 {
		return errors.New("current password is incorrect")
	}
	if len(newPw) < 8 {
		return errors.New("master password must be at least 8 characters")
	}
	oldSalt, oldKey := v.salt, v.key
	v.salt = randBytes(saltLen)
	v.key = deriveKey(newPw, v.salt)
	if err := v.saveLocked(); err != nil {
		v.salt, v.key = oldSalt, oldKey
		return err
	}
	return nil
}

func (v *Vault) saveLocked() error {
	plain, err := json.Marshal(v.data)
	if err != nil {
		return err
	}
	blob, err := pack(magicVault, v.salt, v.key, plain)
	if err != nil {
		return err
	}
	tmp := v.path + ".tmp"
	if err := os.WriteFile(tmp, blob, 0o600); err != nil {
		return err
	}
	return os.Rename(tmp, v.path)
}

// View runs fn with read access to the data.
func (v *Vault) View(fn func(d *Data)) error {
	v.mu.RLock()
	defer v.mu.RUnlock()
	if !v.unlocked {
		return ErrLocked
	}
	fn(v.data)
	return nil
}

// Update runs fn with write access and persists the result. If fn fails nothing is saved
// and the in-memory state is rolled back.
func (v *Vault) Update(fn func(d *Data) error) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if !v.unlocked {
		return ErrLocked
	}
	before, err := json.Marshal(v.data)
	if err != nil {
		return err
	}
	rollback := func() {
		var d Data
		if json.Unmarshal(before, &d) == nil {
			d.Normalize()
			v.data = &d
		}
	}
	if err := fn(v.data); err != nil {
		rollback()
		return err
	}
	v.data.Normalize()
	if err := v.saveLocked(); err != nil {
		rollback()
		return err
	}
	return nil
}

// Snapshot returns a deep copy of the data.
func (v *Vault) Snapshot() (Data, error) {
	v.mu.RLock()
	defer v.mu.RUnlock()
	if !v.unlocked {
		return Data{}, ErrLocked
	}
	b, err := json.Marshal(v.data)
	if err != nil {
		return Data{}, err
	}
	var out Data
	if err := json.Unmarshal(b, &out); err != nil {
		return Data{}, err
	}
	out.Normalize()
	return out, nil
}

// Host looks a host up by ID.
func (v *Vault) Host(id string) (Host, bool) {
	var h Host
	var ok bool
	_ = v.View(func(d *Data) {
		for _, x := range d.Hosts {
			if x.ID == id {
				h, ok = x, true
				return
			}
		}
	})
	return h, ok
}

// Key looks a key up by ID.
func (v *Vault) Key(id string) (Key, bool) {
	var k Key
	var ok bool
	_ = v.View(func(d *Data) {
		for _, x := range d.Keys {
			if x.ID == id {
				k, ok = x, true
				return
			}
		}
	})
	return k, ok
}

// Settings returns the current settings (defaults when locked).
func (v *Vault) Settings() Settings {
	s := DefaultSettings()
	_ = v.View(func(d *Data) { s = d.Settings })
	return s
}

// KnownFor returns the known host keys for an address.
func (v *Vault) KnownFor(host string) []KnownHost {
	var out []KnownHost
	_ = v.View(func(d *Data) {
		for _, k := range d.KnownHosts {
			if k.Host == host {
				out = append(out, k)
			}
		}
	})
	return out
}

// SaveKnown stores a host key. With replace set, an existing key of the same type is overwritten.
func (v *Vault) SaveKnown(k KnownHost, replace bool) error {
	k.AddedAt = time.Now().UnixMilli()
	return v.Update(func(d *Data) error {
		if replace {
			for i := range d.KnownHosts {
				if d.KnownHosts[i].Host == k.Host && d.KnownHosts[i].KeyType == k.KeyType {
					d.KnownHosts[i] = k
					return nil
				}
			}
		}
		d.KnownHosts = append(d.KnownHosts, k)
		return nil
	})
}
