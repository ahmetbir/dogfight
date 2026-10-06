package server

import (
	"context"
	"encoding/json"
	"io"
	"net/http"
	"net/http/httptest"
	"strings"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"playground/core/pilot"
	"playground/internal/match"
	"playground/internal/protocol"
)

func newServer(t *testing.T, o Options) *httptest.Server {
	t.Helper()
	return newServerRooms(t, o, 0)
}

func newServerRooms(t *testing.T, o Options, maxRooms int) *httptest.Server {
	t.Helper()
	if o.Limits == (Limits{}) { // tests share 127.0.0.1: lift the per-address caps
		o.Limits = Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}
	}
	ctx, cancel := context.WithCancel(context.Background())
	srv := httptest.NewServer(New(match.NewLobby(ctx, maxRooms, nil, nil), o))
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv
}

var web = fstest.MapFS{
	"index.html": {Data: []byte("<!doctype html>dogfight")},
	"app.js":     {Data: []byte("console.log(1)")},
}

func get(t *testing.T, url string) (int, string) {
	t.Helper()
	res, err := http.Get(url)
	if err != nil {
		t.Fatal(err)
	}
	defer res.Body.Close()
	b, _ := io.ReadAll(res.Body)
	return res.StatusCode, string(b)
}

func TestRoutes(t *testing.T) {
	srv := newServer(t, Options{Web: web})
	for path, want := range map[string]string{"/": "dogfight", "/r/ABCD": "dogfight", "/app.js": "console.log"} {
		if code, body := get(t, srv.URL+path); code != 200 || !strings.Contains(body, want) {
			t.Errorf("GET %s = %d %q", path, code, body)
		}
	}
	if code, _ := get(t, srv.URL+"/missing.js"); code != 404 {
		t.Errorf("GET /missing.js = %d", code)
	}
	empty := newServer(t, Options{Web: fstest.MapFS{}})
	if code, body := get(t, empty.URL+"/r/ABCD"); code != 503 || !strings.Contains(body, "client derlenmemiş") {
		t.Errorf("no client: %d %q", code, body)
	}
}

type client struct {
	t  *testing.T
	ws *websocket.Conn
}

func dial(t *testing.T, srv *httptest.Server) *client {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	ws, _, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		t.Fatal(err)
	}
	ws.SetReadLimit(1 << 20) // welcome carries the ~45 KB heightmap
	t.Cleanup(func() { ws.CloseNow() })
	return &client{t, ws}
}

func (c *client) send(v any) {
	c.t.Helper()
	b, _ := json.Marshal(v)
	if err := c.ws.Write(c.t.Context(), websocket.MessageText, b); err != nil {
		c.t.Fatal(err)
	}
}

// until reads messages until one of type typ satisfies ok, or fails after d.
func (c *client) until(typ string, d time.Duration, ok func([]byte) bool) []byte {
	c.t.Helper()
	ctx, cancel := context.WithTimeout(c.t.Context(), d)
	defer cancel()
	for {
		_, b, err := c.ws.Read(ctx)
		if err != nil {
			c.t.Fatalf("waiting for %s: %v", typ, err)
		}
		var h struct{ T string }
		json.Unmarshal(b, &h)
		if h.T == typ && (ok == nil || ok(b)) {
			return b
		}
	}
}

// closed reports whether the server ends the connection within d.
func (c *client) closed(d time.Duration) bool {
	ctx, cancel := context.WithTimeout(c.t.Context(), d)
	defer cancel()
	for {
		if _, _, err := c.ws.Read(ctx); err != nil {
			return ctx.Err() == nil
		}
	}
}

func hello(name string) protocol.ClientMsg {
	return protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: name}
}

func TestCreateJoinPlay(t *testing.T) {
	srv := newServer(t, Options{Web: web})
	a := dial(t, srv)
	a.send(hello("Ace"))
	a.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 4, Diff: "easy"})
	var w protocol.Welcome
	json.Unmarshal(a.until("welcome", 5*time.Second, nil), &w)
	if w.You == 0 || len(w.Code) != 4 || w.Mode != "ffa" {
		t.Fatalf("welcome: %+v", w.Code)
	}
	for seq := uint32(1); seq <= 10; seq++ {
		a.send(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1, P: 0.2})
	}
	a.until("snap", time.Second, func(b []byte) bool {
		var s protocol.Snap
		json.Unmarshal(b, &s)
		return s.Ack == 10
	})
	a.send(protocol.ClientMsg{T: protocol.TPing, TS: 42})
	a.until("pong", time.Second, nil)

	b := dial(t, srv)
	b.send(hello("Bravo"))
	b.send(protocol.ClientMsg{T: protocol.TJoin, Code: strings.ToLower(w.Code)})
	var w2 protocol.Welcome
	json.Unmarshal(b.until("welcome", 5*time.Second, nil), &w2)
	if w2.You == 0 || w2.You == w.You || w2.Code != w.Code {
		t.Fatalf("second welcome: you=%d code=%s", w2.You, w2.Code)
	}
	b.until("players", time.Second, func(m []byte) bool {
		var p protocol.PlayersMsg
		json.Unmarshal(m, &p)
		humans := 0
		for _, pl := range p.List {
			if !pl.Bot {
				humans++
			}
		}
		return humans == 2
	})
}

func expectError(t *testing.T, c *client, want string) {
	t.Helper()
	var e protocol.ErrorMsg
	json.Unmarshal(c.until("error", 5*time.Second, nil), &e)
	if e.Msg != want {
		t.Fatalf("error %q, want %q", e.Msg, want)
	}
	if !c.closed(2 * time.Second) {
		t.Fatal("connection left open after error")
	}
}

func TestHandshakeErrors(t *testing.T) {
	srv := newServer(t, Options{Web: web})
	for name, tc := range map[string]struct {
		msgs []protocol.ClientMsg
		want string
	}{
		"version":   {[]protocol.ClientMsg{{T: protocol.THello, V: 99}}, "sürüm uyuşmuyor, sayfayı yenile"},
		"v1 client": {[]protocol.ClientMsg{{T: protocol.THello, V: 1, Name: "old"}}, "sürüm uyuşmuyor, sayfayı yenile"},
		"bad map":   {[]protocol.ClientMsg{hello("x"), {T: protocol.TCreate, Mode: "ffa", Diff: "easy", Map: "mars"}}, "geçersiz oda ayarı"},
		"no room":   {[]protocol.ClientMsg{hello("x"), {T: protocol.TJoin, Code: "ZZZZ"}}, "oda bulunamadı"},
		"bad code":  {[]protocol.ClientMsg{hello("x"), {T: protocol.TJoin, Code: "../.."}}, "oda bulunamadı"},
		"bad mode":  {[]protocol.ClientMsg{hello("x"), {T: protocol.TCreate, Mode: "duel", Diff: "easy"}}, "geçersiz oda ayarı"},
		"bad diff":  {[]protocol.ClientMsg{hello("x"), {T: protocol.TCreate, Mode: "ffa", Diff: "insane"}}, "geçersiz oda ayarı"},
		"no hello":  {[]protocol.ClientMsg{{T: protocol.TIn, Seq: 1}}, msgBad},
		"bad order": {[]protocol.ClientMsg{hello("x"), {T: protocol.TIn, Seq: 1}}, msgBad},
	} {
		t.Run(name, func(t *testing.T) {
			c := dial(t, srv)
			for _, m := range tc.msgs {
				c.send(m)
			}
			expectError(t, c, tc.want)
		})
	}
}

func TestInGameProtocolErrors(t *testing.T) {
	srv := newServer(t, Options{Web: web})
	for name, raw := range map[string]string{
		"unknown type": `{"t":"nope"}`,
		"garbage":      `{{{`,
		"bad kind":     `{"t":"pick","kind":"zeppelin"}`,
		"rehello":      `{"t":"hello","v":1}`,
		"bad chat":     `{"t":"chat","id":9}`,
	} {
		t.Run(name, func(t *testing.T) {
			c := dial(t, srv)
			c.send(hello("x"))
			c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
			c.until("welcome", 5*time.Second, nil)
			if err := c.ws.Write(t.Context(), websocket.MessageText, []byte(raw)); err != nil {
				t.Fatal(err)
			}
			expectError(t, c, msgBad)
		})
	}
}

func TestHandshakeDeadline(t *testing.T) {
	srv := newServer(t, Options{Web: web, HandshakeTimeout: 200 * time.Millisecond})
	c := dial(t, srv)
	c.send(hello("slow")) // hello alone must not extend the deadline
	if !c.closed(2 * time.Second) {
		t.Fatal("handshake without create/join not closed")
	}
}

func TestCrossOriginRejected(t *testing.T) {
	srv := newServer(t, Options{Web: web})
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	h := http.Header{"Origin": {"https://evil.example"}}
	_, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", &websocket.DialOptions{HTTPHeader: h})
	if err == nil || res == nil || res.StatusCode != http.StatusForbidden {
		t.Fatalf("cross-origin dial: %v", err)
	}
}

func TestTokenIssuedOnce(t *testing.T) {
	srv := newServer(t, Options{})
	c := dial(t, srv)
	c.send(hello("a"))
	c.send(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 2, Diff: "easy"})
	var w struct {
		Tok string `json:"tok"`
	}
	json.Unmarshal(c.until("welcome", 2*time.Second, nil), &w)
	if !pilot.Valid(w.Tok) {
		t.Fatalf("no token issued: %q", w.Tok)
	}
	d := dial(t, srv)
	d.send(protocol.ClientMsg{T: "hello", V: protocol.Version, Name: "b", Tok: w.Tok})
	d.send(protocol.ClientMsg{T: "create", Mode: "ffa", Size: 2, Diff: "easy"})
	var w2 struct {
		Tok string `json:"tok"`
	}
	json.Unmarshal(d.until("welcome", 2*time.Second, nil), &w2)
	if w2.Tok != "" {
		t.Fatal("a valid token must not be reissued")
	}
}
