package golden

import (
	"encoding/json"
	"fmt"
	"testing"
	"time"

	"github.com/coder/websocket"
)

// welcomeOf decodes the code and seat of a raw welcome frame.
func welcomeOf(t *testing.T, b []byte) (code string, you int) {
	t.Helper()
	var w struct {
		Code string
		You  int
	}
	if err := json.Unmarshal(b, &w); err != nil {
		t.Fatalf("welcome: %v", err)
	}
	return w.Code, w.You
}

// sawFlare reads frames until a snapshot carries a flare event of plane
// you (true) or 90 frames (about 3 s) passed without one.
func (s *sock) sawFlare(you int) bool {
	s.t.Helper()
	for range 90 {
		_, b, err := s.ws.Read(s.ctx)
		if err != nil {
			s.t.Fatal(err)
		}
		var m struct {
			T  string
			Ev []struct {
				K string
				A int
			}
		}
		_ = json.Unmarshal(b, &m)
		for _, e := range m.Ev {
			if m.T == "snap" && e.K == "flare" && e.A == you {
				return true
			}
		}
	}
	return false
}

// liveDrain: a draining server whose room ends under its player closes the
// socket with 1012 and the update reason, after the snapshot in flight.
func liveDrain(t *testing.T, tr *transcript) {
	srv, s, stop := newServer(t, srvOpts{lim: open})
	live := exchange(t, srv, tr, "live_drain", "welcome", hello, fmt.Sprintf(ffa2, 4))
	s.Drain(true)
	stop()
	live.read("")
}

const ffa2 = `{"t":"create","mode":"ffa","size":2,"diff":"easy","seed":%d}`

// TestGoldenServerLimits: every per-address and per-connection refusal the
// server answers with a frame or an HTTP status, with the limiter clock
// frozen (or moved by hand) so no bucket refills behind the test's back:
// connection caps, join failures, a full room, the message flood kick, the
// input frame ceiling, the latch of a dropped input's flare, and the live
// 1012 a draining server sends when a room ends under its players.
func TestGoldenServerLimits(t *testing.T) {
	tr := newTranscript()
	clk := newClock()

	lim := open
	lim.MaxConnsIP = 1
	srv, _, _ := newServer(t, srvOpts{lim: lim, now: clk.now})
	held := exchange(t, srv, tr, "conns_ip_held", "welcome", hello, fmt.Sprintf(ffa2, 1))
	dial(t, srv, tr, "conns_ip")
	held.ws.CloseNow()

	lim = open
	lim.MaxConns = 1
	srv, _, _ = newServer(t, srvOpts{lim: lim, now: clk.now})
	held = exchange(t, srv, tr, "conns_total_held", "welcome", hello, fmt.Sprintf(ffa2, 1))
	dial(t, srv, tr, "conns_total")
	held.ws.CloseNow()

	lim = open
	lim.JoinFailPerMinIP = 1
	srv, _, _ = newServer(t, srvOpts{lim: lim, now: clk.now})
	exchange(t, srv, tr, "joins_1", "", hello, `{"t":"join","code":"ZZZZ"}`)
	exchange(t, srv, tr, "joins_2", "", hello, `{"t":"join","code":"ZZZZ"}`)

	srv, _, _ = newServer(t, srvOpts{lim: open, now: clk.now})
	a := dial(t, srv, tr, "full_a")
	a.send(hello, fmt.Sprintf(ffa2, 1))
	code, _ := welcomeOf(t, a.read("welcome"))
	join := fmt.Sprintf(`{"t":"join","code":%q}`, code)
	b := exchange(t, srv, tr, "full_b", "welcome", hello, join)
	exchange(t, srv, tr, "full_c", "", hello, join)
	a.ws.CloseNow()
	b.ws.CloseNow()

	lim = open
	lim.MsgRate, lim.MsgBurst = 1, 5
	srv, _, _ = newServer(t, srvOpts{lim: lim, now: clk.now})
	flood := exchange(t, srv, tr, "flood", "welcome", hello, fmt.Sprintf(ffa2, 1))
	flood.send(`{"t":"chat","id":1}`, `{"t":"chat","id":2}`, `{"t":"chat","id":3}`, `{"t":"chat","id":4}`)
	flood.read("")

	drop := dial(t, srv, tr, "drop") // the same, without a later input: the flare is lost
	drop.send(hello, fmt.Sprintf(ffa2, 5))
	_, you := welcomeOf(t, drop.read("welcome"))
	drop.send(`{"t":"pick","kind":"f16"}`)
	for seq := 1; seq <= 6; seq++ {
		drop.send(fmt.Sprintf(`{"t":"in","seq":%d,"th":1,"fl":%t}`, seq, seq == 6))
	}
	tr.addRaw("drop", "flare", fmt.Appendf(nil, `{"dropped_flare_reached_the_room":%t}`, drop.sawFlare(you)))
	drop.ws.CloseNow()

	latch := dial(t, srv, tr, "latch")
	latch.send(hello, fmt.Sprintf(ffa2, 2))
	_, you = welcomeOf(t, latch.read("welcome"))
	latch.send(`{"t":"pick","kind":"f16"}`)
	for seq := 1; seq <= 6; seq++ { // the 6th is over the input burst: dropped, its flare latched
		latch.send(fmt.Sprintf(`{"t":"in","seq":%d,"th":1,"fl":%t}`, seq, seq == 6))
	}
	latch.send(`{"t":"ping","ts":1}`)
	latch.read("pong")   // the server has judged the six inputs
	clk.add(time.Second) // one input token
	latch.send(`{"t":"in","seq":7,"th":1}`)
	tr.addRaw("latch", "flare", fmt.Appendf(nil, `{"dropped_flare_reached_the_room":%t}`, latch.sawFlare(you)))
	latch.ws.CloseNow()

	ceil := exchange(t, srv, tr, "ceiling", "welcome", hello, fmt.Sprintf(ffa2, 3))
	go func() { // inputs only drop at their rate; the frame ceiling ends the connection
		for seq := 1; ; seq++ {
			if ceil.ws.Write(ceil.ctx, websocket.MessageText, fmt.Appendf(nil, `{"t":"in","seq":%d}`, seq)) != nil {
				return
			}
		}
	}()
	ceil.read("")

	liveDrain(t, tr)
	check(t, "server_limits", tr.bytes())
}
