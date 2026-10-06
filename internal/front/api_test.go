package front

import (
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"playground/core/pilot"
	"playground/core/server"
	"playground/internal/protocol"
	"playground/internal/stats"
)

type roomsBody struct {
	Rooms []struct {
		Code   string `json:"code"`
		Humans int    `json:"humans"`
		Seats  int    `json:"seats"`
		Map    string `json:"map"`
	} `json:"rooms"`
}

func getRooms(t *testing.T, url string) (int, roomsBody, http.Header) {
	t.Helper()
	res, err := http.Get(url + "/api/rooms")
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	var b roomsBody
	_ = json.NewDecoder(res.Body).Decode(&b)
	return res.StatusCode, b, res.Header
}

func TestAPIRoomsListsOnlyListedRooms(t *testing.T) {
	now := time.Unix(1000, 0)
	srv := newServer(t, server.Options{Now: func() time.Time { return now }})
	code, body, h := getRooms(t, srv.URL)
	if code != 200 || len(body.Rooms) != 0 || h.Get("Content-Type") != "application/json; charset=utf-8" || h.Get("Cache-Control") != "no-store" {
		t.Fatalf("%d %+v %v", code, body, h)
	}
	open := dial(t, srv)
	open.send(hello("a"))
	open.send(protocol.ClientMsg{T: "create", Mode: "team", Size: 2, Diff: "easy", Map: "col"})
	open.until("welcome", 2*time.Second, nil)
	private := dial(t, srv)
	private.send(hello("b"))
	private.send(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 2, Diff: "easy", Vis: "ozel"})
	private.until("welcome", 2*time.Second, nil)
	if _, body, _ = getRooms(t, srv.URL); len(body.Rooms) != 0 {
		t.Fatal("cached for 1 s")
	}
	now = now.Add(1100 * time.Millisecond)
	_, body, _ = getRooms(t, srv.URL)
	if len(body.Rooms) != 1 || body.Rooms[0].Humans != 1 || body.Rooms[0].Seats != 4 || body.Rooms[0].Map != "col" {
		t.Fatalf("rooms %+v", body.Rooms)
	}
}

func TestAPIRateLimited(t *testing.T) {
	srv := newServer(t, server.Options{Limits: server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000, APIPerMinIP: 60, APIBurst: 5}})
	limited := false
	for range 10 {
		if code, _, _ := getRooms(t, srv.URL); code == http.StatusTooManyRequests {
			limited = true
		}
	}
	if !limited {
		t.Fatal("6th rapid call must be refused")
	}
}

func storeServer(t *testing.T) (*httptest.Server, *stats.Store) {
	st, err := stats.Open(t.TempDir(), stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl := stats.NewSlot()
	sl.Set(st)
	t.Cleanup(func() { sl.Close() })
	return newServer(t, server.Options{Stats: NewStats(sl)}), st
}

func TestLeaderboard(t *testing.T) {
	srv, st := storeServer(t)
	st.Record(stats.Delta{Pilot: pilot.Hash("AAAAAAAAAAAAAAAAAAAAAA"), Name: "Maverick", Kills: 4, Flight: 3600})
	st.Me("x") // barrier: the record is applied
	code, body := get(t, srv.URL+"/api/leaderboard?period=all")
	if code != 200 || !strings.Contains(body, `"name":"Maverick"`) || !strings.Contains(body, `"period":"all"`) {
		t.Fatalf("%d %s", code, body)
	}
	if code, body := get(t, srv.URL+"/api/leaderboard?period=week"); code != 200 || !strings.Contains(body, `"period":"week"`) || !strings.Contains(body, `"week":"`) {
		t.Fatalf("week: %d %s", code, body)
	}
	if code, _ := get(t, srv.URL+"/api/leaderboard?period=year"); code != 400 {
		t.Fatalf("bad period: %d", code)
	}
	plain := newServer(t, server.Options{})
	if code, body := get(t, plain.URL+"/api/leaderboard?period=week"); code != 503 || body != `{"code":"stats_off","error":"istatistik kapalı"}` {
		t.Fatalf("stats off: %d %s", code, body)
	}
}

// An empty board is an empty list, never null.
func TestLeaderboardEmpty(t *testing.T) {
	srv, _ := storeServer(t)
	if code, body := get(t, srv.URL+"/api/leaderboard?period=week"); code != 200 || !strings.Contains(body, `"top":[]`) {
		t.Fatalf("%d %s", code, body)
	}
}

func TestMeRejectsBadTokens(t *testing.T) {
	srv, st := storeServer(t)
	good := "AAAAAAAAAAAAAAAAAAAAAA"
	st.Record(stats.Delta{Pilot: pilot.Hash(good), Name: "A", Kills: 1, Flight: 3600, Kinds: map[string]int{"su27": 9}})
	st.Me("x")
	me := func(tok string) (int, string) {
		req, _ := http.NewRequest("GET", srv.URL+"/api/me", nil)
		if tok != "" {
			req.Header.Set(pilot.Header, tok)
		}
		res, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		defer res.Body.Close()
		if res.Header.Get("Cache-Control") != "no-store" {
			t.Fatal("me must be no-store")
		}
		b, _ := io.ReadAll(res.Body)
		return res.StatusCode, string(b)
	}
	// Missing, malformed, oversize and unknown tokens all get the same 200
	// {"pilot":null}: nothing tells "bad token" from "no stats yet".
	for _, bad := range []string{"", "nope", strings.Repeat("A", 8192), "BBBBBBBBBBBBBBBBBBBBBB"} {
		start := time.Now()
		code, body := me(bad)
		if code != 200 || body != `{"pilot":null}` {
			t.Fatalf("token %.20q: %d %s", bad, code, body)
		}
		if time.Since(start) > time.Second {
			t.Fatal("bad tokens must be answered fast")
		}
	}
	if code, body := me(good); code != 200 || !strings.HasPrefix(body, `{"pilot":{`) || !strings.Contains(body, `"favorite":"su27"`) || !strings.Contains(body, `"kills":1`) || strings.Contains(body, good) {
		t.Fatalf("%d %s", code, body)
	}
	plain := newServer(t, server.Options{})
	if code, _ := get(t, plain.URL+"/api/me"); code != 503 {
		t.Fatalf("stats off: %d", code)
	}
}

// Unknown API paths answer JSON, not the client's HTML 404.
func TestUnknownAPIPathIsJSON(t *testing.T) {
	srv := newServer(t, server.Options{Web: web})
	res, err := http.Get(srv.URL + "/api/nope")
	if err != nil {
		t.Fatal(err)
	}
	res.Body.Close()
	if res.StatusCode != 404 || !strings.HasPrefix(res.Header.Get("Content-Type"), "application/json") {
		t.Fatalf("%d %s", res.StatusCode, res.Header.Get("Content-Type"))
	}
}
