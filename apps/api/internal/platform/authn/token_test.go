package authn

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"strings"
	"testing"
	"time"

	"github.com/golang-jwt/jwt/v5"
	"github.com/google/uuid"
)

func testKey() []byte { return []byte(strings.Repeat("test-secret-key-", 3)) }

var accountID = uuid.MustParse("00000000-0000-4000-8000-000000000001")
var sessionID = uuid.MustParse("00000000-0000-4000-8000-000000000002")

func validClaims(now time.Time) jwt.MapClaims {
	return jwt.MapClaims{"iss": SessionIssuer, "aud": SessionAudience, "sub": accountID.String(), "jti": sessionID.String(), "iat": now.Unix(), "exp": now.Unix() + 86400}
}
func sign(t *testing.T, claims jwt.MapClaims, method jwt.SigningMethod, header map[string]any, key any) string {
	t.Helper()
	token := jwt.NewWithClaims(method, claims)
	token.Header["typ"] = SessionTokenType
	for name, value := range header {
		token.Header[name] = value
	}
	raw, err := token.SignedString(key)
	if err != nil {
		t.Fatal(err)
	}
	return raw
}

func TestIssueAndBoundaryValidation(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 123456789, time.UTC)
	key := testKey()
	service, err := NewTokens(key, func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	// Service must retain its own copy of the key.
	key[0] ^= 1
	token, err := service.Issue(accountID, sessionID)
	if err != nil {
		t.Fatal(err)
	}
	claims := token.Claims()
	if claims.IssuedAt.Nanosecond() != 0 || claims.ExpiresAt.Sub(claims.IssuedAt) != 24*time.Hour || claims.AccountID != accountID || claims.SessionID != sessionID {
		t.Fatal("incorrect session claims")
	}
	if verified, err := service.Verify(token.Value()); err != nil || verified != claims {
		t.Fatal("issued token rejected", err)
	}
	second, err := NewTokens(testKey(), func() time.Time { return now })
	if err != nil {
		t.Fatal(err)
	}
	if _, err := second.Verify(token.Value()); err != nil {
		t.Fatal("token failed ordinary restart", err)
	}
	if token.Digest() != TokenDigest(token.Value()) || len(token.Digest()) != 64 {
		t.Fatal("incorrect session digest")
	}
	for _, item := range []any{token, service} {
		if data, err := json.Marshal(item); err != nil || string(data) != "{}" {
			t.Fatal("secret exported to JSON", err)
		}
		for _, format := range []string{"%v", "%+v", "%#v"} {
			if value := fmt.Sprintf(format, item); strings.Contains(value, token.Value()) || strings.Contains(value, string(testKey())) {
				t.Fatal("secret exported to formatting")
			}
		}
	}
	now = claims.ExpiresAt.Add(-time.Nanosecond)
	if _, err := service.Verify(token.Value()); err != nil {
		t.Fatal("token expired too early", err)
	}
	now = claims.ExpiresAt
	if _, err := service.Verify(token.Value()); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("token accepted at exp", err)
	}
	now = claims.ExpiresAt.Add(time.Second)
	if _, err := service.Verify(token.Value()); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("expired token accepted", err)
	}
}

func TestIssuedAtSkewDoesNotExtendExpiry(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	service, _ := NewTokens(testKey(), func() time.Time { return now })
	for _, delta := range []time.Duration{30 * time.Second, 30*time.Second + time.Nanosecond} {
		issued := now.Add(30 * time.Second)
		raw := sign(t, validClaims(issued), jwt.SigningMethodHS256, nil, testKey())
		checkAt := issued.Add(-delta)
		checker, _ := NewTokens(testKey(), func() time.Time { return checkAt })
		_, err := checker.Verify(raw)
		if (delta == 30*time.Second) != (err == nil) {
			t.Fatal("incorrect iat skew boundary", delta, err)
		}
	}
	claims := validClaims(now.Add(-24 * time.Hour))
	if _, err := service.Verify(sign(t, claims, jwt.SigningMethodHS256, nil, testKey())); !errors.Is(err, ErrInvalidToken) {
		t.Fatal("iat leeway extended expiry", err)
	}
}

func TestJWTRejectsInvalidHeadersAndClaims(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	service, _ := NewTokens(testKey(), func() time.Time { return now })
	for _, test := range []struct {
		name, key string
		value     any
		remove    bool
	}{
		{"missing issuer", "iss", nil, true}, {"wrong issuer", "iss", "other", false}, {"missing audience", "aud", nil, true}, {"wrong audience", "aud", "other", false},
		{"missing subject", "sub", nil, true}, {"non UUID subject", "sub", "admin", false}, {"nil subject", "sub", uuid.Nil.String(), false}, {"numeric subject", "sub", 123, false},
		{"short UUID subject", "sub", strings.ReplaceAll(accountID.String(), "-", ""), false}, {"missing jti", "jti", nil, true}, {"invalid jti", "jti", "session", false}, {"nil jti", "jti", uuid.Nil.String(), false},
		{"missing iat", "iat", nil, true}, {"null iat", "iat", nil, false}, {"float iat", "iat", float64(now.Unix()) + 0.5, false}, {"decimal integer iat", "iat", json.Number(fmt.Sprintf("%d.0", now.Unix())), false}, {"string iat", "iat", fmt.Sprint(now.Unix()), false},
		{"negative iat", "iat", -1, false}, {"future iat", "iat", now.Unix() + 31, false}, {"overflow iat", "iat", json.Number("9223372036854775807"), false},
		{"missing exp", "exp", nil, true}, {"null exp", "exp", nil, false}, {"float exp", "exp", float64(now.Unix()+86400) + 0.5, false}, {"string exp", "exp", fmt.Sprint(now.Unix() + 86400), false},
		{"wrong lifetime", "exp", now.Unix() + 86401, false}, {"past exp", "exp", now.Unix(), false}, {"future nbf", "nbf", now.Unix() + 1, false},
	} {
		t.Run(test.name, func(t *testing.T) {
			claims := validClaims(now)
			if test.remove {
				delete(claims, test.key)
			} else {
				claims[test.key] = test.value
			}
			raw := sign(t, claims, jwt.SigningMethodHS256, nil, testKey())
			if _, err := service.Verify(raw); !errors.Is(err, ErrInvalidToken) {
				t.Fatal("invalid token accepted", err)
			}
		})
	}
	for _, test := range []struct {
		name   string
		method jwt.SigningMethod
		header map[string]any
		key    any
	}{
		{"HS384", jwt.SigningMethodHS384, nil, testKey()}, {"HS512", jwt.SigningMethodHS512, nil, testKey()},
		{"none", jwt.SigningMethodNone, nil, jwt.UnsafeAllowNoneSignatureType},
		{"wrong typ", jwt.SigningMethodHS256, map[string]any{"typ": "JWT"}, testKey()},
		{"nonstring typ", jwt.SigningMethodHS256, map[string]any{"typ": []string{SessionTokenType}}, testKey()},
		{"wrong key", jwt.SigningMethodHS256, nil, []byte(strings.Repeat("x", 32))},
		{"unknown critical header", jwt.SigningMethodHS256, map[string]any{"crit": []string{"custom"}}, testKey()},
	} {
		t.Run(test.name, func(t *testing.T) {
			raw := sign(t, validClaims(now), test.method, test.header, test.key)
			if _, err := service.Verify(raw); !errors.Is(err, ErrInvalidToken) {
				t.Fatal("invalid token accepted", err)
			}
		})
	}
	// RFC-compliant single-element audience array remains accepted.
	claims := validClaims(now)
	claims["aud"] = []string{SessionAudience}
	if _, err := service.Verify(sign(t, claims, jwt.SigningMethodHS256, nil, testKey())); err != nil {
		t.Fatal(err)
	}
}

func signJSON(header, payload string) string {
	content := base64.RawURLEncoding.EncodeToString([]byte(header)) + "." + base64.RawURLEncoding.EncodeToString([]byte(payload))
	mac := hmac.New(sha256.New, testKey())
	mac.Write([]byte(content))
	return content + "." + base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

func TestJWTRejectsAmbiguousOrMalformedEncoding(t *testing.T) {
	now := time.Date(2026, 10, 20, 12, 0, 0, 0, time.UTC)
	service, _ := NewTokens(testKey(), func() time.Time { return now })
	claims, _ := json.Marshal(validClaims(now))
	header := `{"alg":"HS256","typ":"ryadom-session+jwt"}`
	raw := signJSON(header, string(claims))
	if _, err := service.Verify(raw); err != nil {
		t.Fatal(err)
	}
	for _, malformed := range []string{
		"", raw + ".extra", strings.Repeat("a", 4097), raw[:len(raw)-1], raw + "=", raw + "\n",
		signJSON(`{"alg":"HS256","alg":"none","typ":"ryadom-session+jwt"}`, string(claims)),
		signJSON(header, strings.TrimSuffix(string(claims), "}")+`,"iat":0}`),
		signJSON(header, "null"), signJSON("null", string(claims)), signJSON(header, string(claims)+"{}"),
	} {
		if _, err := service.Verify(malformed); !errors.Is(err, ErrInvalidToken) {
			t.Fatal("malformed token accepted", err)
		}
	}
}

func TestTokenConfigurationAndDigest(t *testing.T) {
	if _, err := NewTokens(make([]byte, 31), nil); !errors.Is(err, ErrInvalidTokenKey) {
		t.Fatal(err)
	}
	service, err := NewTokens(make([]byte, 32), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := service.Issue(uuid.Nil, sessionID); !errors.Is(err, ErrInvalidTokenIDs) {
		t.Fatal(err)
	}
	if _, err := service.Issue(accountID, uuid.Nil); !errors.Is(err, ErrInvalidTokenIDs) {
		t.Fatal(err)
	}
	if TokenDigest("abc") != "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad" {
		t.Fatal("SHA-256 mismatch")
	}
	ancient, _ := NewTokens(testKey(), func() time.Time { return time.Unix(-1, 0) })
	if _, err := ancient.Issue(accountID, sessionID); !errors.Is(err, ErrInvalidClock) {
		t.Fatal(err)
	}
}

func FuzzJWTValidation(f *testing.F) {
	now := time.Unix(1792497600, 0)
	service, _ := NewTokens(testKey(), func() time.Time { return now })
	token, _ := service.Issue(accountID, sessionID)
	f.Add(token.Value())
	f.Add("")
	f.Fuzz(func(t *testing.T, raw string) {
		claims, err := service.Verify(raw)
		if err == nil && (claims.AccountID == uuid.Nil || claims.SessionID == uuid.Nil || claims.ExpiresAt.Sub(claims.IssuedAt) != SessionLifetime) {
			t.Fatal("invalid verified claims")
		}
	})
}
