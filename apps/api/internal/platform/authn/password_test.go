package authn

import (
	"errors"
	"strings"
	"testing"
)

// Generated independently with native libargon2, not this Go implementation.
const goldenPHC = "$argon2id$v=19$m=19456,t=2,p=1$AAECAwQFBgcICQoLDA0ODw$qvnjQBijE8RVlj3zaEQyjKBJ/jeP8iBE9ZFsnX3iAZ4"

func TestPasswordNativeVector(t *testing.T) {
	const password = "  Пароль без обрезки 🏃  "
	for _, test := range []struct {
		password string
		want     bool
	}{
		{password, true}, {strings.TrimSpace(password), false}, {password + "x", false}, {"wrong-password", false},
	} {
		got, err := VerifyPassword(test.password, goldenPHC)
		if err != nil || got != test.want {
			t.Fatalf("verification got %t / %v, want %t", got, err, test.want)
		}
	}
}

func TestPasswordsPreserveUnicodeAndUseFreshSalts(t *testing.T) {
	for _, password := range []string{"  Пароль без обрезки 🏃  ", strings.Repeat("я", 15), strings.Repeat("🏃", 128), strings.Repeat(" ", 15), "e\u0301" + strings.Repeat("x", 14)} {
		first, err := HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		second, err := HashPassword(password)
		if err != nil {
			t.Fatal(err)
		}
		if first == second {
			t.Fatal("salt reused")
		}
		if _, _, err := parsePasswordHash(first); err != nil {
			t.Fatal("nonconforming PHC", err)
		}
		if ok, err := VerifyPassword(password, first); err != nil || !ok {
			t.Fatal("password did not round trip", err)
		}
		if strings.HasPrefix(password, "e\u0301") {
			if ok, err := VerifyPassword("é"+strings.Repeat("x", 14), first); err != nil || ok {
				t.Fatal("password normalization changed identity", err)
			}
		}
	}
}

func TestPasswordLengthAndMalformedPHC(t *testing.T) {
	for _, password := range []string{"", strings.Repeat("я", 14), strings.Repeat("🏃", 129), "\xff" + strings.Repeat("x", 20)} {
		if _, err := HashPassword(password); !errors.Is(err, ErrInvalidPassword) {
			t.Fatal("invalid registration password accepted", err)
		}
	}
	for _, password := range []string{"", strings.Repeat("x", 129), "\xff"} {
		if ok, err := VerifyPassword(password, goldenPHC); ok || !errors.Is(err, ErrInvalidPassword) {
			t.Fatal("invalid login password accepted", err)
		}
	}
	if ok, err := VerifyPassword("x", goldenPHC); err != nil || ok {
		t.Fatal("one-character login password was not checked", err)
	}
	for _, encoded := range []string{
		"", "plaintext", strings.Replace(goldenPHC, "argon2id", "argon2i", 1), strings.Replace(goldenPHC, "v=19", "v=16", 1),
		strings.Replace(goldenPHC, "19456", "4294967295", 1), strings.Replace(goldenPHC, "t=2", "t=2000", 1), strings.Replace(goldenPHC, "p=1", "p=0", 1),
		goldenPHC + "$extra", strings.Replace(goldenPHC, "DA0ODw$", "DA0ODw==$", 1), strings.Replace(goldenPHC, "DA0ODw$", "DA0ODx$", 1), goldenPHC[:len(goldenPHC)-1],
		goldenPHC + strings.Repeat("a", 500), strings.Replace(goldenPHC, "DA0ODw$", "DA0O\nDw$", 1),
	} {
		if ok, err := VerifyPassword("correct-length-password", encoded); ok || !errors.Is(err, ErrInvalidPasswordHash) {
			t.Fatal("malformed PHC accepted", err)
		}
	}
}

func TestUnknownEmailPaddingNeverAuthenticates(t *testing.T) {
	// Even the public padding hash's known input cannot authenticate a missing row.
	for _, password := range []string{"ryadom-internal-dummy-password", "wrong-password"} {
		if ok, err := VerifyLoginPassword(password, ""); err != nil || ok {
			t.Fatal("unknown account authenticated", err)
		}
	}
	if ok, err := VerifyLoginPassword("  Пароль без обрезки 🏃  ", goldenPHC); err != nil || !ok {
		t.Fatal("stored account rejected", err)
	}
}

func FuzzPasswordHashParser(f *testing.F) {
	f.Add(goldenPHC)
	f.Add("")
	f.Fuzz(func(t *testing.T, input string) {
		salt, key, err := parsePasswordHash(input)
		if err == nil && (len(salt) != passwordSaltBytes || len(key) != passwordKeyBytes) {
			t.Fatal("unbounded PHC accepted")
		}
	})
}
