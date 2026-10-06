package server

import (
	"net/http"
	"net/http/httptest"
	"net/netip"
	"testing"
)

func TestParsePrefixes(t *testing.T) {
	ps, err := ParsePrefixes(" 172.16.0.0/12, 127.0.0.0/8 ,::1,10.1.2.3/8")
	if err != nil || len(ps) != 4 || ps[2].String() != "::1/128" || ps[3].String() != "10.0.0.0/8" {
		t.Fatalf("%v %v", ps, err)
	}
	if ps, err := ParsePrefixes(""); err != nil || ps != nil {
		t.Fatalf("empty: %v %v", ps, err)
	}
	for _, bad := range []string{"nope", "1.2.3.4/33", "1.2.3/8"} {
		if _, err := ParsePrefixes(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func TestClientIP(t *testing.T) {
	proxies, _ := ParsePrefixes("172.16.0.0/12,127.0.0.0/8")
	for name, tc := range map[string]struct {
		remote, realIP string
		trusted        bool
		want           string
	}{
		"direct, no trust":       {"203.0.113.9:5000", "", false, "203.0.113.9"},
		"spoofed header ignored": {"203.0.113.9:5000", "1.1.1.1", true, "203.0.113.9"},
		"untrusted proxy list":   {"127.0.0.1:5000", "1.1.1.1", false, "127.0.0.1"},
		"docker bridge proxy":    {"172.17.0.1:40000", "198.51.100.7", true, "198.51.100.7"},
		"loopback proxy":         {"127.0.0.1:40000", "198.51.100.7", true, "198.51.100.7"},
		"first valid of list":    {"127.0.0.1:1", "junk, 2001:db8::5 ,9.9.9.9", true, "2001:db8::5"},
		"mapped v4":              {"127.0.0.1:1", "::ffff:198.51.100.7", true, "198.51.100.7"},
		"garbage header":         {"127.0.0.1:1", "junk", true, "127.0.0.1"},
		"missing header":         {"172.18.0.5:1", "", true, "172.18.0.5"},
	} {
		t.Run(name, func(t *testing.T) {
			r := httptest.NewRequest("GET", "/ws", nil)
			r.RemoteAddr = tc.remote
			if tc.realIP != "" {
				r.Header.Set("X-Real-IP", tc.realIP)
			}
			var trust []netip.Prefix
			if tc.trusted {
				trust = proxies
			}
			if got := clientIP(r, trust).String(); got != tc.want {
				t.Fatalf("got %s want %s", got, tc.want)
			}
		})
	}
}

func TestLimitKeyGroupsIPv6By48(t *testing.T) {
	a := limitKey(netip.MustParseAddr("2001:db8:1:2:aaaa::1"))
	b := limitKey(netip.MustParseAddr("2001:db8:1:ffff:bbbb::9")) // other /64, same /48
	c := limitKey(netip.MustParseAddr("2001:db8:2::1"))           // next /48
	if a != b || a == c || a != "2001:db8:1::/48" {
		t.Fatalf("%s %s %s", a, b, c)
	}
	if k := limitKey(netip.MustParseAddr("198.51.100.7")); k != "198.51.100.7" {
		t.Fatal(k)
	}
	if k := limitKey(netip.MustParseAddr("198.51.100.8")); k != "198.51.100.8" {
		t.Fatal(k) // IPv4 neighbours stay separate
	}
}

// One IPv6 /48 shares one per-address connection cap however many /64s it
// spreads over; the next /48 and IPv4 addresses are counted on their own.
func TestPerIPConnLimitIPv6By48(t *testing.T) {
	proxies, _ := ParsePrefixes("127.0.0.0/8")
	srv := newServer(t, Options{TrustProxy: proxies, Limits: tight(func(l *Limits) { l.MaxConnsIP = 2 })})
	ip := func(a string) http.Header { return http.Header{"X-Real-IP": {a}} }
	for _, a := range []string{"2001:db8:7:1::1", "2001:db8:7:2::1"} {
		if _, code := rawDial(t, srv.URL, ip(a)); code != 101 {
			t.Fatalf("%s under cap = %d", a, code)
		}
	}
	if _, code := rawDial(t, srv.URL, ip("2001:db8:7:ffff::1")); code != http.StatusTooManyRequests {
		t.Fatalf("3rd conn from one /48 (third /64) = %d, want 429", code)
	}
	for _, a := range []string{"2001:db8:8::1", "198.51.100.1", "198.51.100.2"} {
		if _, code := rawDial(t, srv.URL, ip(a)); code != 101 {
			t.Fatalf("%s (own key) = %d", a, code)
		}
	}
}
