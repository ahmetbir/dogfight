package front

import (
	"encoding/json"
	"slices"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/protocol"
	"playground/internal/stats"
)

// Every Dogfight decode error (unknown team or loadout, bad chat id,
// non-finite number, oversize, unknown type, garbage) answers bad_msg, in the
// handshake and in a room, as before the switch-over.
func TestDecodeErrorsKeepTheirCode(t *testing.T) {
	srv := newServer(t, server.Options{Web: web})
	bad := []string{
		`{"t":"team","team":"martian"}`,
		`{"t":"pick","kind":"f16","lo":"nuke"}`,
		`{"t":"chat","id":9}`,
		`{"t":"in","seq":1,"p":1e999}`,
		`{"t":"ping","ts":"x"}`,
		`{"t":"nope"}`,
		`{{{`,
		`{"t":"chat","id":1,"name":"` + strings.Repeat("x", protocol.MaxClientMsg) + `"}`,
	}
	code := func(c *client) string {
		var e protocol.ErrorMsg
		json.Unmarshal(c.until("error", 5*time.Second, nil), &e)
		return e.Code
	}
	for _, raw := range bad {
		h := dial(t, srv)
		h.writeRaw(raw)
		if got := code(h); got != netproto.CodeBad {
			t.Errorf("handshake %.40s: code %q", raw, got)
		}
		r := dial(t, srv)
		r.send(hello("x"))
		r.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "team", Size: 2, Diff: "easy"})
		r.until("welcome", 5*time.Second, nil)
		if err := r.ws.Write(t.Context(), websocket.MessageText, []byte(raw)); err != nil {
			t.Fatal(err)
		}
		if got := code(r); got != netproto.CodeBad {
			t.Errorf("in room %.40s: code %q", raw, got)
		}
	}
}

// The ?period= names come from the stats package alone, and a name it does
// not know builds no board.
func TestPeriodsAreTheStatsPeriods(t *testing.T) {
	sl := stats.NewSlot()
	t.Cleanup(func() { sl.Close() })
	st, err := stats.Open(t.TempDir(), stats.Options{})
	if err != nil {
		t.Fatal(err)
	}
	sl.Set(st)
	api := NewStats(sl)
	var want []server.BoardID
	for _, p := range stats.Periods() {
		if q, ok := stats.ParsePeriod(p.Name()); !ok || q != p {
			t.Fatalf("period %d does not round-trip its name %q", p, p.Name())
		}
		want = append(want, server.BoardID{Period: p.Name()})
	}
	if !slices.Equal(api.Boards(), want) || !slices.Equal(want, []server.BoardID{{Period: "week"}, {Period: "all"}}) {
		t.Fatalf("boards %v, stats %v", api.Boards(), want)
	}
	if api.Board(server.BoardID{Period: "year"}) != nil || api.Board(server.BoardID{Period: "all", Key: "x"}) != nil {
		t.Fatal("an unknown board was built")
	}
	if b := api.Board(server.BoardID{Period: "all"}); !strings.HasPrefix(string(b), `{"period":"all","week":"`) || !strings.HasSuffix(string(b), `","top":[]}`) {
		t.Fatalf("board %s", b)
	}
}
