package config

import (
	"encoding/base64"
	"strings"
	"testing"
)

func TestLoad(t *testing.T) {
	base := map[string]string{"DATABASE_URL": "postgres://test:password@localhost/test", "WEB_ORIGIN": "https://ryadom.example", "DATABASE_SCHEMA_VERSION": "2026102001", "AUTH_JWT_SECRET": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("s", 32)))}
	cfg, err := Load(func(key string) string { return base[key] })
	if err != nil || cfg.Address != ":8080" || !cfg.CookieSecure || cfg.SchemaVersion != 2026102001 {
		t.Fatalf("invalid config: %v", err)
	}
	for _, test := range []struct{ key, value string }{
		{"DATABASE_URL", ""}, {"DATABASE_URL", "http://wrong/database"}, {"DATABASE_SCHEMA_VERSION", "0"}, {"API_ADDR", "localhost"},
		{"WEB_ORIGIN", "null"}, {"WEB_ORIGIN", "https://ryadom.example/"}, {"WEB_ORIGIN", "https://ryadom.example?"}, {"WEB_ORIGIN", "https://user@ryadom.example"},
		{"AUTH_JWT_SECRET", "bad-secret"}, {"AUTH_JWT_SECRET", base64.StdEncoding.EncodeToString([]byte(strings.Repeat("s", 31)))}, {"COOKIE_SECURE", "false"}, {"WEB_ORIGIN", "http://localhost:8080"},
	} {
		t.Run(test.key+"/"+test.value, func(t *testing.T) {
			_, err := Load(func(key string) string {
				if key == test.key {
					return test.value
				}
				return base[key]
			})
			if err == nil {
				t.Fatal("invalid setting accepted")
			}
			if strings.Contains(err.Error(), "password") || strings.Contains(err.Error(), "bad-secret") {
				t.Fatal("configuration error leaked a secret")
			}
		})
	}
	base["WEB_ORIGIN"] = "http://localhost:8080"
	base["COOKIE_SECURE"] = "false"
	if _, err := Load(func(key string) string { return base[key] }); err != nil {
		t.Fatal(err)
	}
}

func TestProxyAndCatalogueSettings(t *testing.T) {
	values := map[string]string{"DATABASE_URL": "postgres://test@localhost/test", "WEB_ORIGIN": "https://example.test", "DATABASE_SCHEMA_VERSION": "2026102001", "AUTH_JWT_SECRET": base64.StdEncoding.EncodeToString([]byte(strings.Repeat("k", 32)))}
	get := func(key string) string { return values[key] }
	c, err := Load(get)
	if err != nil || len(c.TrustedProxyCIDRs) != 0 || c.AvatarPresetsFile != "../../packages/contracts/avatar-presets.json" {
		t.Fatal("invalid defaults", err)
	}
	values["TRUSTED_PROXY_CIDRS"] = "10.9.0.5/24, 127.0.0.1/32"
	values["AVATAR_PRESETS_FILE"] = "/assets/avatar-presets.json"
	c, err = Load(get)
	if err != nil || len(c.TrustedProxyCIDRs) != 2 || c.TrustedProxyCIDRs[0].String() != "10.9.0.0/24" || c.AvatarPresetsFile != "/assets/avatar-presets.json" {
		t.Fatal("invalid explicit settings", err)
	}
	for _, bad := range []string{"10.0.0.1", "invalid", "::ffff:127.0.0.1/128", "10.0.0.0/24,"} {
		values["TRUSTED_PROXY_CIDRS"] = bad
		if _, err := Load(get); err == nil {
			t.Fatal("invalid proxy prefix accepted")
		}
	}
}
