package authn

import (
	"crypto/rand"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"strings"
	"unicode/utf8"

	"golang.org/x/crypto/argon2"
)

const (
	passwordMemory    uint32 = 19456
	passwordPasses    uint32 = 2
	passwordThreads   uint8  = 1
	passwordSaltBytes        = 16
	passwordKeyBytes         = 32
	phcPrefix                = "$argon2id$v=19$m=19456,t=2,p=1$"
	// Fixed public padding hash, independently generated with native libargon2.
	// Matching this value never authenticates an unknown account.
	dummyPasswordHash = "$argon2id$v=19$m=19456,t=2,p=1$cnlhZG9tLWxvZ2luLXBhZA$nBAeohjYY0O33Z0pGYDUvR27Q6UC5XUqTBxpedxdkGI"
)

var (
	ErrInvalidPassword     = errors.New("invalid password length or encoding")
	ErrInvalidPasswordHash = errors.New("invalid password hash")
)

// HashPassword validates registration length in Unicode code points, retaining
// all bytes of the supplied password, including spaces and normalization form.
func HashPassword(password string) (string, error) {
	if !validPassword(password, 15) {
		return "", ErrInvalidPassword
	}
	salt := make([]byte, passwordSaltBytes)
	if _, err := rand.Read(salt); err != nil {
		return "", errors.New("password salt unavailable")
	}
	key := argon2.IDKey([]byte(password), salt, passwordPasses, passwordMemory, passwordThreads, passwordKeyBytes)
	return phcPrefix + base64.RawStdEncoding.EncodeToString(salt) + "$" + base64.RawStdEncoding.EncodeToString(key), nil
}

// VerifyPassword accepts login length. The PHC parser accepts only the fixed
// project parameters before performing any expensive or memory-heavy work.
func VerifyPassword(password, encoded string) (bool, error) {
	if !validPassword(password, 1) {
		return false, ErrInvalidPassword
	}
	salt, expected, err := parsePasswordHash(encoded)
	if err != nil {
		return false, err
	}
	actual := argon2.IDKey([]byte(password), salt, passwordPasses, passwordMemory, passwordThreads, passwordKeyBytes)
	return subtle.ConstantTimeCompare(actual, expected) == 1, nil
}

// VerifyLoginPassword performs the same Argon2id work for an unknown email.
// A missing hash must be supplied as an empty string, never a fabricated account.
func VerifyLoginPassword(password, storedHash string) (bool, error) {
	exists := storedHash != ""
	if !exists {
		storedHash = dummyPasswordHash
	}
	match, err := VerifyPassword(password, storedHash)
	return exists && match, err
}

func validPassword(password string, minimum int) bool {
	if len(password) > 128*utf8.UTFMax || !utf8.ValidString(password) {
		return false
	}
	length := utf8.RuneCountInString(password)
	return length >= minimum && length <= 128
}

func parsePasswordHash(encoded string) ([]byte, []byte, error) {
	if len(encoded) > 256 || !strings.HasPrefix(encoded, phcPrefix) {
		return nil, nil, ErrInvalidPasswordHash
	}
	parts := strings.Split(strings.TrimPrefix(encoded, phcPrefix), "$")
	if len(parts) != 2 {
		return nil, nil, ErrInvalidPasswordHash
	}
	salt, err := base64.RawStdEncoding.Strict().DecodeString(parts[0])
	if err != nil || len(salt) != passwordSaltBytes || base64.RawStdEncoding.EncodeToString(salt) != parts[0] {
		return nil, nil, ErrInvalidPasswordHash
	}
	key, err := base64.RawStdEncoding.Strict().DecodeString(parts[1])
	if err != nil || len(key) != passwordKeyBytes || base64.RawStdEncoding.EncodeToString(key) != parts[1] {
		return nil, nil, ErrInvalidPasswordHash
	}
	return salt, key, nil
}
