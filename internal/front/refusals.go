package front

import (
	"net/netip"
	"sync"
	"time"

	"github.com/ahmetbir/roomkit/limit"
	"playground/internal/audit"
)

// Refused-name audit rows cost a client nothing at admission (roomkit's
// Admitter spends no create or join token), so the rows themselves are
// limited: at most one per refusalEvery per (pilot, address), and at most
// refusalsPerMin per address (IPv6: per /64) whatever the pilot. Rows not
// written are counted into the next row of their (pilot, address) as
// Repeats.
const (
	refusalEvery   = 10 * time.Second
	refusalsPerMin = 10
	refusalKeys    = 4096 // (pilot, address) pairs remembered; beyond it, stale ones are swept, then new ones go uncounted
)

type refusals struct {
	mu    sync.Mutex
	perIP *limit.Keyed
	seen  map[string]*refusalKey
	now   func() time.Time
}

type refusalKey struct {
	last       time.Time
	suppressed int
}

func newRefusals(now func() time.Time) *refusals {
	if now == nil {
		now = time.Now
	}
	return &refusals{perIP: limit.NewKeyed(refusalsPerMin, refusalsPerMin), seen: map[string]*refusalKey{}, now: now}
}

// admit decides whether e (a name_refused row) is written; when it is,
// e.Repeats carries the rows held back for its pair since the last one.
func (r *refusals) admit(e *audit.Event, addr netip.Addr) bool {
	if r == nil {
		return true
	}
	ip := addrKey(addr)
	key := e.Pilot + "|" + ip
	now := r.now()
	r.mu.Lock()
	defer r.mu.Unlock()
	k, ok := r.seen[key]
	if !ok {
		if len(r.seen) >= refusalKeys {
			r.sweep(now)
		}
		if len(r.seen) >= refusalKeys {
			return false
		}
		k = &refusalKey{}
		r.seen[key] = k
	}
	if (!k.last.IsZero() && now.Sub(k.last) < refusalEvery) || !r.perIP.Allow(ip, now) {
		k.suppressed++
		return false
	}
	e.Repeats, k.suppressed, k.last = k.suppressed, 0, now
	return true
}

// sweep forgets pairs quiet for a minute (their held-back counts are lost).
func (r *refusals) sweep(now time.Time) {
	for key, k := range r.seen {
		if now.Sub(k.last) > time.Minute {
			delete(r.seen, key)
		}
	}
}

// addrKey is one IPv4 address or one IPv6 /64, as roomkit's per-address limits key them.
func addrKey(a netip.Addr) string {
	if !a.IsValid() {
		return ""
	}
	if a.Is6() {
		p, _ := a.Prefix(64)
		return p.String()
	}
	return a.String()
}
