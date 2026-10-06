package match

import (
	"context"
	"errors"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/netproto"
	"playground/core/room"
	"playground/internal/game"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// fakeSender records what one seat received (moved from core/room's tests).
type fakeSender struct {
	mu     sync.Mutex
	msgs   []any
	closed bool
}

func (f *fakeSender) Send(v any) bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.msgs = append(f.msgs, v)
	return true
}
func (f *fakeSender) Close() { f.mu.Lock(); defer f.mu.Unlock(); f.closed = true }

func typeOf(v any) string {
	switch v.(type) {
	case protocol.Welcome:
		return "welcome"
	case protocol.Snap:
		return "snap"
	case protocol.PlayersMsg:
		return "players"
	case protocol.RoundMsg:
		return "round"
	case netproto.Pong:
		return "pong"
	case netproto.ChatMsg:
		return "chat"
	}
	return "?"
}

func (f *fakeSender) count(t string) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.msgs {
		if typeOf(m) == t {
			n++
		}
	}
	return n
}

func (f *fakeSender) lastSnap() (protocol.Snap, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.msgs) - 1; i >= 0; i-- {
		if s, ok := f.msgs[i].(protocol.Snap); ok {
			return s, true
		}
	}
	return protocol.Snap{}, false
}

func (f *fakeSender) notices() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, m := range f.msgs {
		if n, ok := m.(netproto.NoticeMsg); ok {
			out = append(out, n.Msg)
		}
	}
	return out
}

// events counts the events of kind k by plane a in every snapshot received.
func (f *fakeSender) events(k string, a sim.ID) int {
	f.mu.Lock()
	defer f.mu.Unlock()
	n := 0
	for _, m := range f.msgs {
		if s, ok := m.(protocol.Snap); ok {
			for _, e := range s.Events {
				if e.K == k && e.A == a {
					n++
				}
			}
		}
	}
	return n
}

// startMatch runs a Dogfight room; tests reach the match's state (m.humans)
// after synctest.Wait, as they reached the room's before.
func startMatch(t *testing.T, s game.Settings, sink StatsSink) (*Room, *Match, context.CancelFunc) {
	m := New(s, sink)
	r := room.New("ABCD", m, room.Options{})
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	return r, m, cancel
}

// The Dogfight half of core/room's TestJoinReceivesWelcomeAndSnaps: the
// welcome is followed by the roster and the round.
func TestJoinReceivesWelcomeSnapsPlayersAndRound(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), room.Who{Name: "a"}, out)
		if err != nil || seat.ID() == 0 {
			t.Fatal(err)
		}
		time.Sleep(time.Second)
		synctest.Wait()
		if out.count("welcome") != 1 || out.count("snap") < 25 || out.count("players") < 1 || out.count("round") < 1 {
			t.Fatalf("welcome=%d snaps=%d players=%d round=%d",
				out.count("welcome"), out.count("snap"), out.count("players"), out.count("round"))
		}
	})
}

// The Dogfight half of core/room's TestPingAndUnknownGameMessage: a pick of
// an unknown kind is ignored and the room lives on.
func TestPingAndBadPick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		out := &fakeSender{}
		seat, _ := r.Join(t.Context(), room.Who{Name: "a"}, out)
		seat.Input(protocol.ClientMsg{T: protocol.TPing, TS: 5})
		seat.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "zeppelin"})
		seat.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "su27"})
		time.Sleep(time.Second)
		synctest.Wait()
		if out.count("pong") != 1 {
			t.Fatalf("pong=%d", out.count("pong"))
		}
		select {
		case <-r.Done():
			t.Fatal("room died")
		default:
		}
	})
}

// The Dogfight half of core/room's TestFullRoom: through the room, a full
// Dogfight room still answers game.ErrFull (the server's check).
func TestFullRoom(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		for i := range 4 {
			if _, err := r.Join(t.Context(), room.Who{Name: "p"}, &fakeSender{}); err != nil {
				t.Fatalf("join %d: %v", i, err)
			}
		}
		if _, err := r.Join(t.Context(), room.Who{Name: "p"}, &fakeSender{}); !errors.Is(err, game.ErrFull) || !errors.Is(err, room.ErrFull) {
			t.Fatalf("5th join: %v", err)
		}
	})
}

// Before its first input a human's plane flies on its own throttle (spawn
// 0.8), not on a zero input repeated by the session.
func TestNoInputKeepsSpawnThrottle(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), room.Who{Name: "a"}, out)
		if err != nil {
			t.Fatal(err)
		}
		seat.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f16"}) // the first pick spawns
		time.Sleep(500 * time.Millisecond)
		synctest.Wait()
		s, ok := out.lastSnap()
		if !ok {
			t.Fatal("no snap")
		}
		found := false
		for _, p := range s.Planes {
			if p.ID != sim.ID(seat.ID()) {
				continue
			}
			found = true
			if p.Th != 0.8 {
				t.Fatalf("throttle before first input = %v, want 0.8", p.Th)
			}
		}
		if !found {
			t.Fatal("joined plane missing from the snapshot")
		}
	})
}

// Review Focus 4: a press latched by the connection (ClientMsg.Latch) rides
// an admitted input into the room, where a backlog trim (Input.Latch) keeps
// it. The check counts the seat's "flare" events over two seconds, longer
// than the flare cooldown (one second), so a second drop would show.
func TestDroppedPressSurvivesBothLatches(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, ffa4, nil)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), room.Who{Name: "a"}, out)
		if err != nil {
			t.Fatal(err)
		}
		id := sim.ID(seat.ID())
		seat.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f16"}) // the first pick spawns
		time.Sleep(5 * time.Second)                                    // spawned and flying
		synctest.Wait()
		alive := false
		if s, ok := out.lastSnap(); ok {
			for _, p := range s.Planes {
				alive = alive || (p.ID == id && p.Alive)
			}
		}
		if !alive || out.events("flare", id) != 0 {
			t.Fatalf("setup: alive %v flares %d", alive, out.events("flare", id))
		}
		dropped := protocol.ClientMsg{T: protocol.TIn, Seq: 2, Th: 1, FL: true}
		seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: 1, Th: 1})
		seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: 3, Th: 1}.Latch(dropped))
		for seq := uint32(4); seq <= 9; seq++ { // 8 queued: the next tick drops the 4 oldest
			seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1})
		}
		synctest.Wait()
		time.Sleep(2 * time.Second)
		synctest.Wait()
		if n := out.events("flare", id); n != 1 {
			t.Fatalf("flare events %d: the latched press must fire exactly once", n)
		}
	})
}
