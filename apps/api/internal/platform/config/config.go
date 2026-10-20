package config

import (
	"encoding/base64"
	"fmt"
	"net"
	"net/netip"
	"net/url"
	"strconv"
	"strings"
)

type Config struct {
	DemoMode          bool
	Address           string
	DatabaseURL       string
	SchemaVersion     int64
	WebOrigin         string
	CookieSecure      bool
	JWTSecret         []byte
	AvatarPresetsFile string
	TrustedProxyCIDRs []netip.Prefix
}

// Load validates configuration without connecting to PostgreSQL. There are no secrets in errors.
func Load(getenv func(string) string) (Config, error) {
	c := Config{Address: getenv("API_ADDR"), DatabaseURL: getenv("DATABASE_URL"), WebOrigin: getenv("WEB_ORIGIN"), CookieSecure: true}
	if c.Address == "" {
		c.Address = ":8080"
	}
	if _, _, err := net.SplitHostPort(c.Address); err != nil {
		return Config{}, fmt.Errorf("API_ADDR must be host:port")
	}
	u, err := url.Parse(c.DatabaseURL)
	if err != nil || (u.Scheme != "postgres" && u.Scheme != "postgresql") || u.Host == "" || u.Path == "" {
		return Config{}, fmt.Errorf("DATABASE_URL must be a PostgreSQL URL with a database name")
	}
	c.SchemaVersion, err = strconv.ParseInt(getenv("DATABASE_SCHEMA_VERSION"), 10, 64)
	if err != nil || c.SchemaVersion < 1 {
		return Config{}, fmt.Errorf("DATABASE_SCHEMA_VERSION must be the positive goose version required by this release")
	}
	if !ValidOrigin(c.WebOrigin) {
		return Config{}, fmt.Errorf("WEB_ORIGIN must be one exact http(s) origin without path or trailing slash")
	}
	if raw := getenv("DEMO_MODE"); raw != "" {
		c.DemoMode, err = strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("DEMO_MODE must be a boolean")
		}
	}
	allowInsecureHTTP := false
	if raw := getenv("ALLOW_INSECURE_HTTP"); raw != "" {
		allowInsecureHTTP, err = strconv.ParseBool(raw)
		if err != nil {
			return Config{}, fmt.Errorf("ALLOW_INSECURE_HTTP must be a boolean")
		}
	}
	if allowInsecureHTTP && !c.DemoMode {
		return Config{}, fmt.Errorf("ALLOW_INSECURE_HTTP requires DEMO_MODE=true")
	}
	if v := getenv("COOKIE_SECURE"); v != "" {
		c.CookieSecure, err = strconv.ParseBool(v)
		if err != nil {
			return Config{}, fmt.Errorf("COOKIE_SECURE must be a boolean")
		}
	}
	if strings.HasPrefix(c.WebOrigin, "http:") && c.CookieSecure {
		return Config{}, fmt.Errorf("HTTP requires explicit COOKIE_SECURE=false")
	}
	if origin, _ := url.Parse(c.WebOrigin); origin.Scheme == "http" && origin.Hostname() != "localhost" {
		ip := net.ParseIP(origin.Hostname())
		if (ip == nil || !ip.IsLoopback()) && !allowInsecureHTTP {
			return Config{}, fmt.Errorf("network HTTP requires DEMO_MODE=true and ALLOW_INSECURE_HTTP=true")
		}
	}
	if strings.HasPrefix(c.WebOrigin, "https:") && !c.CookieSecure {
		return Config{}, fmt.Errorf("HTTPS requires COOKIE_SECURE=true")
	}
	c.JWTSecret, err = base64.StdEncoding.Strict().DecodeString(getenv("AUTH_JWT_SECRET"))
	if err != nil || len(c.JWTSecret) < 32 {
		return Config{}, fmt.Errorf("AUTH_JWT_SECRET must be base64 encoding of at least 32 random bytes")
	}
	c.AvatarPresetsFile = getenv("AVATAR_PRESETS_FILE")
	if c.AvatarPresetsFile == "" {
		c.AvatarPresetsFile = "../../packages/contracts/avatar-presets.json"
	}
	if raw := getenv("TRUSTED_PROXY_CIDRS"); raw != "" {
		for _, item := range strings.Split(raw, ",") {
			prefix, err := netip.ParsePrefix(strings.TrimSpace(item))
			if err != nil || prefix.Addr().Is4In6() {
				return Config{}, fmt.Errorf("TRUSTED_PROXY_CIDRS must contain IP network prefixes")
			}
			c.TrustedProxyCIDRs = append(c.TrustedProxyCIDRs, prefix.Masked())
		}
	}
	return c, nil
}

func ValidOrigin(raw string) bool {
	u, err := url.Parse(raw)
	return err == nil && (u.Scheme == "http" || u.Scheme == "https") && u.Hostname() != "" && u.User == nil && raw == u.Scheme+"://"+u.Host
}
