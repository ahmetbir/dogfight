package golden

import (
	"bytes"
	"io"
	"net/http"
	"strconv"
	"strings"
	"testing"
	"time"

	"playground/core/pilot"
	"playground/internal/metrics"
	"playground/internal/stats"
)

// headers are the response headers the server sets and the golden keeps.
var headers = []string{"Cache-Control", "Content-Security-Policy", "Content-Type", "Cross-Origin-Opener-Policy",
	"Permissions-Policy", "Referrer-Policy", "X-Content-Type-Options"}

// get records one response as lines: the status, each kept header, the body.
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
	tr.addRaw(name, "status", []byte(strconv.Itoa(res.StatusCode)))
	for _, k := range headers {
		tr.addRaw(name, "header", []byte(k+": "+res.Header.Get(k)))
	}
	tr.addRaw(name, "body", normalize(body))
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

func TestGoldenServerAPI(t *testing.T) {
	tr := newTranscript()
	srv, s, _ := newServer(t, srvOpts{lim: open})
	exchange(t, srv, tr, "setup", "welcome", `{"t":"hello","v":2,"name":"g"}`, `{"t":"create","mode":"team","size":4,"diff":"easy","seed":1}`).ws.CloseNow()
	roomsSettled(t, srv.URL)
	get(t, tr, "rooms", srv.URL+"/api/rooms", nil)
	get(t, tr, "nope", srv.URL+"/api/nope", nil)
	get(t, tr, "board_off", srv.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "me_off", srv.URL+"/api/me", map[string]string{pilot.Header: "AAAAAAAAAAAAAAAAAAAAAA"})
	s.Drain(true)
	get(t, tr, "rooms_draining", srv.URL+"/api/rooms", nil)
	s.Drain(false)

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
	srv2, _, _ := newServer(t, srvOpts{lim: open, stats: slot})
	get(t, tr, "board_week", srv2.URL+"/api/leaderboard?period=week", nil)
	get(t, tr, "board_all", srv2.URL+"/api/leaderboard?period=all", nil)
	get(t, tr, "board_bad", srv2.URL+"/api/leaderboard?period=year", nil)
	get(t, tr, "me", srv2.URL+"/api/me", map[string]string{pilot.Header: tok})
	get(t, tr, "me_unknown", srv2.URL+"/api/me", map[string]string{pilot.Header: "BBBBBBBBBBBBBBBBBBBBBA"})
	get(t, tr, "me_bad", srv2.URL+"/api/me", map[string]string{pilot.Header: "short"})

	lim := open
	lim.APIPerMinIP, lim.APIBurst = 1, 1
	srv3, _, _ := newServer(t, srvOpts{lim: lim, now: newClock().now})
	get(t, tr, "rate_1", srv3.URL+"/api/rooms", nil)
	get(t, tr, "rate_2", srv3.URL+"/api/rooms", nil)
	check(t, "server_api", tr.bytes())
}

// TestGoldenServerRoutes: the pages and static files with their cache
// policy: the index (bundle fingerprinted), /r/{code}, /healthz, a
// fingerprinted and a bare bundle URL, a model, the model manifest, a
// directory and a missing file.
func TestGoldenServerRoutes(t *testing.T) {
	tr := newTranscript()
	srv, _, _ := newServer(t, srvOpts{lim: open})
	for _, r := range []struct{ name, path string }{
		{"index", "/"}, {"room_link", "/r/ABCD"}, {"healthz", "/healthz"},
		{"bundle_versioned", "/app.js?v=1"}, {"bundle_bare", "/app.js"},
		{"model", "/models/f16.glb"}, {"model_manifest", "/models/manifest.json"},
		{"dir", "/models/"}, {"missing", "/nope.js"},
	} {
		get(t, tr, r.name, srv.URL+r.path, nil)
	}
	check(t, "server_routes", tr.bytes())
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
	tr := newTranscript()
	for _, l := range strings.Split(b.String(), "\n") {
		if !strings.Contains(l, "go_goroutines") && !strings.Contains(l, "go_memstats") { // runtime values vary
			tr.addRaw("metrics", "row", []byte(l))
		}
	}
	check(t, "metrics_text", tr.bytes())
}
