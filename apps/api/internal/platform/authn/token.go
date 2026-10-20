package authn

import (
	"bytes"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"math"
	"strings"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

const (
	SessionLifetime  = 24 * time.Hour
	SessionTokenType = "ryadom-session+jwt"
	SessionIssuer    = "ryadom-api"
	SessionAudience  = "ryadom-web"
	maxTokenBytes    = 4096
)

var (
	ErrInvalidToken    = errors.New("invalid session token")
	ErrInvalidTokenKey = errors.New("session token key must contain at least 32 bytes")
	ErrInvalidTokenIDs = errors.New("session token IDs must be nonzero UUIDs")
	ErrInvalidClock    = errors.New("invalid token clock")
)

type Tokens struct {
	key   []byte
	clock Clock
}

// VerifiedToken contains only cryptographic claims, never a database role or
// authorization result. Database/session checks remain mandatory after this.
type VerifiedToken struct {
	AccountID, SessionID uuid.UUID
	IssuedAt, ExpiresAt  time.Time
}

// Token intentionally has no exported secret fields and serializes to {}.
// The caller must explicitly access Value() for the HttpOnly cookie after commit.
type Token struct {
	raw    string
	claims VerifiedToken
}

func (t Token) Value() string         { return t.raw }
func (t Token) Claims() VerifiedToken { return t.claims }
func (t Token) Digest() string        { return TokenDigest(t.raw) }
func (Token) String() string          { return "authn.Token[redacted]" }
func (t Token) GoString() string      { return t.String() }
func (*Tokens) String() string        { return "authn.Tokens[redacted]" }
func (t *Tokens) GoString() string    { return t.String() }

// NewTokens takes the decoded AUTH_JWT_SECRET from the existing configuration.
func NewTokens(key []byte, clock Clock) (*Tokens, error) {
	if len(key) < 32 {
		return nil, ErrInvalidTokenKey
	}
	return &Tokens{key: bytes.Clone(key), clock: clockOrNow(clock)}, nil
}

func (t *Tokens) Issue(accountID, sessionID uuid.UUID) (Token, error) {
	if accountID == uuid.Nil || sessionID == uuid.Nil {
		return Token{}, ErrInvalidTokenIDs
	}
	issued := t.clock().Unix()
	if issued < 0 || issued > math.MaxInt64-int64(SessionLifetime/time.Second) {
		return Token{}, ErrInvalidClock
	}
	expires := issued + int64(SessionLifetime/time.Second)
	claims := jwt.MapClaims{"iss": SessionIssuer, "aud": SessionAudience, "sub": accountID.String(), "jti": sessionID.String(), "iat": issued, "exp": expires}
	token := jwt.NewWithClaims(jwt.SigningMethodHS256, claims)
	token.Header["typ"] = SessionTokenType
	raw, err := token.SignedString(t.key)
	if err != nil {
		return Token{}, ErrInvalidToken
	}
	return Token{raw: raw, claims: VerifiedToken{AccountID: accountID, SessionID: sessionID, IssuedAt: time.Unix(issued, 0).UTC(), ExpiresAt: time.Unix(expires, 0).UTC()}}, nil
}

func (t *Tokens) Verify(raw string) (VerifiedToken, error) {
	if len(raw) == 0 || len(raw) > maxTokenBytes {
		return VerifiedToken{}, ErrInvalidToken
	}
	parts := strings.Split(raw, ".")
	if len(parts) != 3 {
		return VerifiedToken{}, ErrInvalidToken
	}
	signature, err := base64.RawURLEncoding.Strict().DecodeString(parts[2])
	if err != nil || len(signature) != sha256.Size || base64.RawURLEncoding.EncodeToString(signature) != parts[2] {
		return VerifiedToken{}, ErrInvalidToken
	}
	header, err := decodeObject(parts[0])
	if err != nil {
		return VerifiedToken{}, ErrInvalidToken
	}
	if _, critical := header["crit"]; critical {
		return VerifiedToken{}, ErrInvalidToken
	}
	payload, err := decodeObject(parts[1])
	if err != nil {
		return VerifiedToken{}, ErrInvalidToken
	}
	var issued, expires int64
	if len(payload["iat"]) == 0 || len(payload["exp"]) == 0 || string(payload["iat"]) == "null" || string(payload["exp"]) == "null" {
		return VerifiedToken{}, ErrInvalidToken
	}
	if json.Unmarshal(payload["iat"], &issued) != nil || json.Unmarshal(payload["exp"], &expires) != nil || issued < 0 || issued > math.MaxInt64-int64(SessionLifetime/time.Second) || expires != issued+int64(SessionLifetime/time.Second) {
		return VerifiedToken{}, ErrInvalidToken
	}
	now := t.clock()
	claims := jwt.MapClaims{}
	token, err := jwt.ParseWithClaims(raw, claims, func(token *jwt.Token) (any, error) {
		if token.Method != jwt.SigningMethodHS256 || token.Header["typ"] != SessionTokenType {
			return nil, ErrInvalidToken
		}
		return t.key, nil
	}, jwt.WithValidMethods([]string{"HS256"}), jwt.WithIssuer(SessionIssuer), jwt.WithAudience(SessionAudience), jwt.WithExpirationRequired(), jwt.WithJSONNumber(), jwt.WithStrictDecoding(), jwt.WithTimeFunc(func() time.Time { return now }))
	if err != nil || !token.Valid || now.Compare(time.Unix(expires, 0)) >= 0 || time.Unix(issued, 0).After(now.Add(30*time.Second)) {
		return VerifiedToken{}, ErrInvalidToken
	}
	accountID, ok := claimID(claims["sub"])
	if !ok {
		return VerifiedToken{}, ErrInvalidToken
	}
	sessionID, ok := claimID(claims["jti"])
	if !ok {
		return VerifiedToken{}, ErrInvalidToken
	}
	return VerifiedToken{AccountID: accountID, SessionID: sessionID, IssuedAt: time.Unix(issued, 0).UTC(), ExpiresAt: time.Unix(expires, 0).UTC()}, nil
}

func TokenDigest(raw string) string {
	sum := sha256.Sum256([]byte(raw))
	return hex.EncodeToString(sum[:])
}

func claimID(value any) (uuid.UUID, bool) {
	text, ok := value.(string)
	if !ok {
		return uuid.Nil, false
	}
	id, err := uuid.Parse(text)
	return id, err == nil && id != uuid.Nil && text == id.String()
}

// Reject duplicate top-level keys and noncanonical base64 before handing the
// bounded object to the JWT library. Errors never include token contents.
func decodeObject(segment string) (map[string]json.RawMessage, error) {
	data, err := base64.RawURLEncoding.Strict().DecodeString(segment)
	if err != nil || base64.RawURLEncoding.EncodeToString(data) != segment {
		return nil, ErrInvalidToken
	}
	decoder := json.NewDecoder(bytes.NewReader(data))
	start, err := decoder.Token()
	if err != nil || start != json.Delim('{') {
		return nil, ErrInvalidToken
	}
	object := map[string]json.RawMessage{}
	for decoder.More() {
		value, err := decoder.Token()
		if err != nil {
			return nil, ErrInvalidToken
		}
		key, ok := value.(string)
		if !ok {
			return nil, ErrInvalidToken
		}
		if _, duplicate := object[key]; duplicate {
			return nil, ErrInvalidToken
		}
		var raw json.RawMessage
		if decoder.Decode(&raw) != nil {
			return nil, ErrInvalidToken
		}
		object[key] = raw
	}
	if end, err := decoder.Token(); err != nil || end != json.Delim('}') {
		return nil, ErrInvalidToken
	}
	if _, err := decoder.Token(); err != io.EOF {
		return nil, ErrInvalidToken
	}
	return object, nil
}
