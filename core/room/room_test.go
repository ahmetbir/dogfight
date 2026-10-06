package room

import (
	"context"
	"errors"
	"sync"
	"testing"
	"testing/synctest"
	"time"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
)

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

func (f *fakeSender) Close() {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.closed = true
}

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
	case protocol.Pong:
		return "pong"
	case protocol.ChatMsg:
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

func (f *fakeSender) isClosed() bool {
	f.mu.Lock()
	defer f.mu.Unlock()
	return f.closed
}

var ffa4 = game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1}

func start(t *testing.T) (*Room, context.CancelFunc) {
	r := New("ABCD", ffa4, Options{})
	ctx, cancel := context.WithCancel(t.Context())
	go r.Run(ctx)
	return r, cancel
}

func TestJoinReceivesWelcomeAndSnaps(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), Who{Name: "a"}, out)
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

func TestAckAdvances(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), Who{Name: "a"}, out)
		if err != nil {
			t.Fatal(err)
		}
		for seq := uint32(1); seq <= 10; seq++ {
			seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: seq, Th: 1})
		}
		seat.Input(protocol.ClientMsg{T: protocol.TIn, Seq: 3, Th: 1}) // stale: ignored
		time.Sleep(time.Second)
		synctest.Wait()
		if s, ok := out.lastSnap(); !ok || s.Ack != 10 {
			t.Fatalf("ack=%d", s.Ack)
		}
	})
}

func TestPingAndBadPick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		out := &fakeSender{}
		seat, _ := r.Join(t.Context(), Who{Name: "a"}, out)
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

func TestEmptyRoomCloses(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		seat, err := r.Join(t.Context(), Who{Name: "a"}, &fakeSender{})
		if err != nil {
			t.Fatal(err)
		}
		seat.Leave()
		time.Sleep(EmptyTimeout - time.Second)
		synctest.Wait()
		select {
		case <-r.Done():
			t.Fatal("closed too early")
		default:
		}
		time.Sleep(2 * time.Second)
		synctest.Wait()
		select {
		case <-r.Done():
		default:
			t.Fatal("empty room still running")
		}
		if _, err := r.Join(t.Context(), Who{Name: "b"}, &fakeSender{}); !errors.Is(err, ErrClosed) {
			t.Fatalf("join closed room: %v", err)
		}
		seat.Leave()                            // must not block
		seat.Input(protocol.ClientMsg{T: "in"}) // must not block
	})
}

func TestCancelClosesSessions(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		out := &fakeSender{}
		if _, err := r.Join(t.Context(), Who{Name: "a"}, out); err != nil {
			t.Fatal(err)
		}
		cancel()
		synctest.Wait()
		<-r.Done()
		if !out.isClosed() {
			t.Fatal("session not closed on shutdown")
		}
	})
}

func TestFullRoom(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		for i := range 4 {
			if _, err := r.Join(t.Context(), Who{Name: "p"}, &fakeSender{}); err != nil {
				t.Fatalf("join %d: %v", i, err)
			}
		}
		if _, err := r.Join(t.Context(), Who{Name: "p"}, &fakeSender{}); !errors.Is(err, game.ErrFull) {
			t.Fatalf("5th join: %v", err)
		}
	})
}

// Before its first input a human's plane flies on its own throttle (spawn
// 0.8), not on a zero input repeated by the session.
func TestNoInputKeepsSpawnThrottle(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		out := &fakeSender{}
		seat, err := r.Join(t.Context(), Who{Name: "a"}, out)
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
			if p.ID != seat.ID() {
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

// A room nobody ever joins closes after UnusedTimeout, not EmptyTimeout.
func TestUnusedRoomCloses(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		time.Sleep(UnusedTimeout - time.Second)
		synctest.Wait()
		select {
		case <-r.Done():
			t.Fatal("closed too early")
		default:
		}
		time.Sleep(2 * time.Second)
		synctest.Wait()
		select {
		case <-r.Done():
		default:
			t.Fatal("unused room still running")
		}
	})
}
