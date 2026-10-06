package server

import (
	"net"
	"net/http"
	"net/netip"
	"strings"
)

// ParsePrefixes reads a comma-separated CIDR list ("" = none). A bare
// address counts as a single-host prefix.
func ParsePrefixes(s string) ([]netip.Prefix, error) {
	var out []netip.Prefix
	for p := range strings.SplitSeq(s, ",") {
		if p = strings.TrimSpace(p); p == "" {
			continue
		}
		if !strings.Contains(p, "/") {
			a, err := netip.ParseAddr(p)
			if err != nil {
				return nil, err
			}
			out = append(out, netip.PrefixFrom(a, a.BitLen()))
			continue
		}
		pre, err := netip.ParsePrefix(p)
		if err != nil {
			return nil, err
		}
		out = append(out, pre.Masked())
	}
	return out, nil
}

// clientIP is the peer address, or, when the peer is a trusted proxy, the
// first valid address in its X-Real-IP header. Invalid value = zero Addr.
func clientIP(r *http.Request, trusted []netip.Prefix) netip.Addr {
	peer := remoteAddr(r)
	if !inAny(peer, trusted) {
		return peer
	}
	for v := range strings.SplitSeq(r.Header.Get("X-Real-IP"), ",") {
		if a, err := netip.ParseAddr(strings.TrimSpace(v)); err == nil {
			return a.Unmap()
		}
	}
	return peer
}

func remoteAddr(r *http.Request) netip.Addr {
	host, _, err := net.SplitHostPort(r.RemoteAddr)
	if err != nil {
		host = r.RemoteAddr
	}
	a, _ := netip.ParseAddr(host)
	return a.Unmap()
}

func inAny(a netip.Addr, ps []netip.Prefix) bool {
	for _, p := range ps {
		if p.Contains(a) {
			return true
		}
	}
	return false
}

// limitKey groups addresses for the per-address limits: one IPv4 address,
// or one IPv6 /64 (a single subscriber usually holds a whole /64).
func limitKey(a netip.Addr) string {
	if a.Is6() {
		p, _ := a.Prefix(64)
		return p.String()
	}
	return a.String()
}
