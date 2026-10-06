package lobby

import (
	"context"
	"errors"
	"strings"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/metrics"
	"playground/core/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/stats"
)

var ffa = game.Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 1}

func TestCreateGetAndRemove(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	r, err := l.Create(ffa)
	if err != nil {
		t.Fatal(err)
	}
	if _, ok := NormalizeCode(r.Code()); !ok {
		t.Fatalf("bad code %q", r.Code())
	}
	got, ok := l.Get(strings.ToLower(r.Code()))
	if !ok || got != r {
		t.Fatal("Get(lowercase) did not find the room")
	}
	cancel()
	<-r.Done()
	deadline := time.Now().Add(2 * time.Second)
	for {
		if _, ok := l.Get(r.Code()); !ok {
			break
		}
		if time.Now().After(deadline) {
			t.Fatal("finished room still listed")
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func TestCodesUnique(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	seen := map[string]bool{}
	for range 20 {
		r, err := l.Create(ffa)
		if err != nil {
			t.Fatal(err)
		}
		if seen[r.Code()] {
			t.Fatalf("duplicate code %s", r.Code())
		}
		seen[r.Code()] = true
	}
}

func TestNormalizeCode(t *testing.T) {
	for in, want := range map[string]string{"abcd": "ABCD", "Z29k": "Z29K", "HJNP": "HJNP"} {
		if got, ok := NormalizeCode(in); !ok || got != want {
			t.Errorf("NormalizeCode(%q)=%q,%v", in, got, ok)
		}
	}
	for _, bad := range []string{"", "ABC", "ABCDE", "ABCI", "ABCO", "AB1D", "AB0D", "AB D", "ÂBCD", "../x"} {
		if _, ok := NormalizeCode(bad); ok {
			t.Errorf("NormalizeCode(%q) accepted", bad)
		}
	}
}

func TestMaxRooms(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{MaxRooms: 2})
	for range 2 {
		if _, err := l.Create(ffa); err != nil {
			t.Fatal(err)
		}
	}
	if _, err := l.Create(ffa); !errors.Is(err, ErrBusy) {
		t.Fatalf("3rd room: %v", err)
	}
	cancel()
	l.Wait()
	l.mu.Lock()
	n := len(l.rooms)
	l.mu.Unlock()
	if n != 0 {
		t.Fatalf("stopped rooms must free their slots: %d left", n)
	}
	// A shutting-down lobby starts nothing: a late Create must not race Wait.
	if _, err := l.Create(ffa); !errors.Is(err, ErrBusy) {
		t.Fatalf("create after shutdown: %v", err)
	}
}

type nopSender struct{}

func (nopSender) Send(any) bool { return true }
func (nopSender) Close()        {}

func TestListAndQuick(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	listed := ffa
	listed.Listed = true
	a, _ := l.Create(listed)
	b, _ := l.Create(listed)
	hidden, _ := l.Create(ffa) // Listed false
	if _, err := b.Join(ctx, room.Who{Name: "x"}, nopSender{}); err != nil {
		t.Fatal(err)
	}
	got := l.List()
	if len(got) != 2 || got[0].Code != b.Code() || got[1].Code != a.Code() {
		t.Fatalf("list %+v", got)
	}
	for _, s := range got {
		if s.Code == hidden.Code() {
			t.Fatal("private rooms are not listed")
		}
	}
	if r, ok := l.Quick(); !ok || r != b {
		t.Fatal("quick picks the listed room with the most humans")
	}
	if _, err := b.Join(ctx, room.Who{Name: "y"}, nopSender{}); err != nil { // ffa size 2: now full
		t.Fatal(err)
	}
	if r, ok := l.Quick(); !ok || r != a {
		t.Fatal("full rooms are skipped")
	}
}

// A panic while building a room is an error: the code is freed and Wait
// does not hang on the room that never ran.
func TestBuildPanicIsAnError(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	defer cancel()
	l := New(ctx, Options{})
	l.newRoom = func(string, game.Settings, room.Options) *match.Room { panic("boom") }
	if _, err := l.Create(ffa); err == nil {
		t.Fatal("a panicking build must fail")
	}
	l.mu.Lock()
	n := len(l.rooms)
	l.mu.Unlock()
	if n != 0 {
		t.Fatalf("reservation kept: %d", n)
	}
	cancel()
	waited := make(chan struct{})
	go func() { l.Wait(); close(waited) }()
	select {
	case <-waited:
	case <-time.After(2 * time.Second):
		t.Fatal("Wait hangs after a failed build")
	}
}

// The lobby hands its stats sink to every room it builds (to the match: a
// seated pilot's flight reaches it on a drain flush) and its creation order
// to the room.
func TestStatsSinkReachesRooms(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		sk := &countSink{}
		l := New(ctx, Options{Stats: sk})
		var got room.Options
		build := l.newRoom
		l.newRoom = func(code string, s game.Settings, o room.Options) *match.Room {
			got = o
			return build(code, s, o)
		}
		r, err := l.Create(ffa)
		if err != nil {
			t.Fatal(err)
		}
		if got.Seq != 1 {
			t.Fatalf("room options %+v", got)
		}
		seat, err := r.Join(ctx, room.Who{Name: "a", Pilot: "pa"}, nopSender{})
		if err != nil {
			t.Fatal(err)
		}
		seat.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f16"}) // spawns in the air
		time.Sleep(3 * time.Second)
		synctest.Wait()
		if !l.FlushStats(ctx) || sk.n.Load() == 0 {
			t.Fatalf("flushed tallies: %d", sk.n.Load())
		}
	})
}

type countSink struct{ n atomic.Int64 }

func (s *countSink) Record(stats.Delta) bool { s.n.Add(1); return true }

// The rooms gauge follows rooms that run.
func TestRoomsGauge(t *testing.T) {
	ctx, cancel := context.WithCancel(t.Context())
	reg := metrics.New("dogfight", nil)
	l := New(ctx, Options{Metrics: reg})
	l.Create(ffa)
	l.Create(ffa)
	if reg.Rooms.Load() != 2 || reg.Bots.Load() != 4 {
		t.Fatalf("rooms %d bots %d", reg.Rooms.Load(), reg.Bots.Load())
	}
	cancel()
	l.Wait()
	if reg.Rooms.Load() != 0 || reg.Bots.Load() != 0 {
		t.Fatalf("after shutdown: rooms %d bots %d", reg.Rooms.Load(), reg.Bots.Load())
	}
}
