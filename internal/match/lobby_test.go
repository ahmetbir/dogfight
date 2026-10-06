package match

import (
	"context"
	"sync/atomic"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
	"playground/internal/protocol"
	"playground/internal/stats"
)

// The lobby hands its stats sink to every room it builds (to the match: a
// seated pilot's flight reaches it on a drain flush) and its creation order
// to the room.
func TestStatsSinkReachesRooms(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		sk := &countSink{}
		l := NewLobby(ctx, 0, nil, sk)
		r, err := l.Create(ffa4)
		if err != nil {
			t.Fatal(err)
		}
		if got := r.Summary().Seq; got != 1 {
			t.Fatalf("room seq %d", got)
		}
		seat, err := r.Join(ctx, room.Who{Name: "a", Pilot: "pa"}, &fakeSender{})
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

// The options NewLobby hands every room set ChatMax explicitly. Behaviour
// alone cannot show it while protocol.ChatMax == room.DefaultChatMax (a room
// defaults a zero ChatMax), so the option value itself is asserted.
func TestLobbyRoomOptionsSetChatMax(t *testing.T) {
	if got := roomOptions().ChatMax; got != protocol.ChatMax {
		t.Fatalf("ChatMax option %d, want %d", got, protocol.ChatMax)
	}
}

// The lobby's rooms relay quick chats up to the protocol's ChatMax only.
func TestLobbyRoomsCarryProtocolChatMax(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		r, err := NewLobby(ctx, 0, nil, nil).Create(ffa4)
		if err != nil {
			t.Fatal(err)
		}
		s := &fakeSender{}
		seat, err := r.Join(ctx, room.Who{Name: "a"}, s)
		if err != nil {
			t.Fatal(err)
		}
		seat.Input(protocol.ClientMsg{T: protocol.TChat, Chat: protocol.ChatMax + 1})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if s.count("chat") != 0 {
			t.Fatal("a preset above ChatMax was relayed")
		}
		seat.Input(protocol.ClientMsg{T: protocol.TChat, Chat: protocol.ChatMax})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if s.count("chat") != 1 {
			t.Fatalf("ChatMax preset relayed %d times", s.count("chat"))
		}
	})
}
