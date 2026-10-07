package match

import (
	"testing"
	"testing/synctest"
	"time"

	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
)

var lobby2 = game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1, Lobby: true}

func (f *fakeSender) lastLobby() (protocol.LobbyMsg, bool) {
	f.mu.Lock()
	defer f.mu.Unlock()
	for i := len(f.msgs) - 1; i >= 0; i-- {
		if l, ok := f.msgs[i].(protocol.LobbyMsg); ok {
			return l, true
		}
	}
	return protocol.LobbyMsg{}, false
}

func (f *fakeSender) noticeCodes() []string {
	f.mu.Lock()
	defer f.mu.Unlock()
	var out []string
	for _, m := range f.msgs {
		if n, ok := m.(netproto.NoticeMsg); ok {
			out = append(out, n.Code)
		}
	}
	return out
}

func settle() {
	time.Sleep(100 * time.Millisecond)
	synctest.Wait()
}

// Two friends in a created room: both see the lobby live, the guest's start
// is refused with not_host, they pick one side, the host starts, both get
// planes on that side next to bots, and side requests are then refused with
// not_lobby. The room list shows the phase and the bots driving.
func TestLobbyRoomFlow(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, lobby2, nil)
		defer cancel()
		ctx := t.Context()
		a, b := &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(ctx, room.Who{Name: "host"}, a)
		sb, _ := r.Join(ctx, room.Who{Name: "friend"}, b)
		settle()
		if s := r.Summary(); s.Game.Phase != "lobby" || s.Humans != 2 || s.Seats != 4 || s.Bots != 0 {
			t.Fatalf("lobby summary %+v", s)
		}
		l, ok := b.lastLobby()
		if !ok || l.Phase != "lobby" || l.Host != sim.ID(sa.ID()) || l.Seats != 2 || len(l.List) != 2 || l.List[1].Team != "soviet" {
			t.Fatalf("lobby %+v", l)
		}
		if b.events("spawn", sim.ID(sa.ID())) != 0 {
			t.Fatal("nobody flies in the lobby")
		}
		sb.Input(protocol.ClientMsg{T: protocol.TStart})
		sb.Input(protocol.ClientMsg{T: protocol.TSide, Team: "nato"})
		sb.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f15"})
		settle()
		if c := b.noticeCodes(); len(c) != 1 || c[0] != protocol.CodeNotHost {
			t.Fatalf("guest notices %v", c)
		}
		if l, _ := a.lastLobby(); l.List[1].Team != "nato" || l.List[1].Kind != "f15" {
			t.Fatalf("host sees %+v", l)
		}
		sa.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		if s := r.Summary(); s.Game.Phase != "playing" || s.Bots != 2 || s.Game.NATO != 2 {
			t.Fatalf("playing summary %+v", s)
		}
		if l, _ := b.lastLobby(); l.Phase != "playing" {
			t.Fatalf("lobby after start %+v", l)
		}
		snap, _ := b.lastSnap()
		mine := 0
		for _, p := range snap.Planes {
			if (p.ID == sim.ID(sa.ID()) || p.ID == sim.ID(sb.ID())) && p.Team == "nato" && p.Alive {
				mine++
			}
			if p.ID == sim.ID(sb.ID()) && p.Kind != "f15" {
				t.Fatalf("friend flies %s", p.Kind)
			}
		}
		if mine != 2 || len(snap.Planes) != 4 {
			t.Fatalf("planes %+v", snap.Planes)
		}
		sb.Input(protocol.ClientMsg{T: protocol.TSide, Team: "soviet"})
		sa.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		if c := b.noticeCodes(); len(c) != 2 || c[1] != protocol.CodeNotLobby {
			t.Fatalf("guest notices %v", c)
		}
		if c := a.noticeCodes(); len(c) != 1 || c[0] != protocol.CodeNotLobby {
			t.Fatalf("host notices %v", c)
		}
	})
}

// The host leaving hands the lobby to the next joiner, who can start.
func TestLobbyHostLeaves(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, lobby2, nil)
		defer cancel()
		ctx := t.Context()
		a, b := &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(ctx, room.Who{Name: "host"}, a)
		sb, _ := r.Join(ctx, room.Who{Name: "next"}, b)
		settle()
		sa.Leave()
		settle()
		if l, _ := b.lastLobby(); l.Host != sim.ID(sb.ID()) || len(l.List) != 1 {
			t.Fatalf("after the host left %+v", l)
		}
		sb.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		if s := r.Summary(); s.Game.Phase != "playing" || s.Bots != 3 {
			t.Fatalf("summary %+v", s)
		}
	})
}

// A side with every seat taken is refused with side_full.
func TestLobbySideFullNotice(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, game.Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 1, Lobby: true}, nil)
		defer cancel()
		ctx := t.Context()
		a, b := &fakeSender{}, &fakeSender{}
		r.Join(ctx, room.Who{Name: "a"}, a)
		sb, _ := r.Join(ctx, room.Who{Name: "b"}, b)
		sb.Input(protocol.ClientMsg{T: protocol.TSide, Team: "nato"})
		settle()
		if c := b.noticeCodes(); len(c) != 1 || c[0] != protocol.CodeSideFull {
			t.Fatalf("notices %v", c)
		}
	})
}

// Quick play rooms send no lobby message and play at once.
func TestQuickRoomHasNoLobby(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1}, nil)
		defer cancel()
		a := &fakeSender{}
		r.Join(t.Context(), room.Who{Name: "a"}, a)
		settle()
		if a.count("lobby") != 0 || r.Summary().Game.Phase != "playing" {
			t.Fatalf("lobby msgs %d phase %s", a.count("lobby"), r.Summary().Game.Phase)
		}
	})
}

func TestLobbyRefusalTexts(t *testing.T) {
	for err, want := range map[error][2]string{
		game.ErrNotHost:  {protocol.CodeNotHost, "Raundu yalnızca oda sahibi başlatır"},
		game.ErrNotLobby: {protocol.CodeNotLobby, "Raund zaten başladı"},
		game.ErrSideFull: {protocol.CodeSideFull, "Bu tarafta boş yer yok"},
	} {
		if code, msg := teamMsg(err); code != want[0] || msg != want[1] {
			t.Fatalf("%v → %q %q", err, code, msg)
		}
	}
}
