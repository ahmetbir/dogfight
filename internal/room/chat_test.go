package room

import (
	"context"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/netproto"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
)

func TestChatTeamOnlyAndCooldown(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r := New("CHAT", game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1}, Options{})
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go r.Run(ctx)
		a, b, c := &fakeSender{}, &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(ctx, Who{Name: "a"}, a) // NATO
		r.Join(ctx, Who{Name: "b"}, b)          // Soviet
		r.Join(ctx, Who{Name: "c"}, c)          // NATO
		sa.Input(protocol.ClientMsg{T: protocol.TChat, Chat: 3})
		sa.Input(protocol.ClientMsg{T: protocol.TChat, Chat: 4}) // inside the cooldown: dropped
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if a.count("chat") != 1 || c.count("chat") != 1 || b.count("chat") != 0 {
			t.Fatalf("a=%d b=%d c=%d", a.count("chat"), b.count("chat"), c.count("chat"))
		}
		time.Sleep(2 * time.Second)
		sa.Input(protocol.ClientMsg{T: protocol.TChat, Chat: 5})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if c.count("chat") != 2 {
			t.Fatalf("after the cooldown: %d", c.count("chat"))
		}
	})
}

func TestChatReachesEveryoneInFFA(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, cancel := start(t)
		defer cancel()
		a, b := &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(t.Context(), Who{Name: "a"}, a)
		r.Join(t.Context(), Who{Name: "b"}, b)
		sa.Input(protocol.ClientMsg{T: protocol.TChat, Chat: 1})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if a.count("chat") != 1 || b.count("chat") != 1 {
			t.Fatalf("a=%d b=%d", a.count("chat"), b.count("chat"))
		}
		b.mu.Lock()
		defer b.mu.Unlock()
		for _, m := range b.msgs {
			if c, ok := m.(protocol.ChatMsg); ok && (c.From != netproto.PlayerID(sa.ID()) || c.ID != 1) {
				t.Fatalf("chat %+v", c)
			}
		}
	})
}
