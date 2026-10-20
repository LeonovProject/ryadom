package authn

import (
	"errors"
	"net"
	"net/http"
	"net/netip"
)

var ErrInvalidClientIP = errors.New("invalid client address")

type ClientIPs struct{ trusted []netip.Prefix }

// NewClientIPs accepts only explicitly configured proxy networks. An empty list
// uses the TCP peer and ignores all client-supplied forwarding headers.
func NewClientIPs(trusted []netip.Prefix) (*ClientIPs, error) {
	copyOf := append([]netip.Prefix(nil), trusted...)
	for i, prefix := range copyOf {
		if !prefix.IsValid() || prefix.Addr().Is4In6() {
			return nil, ErrInvalidClientIP
		}
		copyOf[i] = prefix.Masked()
	}
	return &ClientIPs{trusted: copyOf}, nil
}

func (c *ClientIPs) Resolve(request *http.Request) (netip.Addr, error) {
	host, _, err := net.SplitHostPort(request.RemoteAddr)
	if err != nil {
		return netip.Addr{}, ErrInvalidClientIP
	}
	peer, err := netip.ParseAddr(host)
	if err != nil || peer.Zone() != "" {
		return netip.Addr{}, ErrInvalidClientIP
	}
	peer = peer.Unmap()
	trusted := false
	for _, prefix := range c.trusted {
		if prefix.Contains(peer) {
			trusted = true
			break
		}
	}
	if !trusted {
		return peer, nil
	}
	// OPS-01 must overwrite this header at the trusted Nginx boundary.
	// X-Forwarded-For chains and Forwarded are never used as an alternative.
	values := request.Header.Values("X-Real-IP")
	if len(values) == 0 {
		return peer, nil
	}
	if len(values) != 1 {
		return netip.Addr{}, ErrInvalidClientIP
	}
	ip, err := netip.ParseAddr(values[0])
	if err != nil || ip.Zone() != "" {
		return netip.Addr{}, ErrInvalidClientIP
	}
	return ip.Unmap(), nil
}
