package vault

import (
	"bytes"
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"encoding/hex"
	"errors"

	"golang.org/x/crypto/argon2"
)

const (
	saltLen    = 16
	keyLen     = 32
	nonceLen   = 12
	magicLen   = 4
	magicVault = "HRB1"
	// MagicExport marks an encrypted export file.
	MagicExport = "HRX1"
)

// ErrBadPassword is returned when decryption fails.
var ErrBadPassword = errors.New("wrong password or corrupted file")

// NewID returns a random 24-character hex identifier.
func NewID() string {
	b := make([]byte, 12)
	_, _ = rand.Read(b)
	return hex.EncodeToString(b)
}

func randBytes(n int) []byte {
	b := make([]byte, n)
	_, _ = rand.Read(b)
	return b
}

func deriveKey(password string, salt []byte) []byte {
	return argon2.IDKey([]byte(password), salt, 3, 64*1024, 4, keyLen)
}

// pack layout: magic | salt | nonce | ciphertext(GCM, aad=magic)
func pack(magic string, salt, key, plain []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	nonce := randBytes(gcm.NonceSize())
	ct := gcm.Seal(nil, nonce, plain, []byte(magic))
	var out bytes.Buffer
	out.WriteString(magic)
	out.Write(salt)
	out.Write(nonce)
	out.Write(ct)
	return out.Bytes(), nil
}

func unpack(magic string, blob []byte) (salt, nonce, ct []byte, err error) {
	if len(blob) < magicLen+saltLen+nonceLen+16 || string(blob[:magicLen]) != magic {
		return nil, nil, nil, errors.New("not a Shell Bay encrypted file")
	}
	salt = blob[magicLen : magicLen+saltLen]
	nonce = blob[magicLen+saltLen : magicLen+saltLen+nonceLen]
	ct = blob[magicLen+saltLen+nonceLen:]
	return salt, nonce, ct, nil
}

func open(magic string, key, nonce, ct []byte) ([]byte, error) {
	block, err := aes.NewCipher(key)
	if err != nil {
		return nil, err
	}
	gcm, err := cipher.NewGCM(block)
	if err != nil {
		return nil, err
	}
	plain, err := gcm.Open(nil, nonce, ct, []byte(magic))
	if err != nil {
		return nil, ErrBadPassword
	}
	return plain, nil
}

// SealBlob encrypts plain with a password-derived key.
func SealBlob(magic, password string, plain []byte) ([]byte, error) {
	salt := randBytes(saltLen)
	return pack(magic, salt, deriveKey(password, salt), plain)
}

// OpenBlob decrypts a blob produced by SealBlob.
func OpenBlob(magic, password string, blob []byte) ([]byte, error) {
	salt, nonce, ct, err := unpack(magic, blob)
	if err != nil {
		return nil, err
	}
	return open(magic, deriveKey(password, salt), nonce, ct)
}

// HasMagic reports whether blob starts with the given magic.
func HasMagic(blob []byte, magic string) bool {
	return len(blob) >= magicLen && string(blob[:magicLen]) == magic
}
