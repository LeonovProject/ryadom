package authn

import (
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestUntrustedPeerCannotSetClientIP(t *testing.T) {
	for _, prefixes := range [][]netip.Prefix{nil, {netip.MustParsePrefix("10.0.0.0/24")}} {
		resolver, err := NewClientIPs(prefixes)
		if err != nil {
			t.Fatal(err)
		}
		r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
		r.RemoteAddr = "192.0.2.1:12345"
		r.Header.Set("X-Real-IP", "203.0.113.99")
		r.Header.Set("X-Forwarded-For", "203.0.113.98")
		r.Header.Set("Forwarded", "for=203.0.113.97")
		if ip, err := resolver.Resolve(r); err != nil || ip.String() != "192.0.2.1" {
			t.Fatal("untrusted forwarding accepted", ip, err)
		}
	}
}

func TestTrustedProxyMustSupplyOneUnambiguousIP(t *testing.T) {
	resolver, _ := NewClientIPs([]netip.Prefix{netip.MustParsePrefix("10.0.0.0/24"), netip.MustParsePrefix("2001:db8::/64")})
	for _, test := range []struct {
		name, remote string
		headers      []string
		want         string
	}{
		{"trusted v4", "10.0.0.2:12345", []string{"198.51.100.3"}, "198.51.100.3"},
		{"trusted v6", "[2001:db8::1]:12345", []string{"2001:db8:1::2"}, "2001:db8:1::2"},
		{"mapped IP", "10.0.0.2:12345", []string{"::ffff:198.51.100.3"}, "198.51.100.3"},
		{"missing header uses peer", "10.0.0.2:12345", nil, "10.0.0.2"},
		{"two header lines", "10.0.0.2:12345", []string{"198.51.100.3", "198.51.100.4"}, ""},
		{"chain", "10.0.0.2:12345", []string{"198.51.100.3, 198.51.100.4"}, ""},
		{"IP plus port", "10.0.0.2:12345", []string{"198.51.100.3:12"}, ""},
		{"blank", "10.0.0.2:12345", []string{""}, ""},
		{"host name", "10.0.0.2:12345", []string{"localhost"}, ""},
		{"v6 zone", "10.0.0.2:12345", []string{"fe80::1%eth0"}, ""},
		{"invalid peer", "invalid", nil, ""},
	} {
		t.Run(test.name, func(t *testing.T) {
			r := httptest.NewRequest("POST", "/api/v1/auth/login", nil)
			r.RemoteAddr = test.remote
			for _, header := range test.headers {
				r.Header.Add("X-Real-IP", header)
			}
			r.Header.Set("X-Forwarded-For", "203.0.113.99")
			ip, err := resolver.Resolve(r)
			if test.want == "" {
				if err == nil {
					t.Fatal("ambiguous client IP accepted", ip)
				}
				return
			}
			if err != nil || ip.String() != test.want {
				t.Fatal(ip, err)
			}
		})
	}
	if _, err := NewClientIPs([]netip.Prefix{{}}); err == nil {
		t.Fatal("invalid proxy prefix accepted")
	}
	if _, err := NewClientIPs([]netip.Prefix{netip.MustParsePrefix("::ffff:192.0.2.0/120")}); err == nil {
		t.Fatal("ambiguous mapped prefix accepted")
	}
}
