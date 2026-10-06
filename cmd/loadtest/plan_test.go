package main

import (
	"encoding/json"
	"testing"
	"time"

	"playground/internal/protocol"
)

func TestAssignRoundRobinWithOneCreatorPerRoom(t *testing.T) {
	got := assign(7, 3)
	want := []slot{{0, true}, {1, true}, {2, true}, {0, false}, {1, false}, {2, false}, {0, false}}
	if len(got) != len(want) {
		t.Fatalf("len = %d, want %d", len(got), len(want))
	}
	for i := range want {
		if got[i] != want[i] {
			t.Errorf("slot %d = %+v, want %+v", i, got[i], want[i])
		}
	}
	if n := humansPerRoom(7, 3); n != 3 {
		t.Errorf("humansPerRoom(7,3) = %d, want 3", n)
	}
}

func TestAssignQuickPlay(t *testing.T) {
	for i, s := range assign(4, 0) {
		if s.room != -1 || s.creator {
			t.Errorf("slot %d = %+v, want quick play", i, s)
		}
	}
	if n := humansPerRoom(4, 0); n != 0 {
		t.Errorf("humansPerRoom(4,0) = %d, want 0", n)
	}
}

func TestStartAtSpreadsOverRamp(t *testing.T) {
	ramp := 10 * time.Second
	if d := startAt(0, 4, ramp); d != 0 {
		t.Errorf("first = %v, want 0", d)
	}
	if d := startAt(2, 4, ramp); d != 5*time.Second {
		t.Errorf("middle = %v, want 5s", d)
	}
	if d := startAt(3, 4, 0); d != 0 {
		t.Errorf("no ramp = %v, want 0", d)
	}
	for i := range 4 {
		if d := startAt(i, 4, ramp); d >= ramp {
			t.Errorf("player %d starts at %v, not before the ramp ends", i, d)
		}
	}
}

func TestWsURL(t *testing.T) {
	ok := map[string]string{
		"ws://127.0.0.1:8080":    "ws://127.0.0.1:8080/ws",
		"ws://dogfight-lt:8080/": "ws://dogfight-lt:8080/ws",
		"wss://example.test/ws":  "wss://example.test/ws",
		"ws://h:1/other?x=1":     "ws://h:1/other?x=1",
	}
	for in, want := range ok {
		got, err := wsURL(in)
		if err != nil || got != want {
			t.Errorf("wsURL(%q) = %q, %v; want %q", in, got, err, want)
		}
	}
	for _, bad := range []string{"http://h:8080", "ws://", "h:8080", "::"} {
		if _, err := wsURL(bad); err == nil {
			t.Errorf("wsURL(%q) accepted", bad)
		}
	}
}

func TestStickStaysInRangeAndValid(t *testing.T) {
	for i := range 5 {
		for seq := uint32(1); seq <= 3600; seq++ {
			m := stick(i, seq)
			if m.T != protocol.TIn || m.Seq != seq {
				t.Fatalf("player %d seq %d: T=%q Seq=%d", i, seq, m.T, m.Seq)
			}
			for _, v := range []float64{m.P, m.R, m.Y} {
				if v < -1 || v > 1 {
					t.Fatalf("player %d seq %d: axis %v out of [-1,1]", i, seq, v)
				}
			}
			if m.Th < 0 || m.Th > 1 {
				t.Fatalf("player %d seq %d: throttle %v out of [0,1]", i, seq, m.Th)
			}
		}
	}
}

// One minute of input: bursts, missiles and flares at their cycle rates,
// and the sticks actually move.
func TestStickPacing(t *testing.T) {
	var fire, missiles, flares, ab int
	minP, maxP := 1.0, -1.0
	for seq := uint32(1); seq <= 3600; seq++ {
		m := stick(3, seq)
		if m.F {
			fire++
		}
		if m.M {
			missiles++
		}
		if m.FL {
			flares++
		}
		if m.AB {
			ab++
		}
		minP, maxP = min(minP, m.P), max(maxP, m.P)
	}
	if fire != 12*fireHeld {
		t.Errorf("fire ticks = %d, want %d", fire, 12*fireHeld)
	}
	if missiles < 7 || missiles > 8 {
		t.Errorf("missiles = %d, want 7..8", missiles)
	}
	if flares < 5 || flares > 6 {
		t.Errorf("flares = %d, want 5..6", flares)
	}
	if ab != 4*abHeld {
		t.Errorf("afterburner ticks = %d, want %d", ab, 4*abHeld)
	}
	if maxP-minP < 0.5 {
		t.Errorf("pitch range %.2f..%.2f barely moves", minP, maxP)
	}
}

func TestStickDecodesOnTheServer(t *testing.T) {
	for seq := uint32(1); seq <= 900; seq++ {
		b, err := json.Marshal(stick(1, seq))
		if err != nil {
			t.Fatal(err)
		}
		if len(b) > protocol.MaxClientMsg {
			t.Fatalf("seq %d: %d bytes, over the server's %d", seq, len(b), protocol.MaxClientMsg)
		}
		got, err := protocol.DecodeClient(b)
		if err != nil || got.Seq != seq {
			t.Fatalf("DecodeClient = %+v, %v", got, err)
		}
	}
	b, _ := json.Marshal(protocol.ClientMsg{T: protocol.TPick, Kind: pickKind("soviet", 0)})
	if got, err := protocol.DecodeClient(b); err != nil || got.Kind != "mig29" {
		t.Fatalf("DecodeClient = %+v, %v", got, err)
	}
}

func TestPickKindMatchesTeam(t *testing.T) {
	cases := []struct {
		team string
		i    int
		want string
	}{{"nato", 0, "f16"}, {"nato", 1, "f15"}, {"soviet", 2, "mig29"}, {"soviet", 3, "su27"}, {"none", 0, "f16"}}
	for _, c := range cases {
		if got := pickKind(c.team, c.i); got != c.want {
			t.Errorf("pickKind(%q,%d) = %q, want %q", c.team, c.i, got, c.want)
		}
	}
}

func TestSnapTickMatchesServerEncoding(t *testing.T) {
	b, err := json.Marshal(protocol.Snap{T: "snap", Tick: 7302, WT: 9, Ack: 3})
	if err != nil {
		t.Fatal(err)
	}
	if tick, ok := snapTick(b); !ok || tick != 7302 {
		t.Fatalf("snapTick(%s) = %d, %v; want 7302", b, tick, ok)
	}
	for _, s := range []string{`{"t":"round","tick":5}`, `{"t":"snap","tick":}`, `{"t":"snap"`, `{"t":"snap","tick":12345678901234567890}`} {
		if _, ok := snapTick([]byte(s)); ok {
			t.Errorf("snapTick(%s) accepted", s)
		}
	}
}
