package front

import (
	"context"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/pilot"
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/match"
	"playground/internal/moderation"
	"playground/internal/protocol"
	"playground/internal/stats"
)

// Made-up pattern; real entries live only in the server's moderation.json.
const testPattern = "zorlu kartal"

func blockedNames(t *testing.T) *moderation.Names {
	t.Helper()
	n, err := moderation.Open(t.TempDir(), nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := n.Block(testPattern); err != nil {
		t.Fatal(err)
	}
	return n
}

// A hello with a blocked name gets an error frame with code name_blocked
// for every entry (quick, create, join) and is never seated: the room it
// tried has no human.
func TestBlockedNameRefusedAtHandshake(t *testing.T) {
	names := blockedNames(t)
	ctx, cancel := context.WithCancel(context.Background())
	lb := match.NewLobby(ctx, 0, nil, nil, nil, match.Moderation{Names: names})
	srv := httptest.NewServer(NewServer(lb, server.Options{Limits: server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}}))
	t.Cleanup(func() { cancel(); srv.Close() })

	host := dial(t, srv)
	host.send(protocol.ClientMsg{T: "hello", V: protocol.Version, Name: "Ali"})
	host.send(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 4, Diff: "easy"})
	var w struct{ Code string }
	json.Unmarshal(host.until("welcome", 5*time.Second, nil), &w)

	for _, entry := range []protocol.ClientMsg{{T: "join", Code: w.Code}, {T: "quick"}, {T: "create", Mode: "ffa", Size: 4, Diff: "easy"}} {
		c := dial(t, srv)
		c.send(protocol.ClientMsg{T: "hello", V: protocol.Version, Name: "Z0rlu  K4rtal"})
		c.send(entry)
		b := c.until("error", 5*time.Second, nil)
		var e struct{ Code string }
		json.Unmarshal(b, &e)
		if e.Code != protocol.CodeNameBlocked {
			t.Fatalf("%s: %s", entry.T, b)
		}
		if !c.closed(5 * time.Second) {
			t.Fatalf("%s: not closed", entry.T)
		}
	}
	for _, r := range lb.List() {
		if r.Code == w.Code && r.Humans != 1 {
			t.Fatalf("host's room has %d humans", r.Humans)
		}
	}
}

// Rows of blocked names are hidden from both boards, the next ones move up.
func TestLeaderboardHidesBlockedNames(t *testing.T) {
	names := blockedNames(t)
	st, err := stats.Open(t.TempDir(), stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	sl.Set(st)
	t.Cleanup(func() { sl.Close() })
	srv := newServer(t, server.Options{Stats: NewStats(sl, names.Blocked)})
	st.Record(stats.Delta{Pilot: pilot.Hash("AAAAAAAAAAAAAAAAAAAAAA"), Name: "ZORLU KARTAL", Kills: 9, Flight: 3600})
	st.Record(stats.Delta{Pilot: pilot.Hash("BBBBBBBBBBBBBBBBBBBBBB"), Name: "Maverick", Kills: 4, Flight: 3600})
	st.Me("x") // barrier
	for _, p := range []string{"week", "all"} {
		code, body := get(t, srv.URL+"/api/leaderboard?period="+p)
		if code != 200 || strings.Contains(strings.ToLower(body), "zorlu") || !strings.Contains(body, `"name":"Maverick"`) {
			t.Fatalf("%s: %d %s", p, code, body)
		}
	}
}

// The admin routes live only on the loopback metrics listener: the public
// server knows nothing of them (GET 404; other methods are not routed).
func TestPublicServerHasNoAdmin(t *testing.T) {
	srv := newServer(t, server.Options{Web: web})
	for _, path := range []string{"/admin/list", "/admin/block", "/admin/lookup", "/admin/purge-name", "/admin/unblock", "/admin/sessions"} {
		if code, _ := get(t, srv.URL+path); code != http.StatusNotFound {
			t.Errorf("GET %s = %d", path, code)
		}
		res, err := http.Post(srv.URL+path, "text/plain", strings.NewReader(testPattern))
		if err != nil {
			t.Fatal(err)
		}
		res.Body.Close()
		if res.StatusCode < 400 {
			t.Errorf("POST %s = %d", path, res.StatusCode)
		}
	}
}
