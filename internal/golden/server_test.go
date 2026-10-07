package golden

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http/httptest"
	"regexp"
	"strings"
	"sync/atomic"
	"testing"
	"testing/fstest"
	"time"

	"github.com/coder/websocket"

	"github.com/ahmetbir/roomkit/server"
	"playground/internal/front"
	"playground/internal/match"
	"playground/internal/stats"
)

// web is the built client stand-in: an index that references the bundle
// (fingerprinted), a bundle file and models (the static cache branches).
var web = fstest.MapFS{
	"index.html":           {Data: []byte(`<!doctype html><script src="/app.js"></script>dogfight`)},
	"app.js":               {Data: []byte("console.log(1)")},
	"models/f16.glb":       {Data: []byte("glb")},
	"models/manifest.json": {Data: []byte(`{"f16":"f16.glb"}`)},
}

// srvOpts are the knobs the scenarios turn; zero values are the defaults.
type srvOpts struct {
	maxRooms int
	lim      server.Limits
	stats    *stats.Slot
	now      func() time.Time // limiter clock; nil = time.Now
}

// newServer builds the HTTP handler the way cmd/dogfight does and returns
// it with a stop that ends the lobby (every room closes). The only code
// here later tasks may change (constructors move).
func newServer(t *testing.T, so srvOpts) (*httptest.Server, *front.Server, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	o := server.Options{Web: web, Limits: so.lim, HandshakeTimeout: 300 * time.Millisecond, Now: so.now}
	if so.stats != nil {
		o.Stats = front.NewStats(so.stats)
	}
	s := front.NewServer(match.NewLobby(ctx, so.maxRooms, nil, nil), o)
	srv := httptest.NewServer(s)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, s, cancel
}

var open = server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}

// clock is a limiter clock the test moves by hand: rate buckets refill
// only when it says so.
type clock struct{ ns atomic.Int64 }

func newClock() *clock {
	c := &clock{}
	c.ns.Store(time.Date(2026, 10, 7, 21, 0, 0, 0, time.UTC).UnixNano())
	return c
}

func (c *clock) now() time.Time      { return time.Unix(0, c.ns.Load()).UTC() }
func (c *clock) add(d time.Duration) { c.ns.Add(int64(d)) }

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

// sock is one client game socket recording into session name.
type sock struct {
	t    *testing.T
	tr   *transcript
	name string
	ws   *websocket.Conn
	ctx  context.Context
}

// dial opens a game socket; a refused upgrade is recorded (status and
// body) and gives nil.
func dial(t *testing.T, srv *httptest.Server, tr *transcript, name string) *sock {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 10*time.Second)
	t.Cleanup(cancel)
	ws, res, err := websocket.Dial(ctx, "ws"+strings.TrimPrefix(srv.URL, "http")+"/ws", nil)
	if err != nil {
		if res == nil {
			t.Fatal(err)
		}
		body, _ := io.ReadAll(res.Body)
		tr.addRaw(name, "refused", fmt.Appendf(nil, "%d %s", res.StatusCode, strings.TrimSpace(string(body))))
		return nil
	}
	ws.SetReadLimit(1 << 20)
	t.Cleanup(func() { ws.CloseNow() })
	return &sock{t: t, tr: tr, name: name, ws: ws, ctx: ctx}
}

func (s *sock) send(msgs ...string) {
	s.t.Helper()
	for _, m := range msgs {
		if err := s.ws.Write(s.ctx, websocket.MessageText, []byte(m)); err != nil {
			s.t.Fatal(err)
		}
	}
}

// read records the error and welcome frames (normalized) and the close
// status and reason; snapshots, rosters and rounds depend on timing and are
// skipped. It returns the raw frame of type until, or nil at the close.
func (s *sock) read(until string) []byte {
	s.t.Helper()
	for {
		_, b, err := s.ws.Read(s.ctx)
		if err != nil {
			var ce websocket.CloseError
			if errors.As(err, &ce) {
				s.tr.addRaw(s.name, "close", fmt.Appendf(nil, `{"status":%d,"reason":%q}`, ce.Code, ce.Reason))
			} else {
				s.tr.addRaw(s.name, "close", []byte(`{"status":"none"}`))
			}
			return nil
		}
		var h struct{ T string }
		_ = json.Unmarshal(b, &h)
		if h.T == "error" || h.T == "welcome" {
			s.tr.addRaw(s.name, h.T, normalize(b))
		}
		if h.T == until {
			return b
		}
	}
}

// exchange dials, writes msgs and reads up to a frame of type until (""
// = the close).
func exchange(t *testing.T, srv *httptest.Server, tr *transcript, name string, until string, msgs ...string) *sock {
	t.Helper()
	s := dial(t, srv, tr, name)
	if s == nil {
		return nil
	}
	s.send(msgs...)
	s.read(until)
	return s
}

const hello = `{"t":"hello","v":3,"name":"golden"}`

func TestGoldenServerFrames(t *testing.T) {
	tr := newTranscript()
	srv, s, _ := newServer(t, srvOpts{maxRooms: 1, lim: open})
	exchange(t, srv, tr, "version", "", `{"t":"hello","v":1,"name":"x"}`)
	exchange(t, srv, tr, "bad_first", "", `{"t":"join","code":"ABCD"}`)
	exchange(t, srv, tr, "no_room", "", hello, `{"t":"join","code":"ZZZZ"}`)
	exchange(t, srv, tr, "bad_room", "", hello, `{"t":"create","mode":"x","size":4,"diff":"easy"}`)
	exchange(t, srv, tr, "timeout", "", hello)
	exchange(t, srv, tr, "welcome", "welcome", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":1}`).ws.CloseNow()
	exchange(t, srv, tr, "busy", "", hello, `{"t":"create","mode":"ffa","size":4,"diff":"easy","seed":2}`)
	exchange(t, srv, tr, "bad_msg_in_room", "", hello, `{"t":"quick"}`, `{"t":"nope"}`)
	// A binary or an oversized frame before the handshake ends (in a room:
	// TestServerInRoomBinaryCloses1003).
	bin := dial(t, srv, tr, "binary_first")
	bin.send(hello)
	if err := bin.ws.Write(bin.ctx, websocket.MessageBinary, []byte{1}); err != nil {
		t.Fatal(err)
	}
	bin.read("")
	exchange(t, srv, tr, "too_big_first", "", hello, `{"t":"join","code":"`+strings.Repeat("x", 3000)+`"}`)
	s.Drain(true)
	exchange(t, srv, tr, "updating", "", hello, `{"t":"quick"}`)
	s.Drain(false)
	exchange(t, srv, tr, "undrained", "welcome", hello, `{"t":"quick"}`).ws.CloseNow()

	lim := open
	lim.CreatePerMinIP = 1
	srv2, _, _ := newServer(t, srvOpts{lim: lim})
	create := `{"t":"create","mode":"team","size":2,"diff":"easy","seed":3}`
	exchange(t, srv2, tr, "create_ok", "welcome", hello, create).ws.CloseNow()
	exchange(t, srv2, tr, "creates", "", hello, create)
	check(t, "server_frames", tr.bytes())
}

// TestServerInRoomBinaryCloses1003: a binary frame from a player whose room
// is streaming snapshots closes with the code and reason binary_first froze
// in server_frames: the close waits for the snapshot in flight.
func TestServerInRoomBinaryCloses1003(t *testing.T) {
	srv, _, _ := newServer(t, srvOpts{lim: open})
	for seed := range 5 {
		tr := newTranscript()
		s := exchange(t, srv, tr, "in_room", "welcome", hello, fmt.Sprintf(ffa2, seed+1))
		s.read("snap")
		if err := s.ws.Write(s.ctx, websocket.MessageBinary, []byte{1}); err != nil {
			t.Fatal(err)
		}
		s.read("")
		lines := tr.sessions["in_room"]
		if got := string(lines[len(lines)-1].M); got != `{"status":1003,"reason":""}` {
			t.Fatalf("seed %d: in-room close %s", seed+1, got)
		}
	}
}
