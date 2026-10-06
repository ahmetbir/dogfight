package golden

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/http/httptest"
	"regexp"
	"sort"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"playground/internal/lobby"
	"playground/internal/metrics"
	"playground/internal/pilot"
	"playground/internal/server"
	"playground/internal/stats"
)

var web = fstest.MapFS{"index.html": {Data: []byte("<!doctype html>dogfight")}}

// newServer builds the HTTP handler the way cmd/dogfight does. The only
// code here later tasks may change (constructors move).
func newServer(t *testing.T, maxRooms int, lim server.Limits, st *stats.Slot) (*httptest.Server, *server.Server) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	o := server.Options{Web: web, Limits: lim, HandshakeTimeout: 300 * time.Millisecond}
	if st != nil {
		o.Stats = st
	}
	s := server.New(lobby.New(ctx, lobby.Options{MaxRooms: maxRooms}), o)
	srv := httptest.NewServer(s)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, s
}

var open = server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}

var (
	codeRE = regexp.MustCompile(`"code":"[A-HJ-NP-Z2-9]{4}"`)
	tokRE  = regexp.MustCompile(`"tok":"[A-Za-z0-9_-]{22}"`)
	leftRE = regexp.MustCompile(`"left":\d+`)
	tickRE = regexp.MustCompile(`"tick":\d+`)
)

// normalize replaces what depends on chance or timing: the room code, a
// fresh token, the seconds left and the welcome's tick.
func normalize(b []byte) []byte {
	b = codeRE.ReplaceAll(b, []byte(`"code":"CODE"`))
	b = tokRE.ReplaceAll(b, []byte(`"tok":"TOKEN"`))
	b = tickRE.ReplaceAll(b, []byte(`"tick":0`))
	return leftRE.ReplaceAll(b, []byte(`"left":0`))
}

// exchange dials, writes msgs and records the error and welcome frames
// (normalized) and the close status and reason; snapshots, rosters and
// rounds in between depend on timing and are skipped. It stops after a
// frame of type until, or at the close.
func exchange(t *testing.T, srv *httptest.Server, tr *transcript, name string, until string, msgs ...string) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	defer ws.CloseNow()
	ws.SetReadLimit(1 << 20)
	for _, m := range msgs {
		if err := ws.Write(ctx, websocket.MessageText, []byte(m)); err != nil {
			t.Fatal(err)
		}
	}
	for {
		_, b, err := ws.Read(ctx)
		if err != nil {
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				tr.addRaw(name, "close", []byte(fmt.Sprintf(`{"status":%d,"reason":%q}`, ce.Code, ce.Reason)))
			} else {
				tr.addRaw(name, "close", []byte(`{"status":"none"}`))
			}
			return
		}
		var h struct{ T string }
		_ = json.Unmarshal(b, &h)
		if h.T == "error" || h.T == "welcome" {
			tr.addRaw(name, h.T, normalize(b))
		}
		if h.T == until {
			return
		}
	}
}

// roomsSettled polls /api/rooms (1 s cache) until no human is listed, so
// the recorded body does not depend on when the setup socket's leave landed.
func roomsSettled(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(4 * time.Second)
	for {
		res, err := http.Get(url + "/api/rooms")
		if err != nil {
			t.Fatal(err)
		}
		b, _ := io.ReadAll(res.Body)
		res.Body.Close()
		if bytes.Contains(b, []byte(`"humans":0`)) {
			return
		}
		if time.Now().After(deadline) {
			t.Fatalf("rooms never settled: %s", b)
		}
		time.Sleep(250 * time.Millisecond)
	}
}

func TestGoldenServerFrames(t *testing.T) {
	tr := newTranscript()
	srv, s := newServer(t, 1, open, nil)
	hello := `{"t":"hello","v":2,"name":"golden"}`
	exchange(t, srv, tr, "version", "", `{"t":"hello","v":1,"name":"x"}`)
	exchange(t, srv, tr, "bad_first", "", `{"t":"join","code":"ABCD"}`)
	exchange(t, srv, tr, "no_room", "", hello, `{"t":"join","code":"ZZZZ"}`)
	exchange(t, srv, tr, "bad_room", "", hello, `{"t":"create","mode":"x","size":4,"diff":"easy"}`)
	exchange(t, srv, tr, "timeout", "", hello)
	exchange(t, srv, tr, "welcome", "welcome", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":1}`)
	exchange(t, srv, tr, "busy", "", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":2}`)
	exchange(t, srv, tr, "bad_msg_in_room", "", hello, `{"t":"quick"}`, `{"t":"nope"}`)
	s.Drain(true)
	exchange(t, srv, tr, "updating", "", hello, `{"t":"quick"}`)
	s.Drain(false)

	lim := open
	lim.CreatePerMinIP = 1
	srv2, _ := newServer(t, 0, lim, nil)
	create := `{"t":"create","mode":"team","size":2,"diff":"easy","seed":3}`
	exchange(t, srv2, tr, "create_ok", "welcome", hello, create)
	exchange(t, srv2, tr, "creates", "", hello, create)
	check(t, "server_frames", tr.bytes())
}

// get records status, the headers the server sets and the body.
func get(t *testing.T, tr *transcript, name, url string, hdr map[string]string) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodGet, url, nil)
	for k, v := range hdr {
		req.Header.Set(k, v)
	}
	res, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	body, _ := io.ReadAll(res.Body)
	var hs []string
	for _, k := range []string{"Content-Type", "Cache-Control", "Content-Security-Policy", "X-Content-Type-Options",
		"Referrer-Policy", "Permissions-Policy", "Cross-Origin-Opener-Policy"} {
		hs = append(hs, k+": "+res.Header.Get(k))
	}
	sort.Strings(hs)
	rec, _ := json.Marshal(fmt.Sprintf("%d\n%s\n%s", res.StatusCode, strings.Join(hs, "\n"), normalize(body)))
	tr.addRaw(name, "http", rec) // a JSON string: kept in full when short
}

func TestGoldenServerAPI(t *testing.T) {
	tr := newTranscript()
	srv, _ := newServer(t, 0, open, nil)
	exchange(t, srv, tr, "setup", "welcome", `{"t":"hello","v":2,"name":"g"}`, `{"t":"create","mode":"team","size":4,"diff":"easy","seed":1}`)
	roomsSettled(t, srv.URL)
	get(t, tr, "index", srv.URL+"/", nil)
	get(t, tr, "healthz", srv.URL+"/healthz", nil)
	get(t, tr, "rooms", srv.URL+"/api/rooms", nil)
	get(t, tr, "nope", srv.URL+"/api/nope", nil)
	get(t, tr, "board_off", srv.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "me_off", srv.URL+"/api/me", map[string]string{pilot.Header: "AAAAAAAAAAAAAAAAAAAAAA"})

	now := time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC)
	store, err := stats.Open(t.TempDir(), stats.Options{Now: func() time.Time { return now }})
	if err != nil {
		t.Fatal(err)
	}
	slot := stats.NewSlot()
	slot.Set(store)
	t.Cleanup(func() { slot.Close() })
	tok := "AAAAAAAAAAAAAAAAAAAAAA"
	slot.Record(stats.Delta{Pilot: pilot.Hash(tok), Name: "ace", Kills: 3, Deaths: 1, Wins: 1, Matches: 2, Flight: 7200,
		Kinds: map[string]int{"f16": 7200}})
	deadline := time.Now().Add(2 * time.Second)
	for {
		if top, _ := slot.Top(stats.All, 20); len(top) > 0 {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("delta never reached the store")
		}
		time.Sleep(5 * time.Millisecond)
	}
	srv2, _ := newServer(t, 0, open, slot)
	get(t, tr, "board_week", srv2.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "board_all", srv2.URL+"/api/leaderboard?period=all", nil)
	get(t, tr, "board_bad", srv2.URL+"/api/leaderboard?period=year", nil)
	get(t, tr, "me", srv2.URL+"/api/me", map[string]string{pilot.Header: tok})
	get(t, tr, "me_unknown", srv2.URL+"/api/me", map[string]string{pilot.Header: "BBBBBBBBBBBBBBBBBBBBBA"})
	get(t, tr, "me_bad", srv2.URL+"/api/me", map[string]string{pilot.Header: "short"})
	check(t, "server_api", tr.bytes())
}

func TestGoldenMetricsText(t *testing.T) {
	reg := metrics.New(func() uint64 { return 7 })
	reg.Rooms.Add(2)
	reg.Humans.Add(3)
	reg.Bots.Add(5)
	reg.Conns.Add(4)
	reg.TickSeconds.Observe(0.003)
	reg.TickSeconds.Observe(0.02)
	reg.TickOverruns.Inc()
	reg.MsgsIn.Add(10)
	reg.MsgsOut.Add(20)
	reg.SnapDrops.Inc()
	reg.Rejects.Inc("flood")
	reg.Rejects.Inc("weird")
	reg.API.Inc("rooms")
	var b bytes.Buffer
	if err := reg.WriteText(&b); err != nil {
		t.Fatal(err)
	}
	var keep []string
	for _, l := range strings.Split(b.String(), "\n") {
		if !strings.Contains(l, "go_goroutines") && !strings.Contains(l, "go_memstats") { // runtime values vary
			keep = append(keep, l)
		}
	}
	tr := newTranscript()
	tr.addRaw("metrics", "text", []byte(strings.Join(keep, "\n")))
	check(t, "metrics_text", tr.bytes())
}
