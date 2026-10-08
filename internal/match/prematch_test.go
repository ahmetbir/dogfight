package match

import (
	"context"
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
		if s := r.Summary(); s.Game.Phase != "lobby" || s.Humans != 2 || s.Game.Seats != 4 || s.Seats != 2 || s.Bots != 0 {
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

// Quick play never seats a player in a created room, waiting in its lobby
// or playing (its round ends in the lobby); a quick-play room it still
// fills. The room list keeps the created room's real seats.
func TestQuickPlaySkipsCreatedRooms(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		l := NewLobby(ctx, 0, nil, nil, nil, Moderation{})
		created := lobby2
		created.Listed = true
		r, err := l.Create(created)
		if err != nil {
			t.Fatal(err)
		}
		host := &fakeSender{}
		seat, _ := r.Join(ctx, room.Who{Name: "host"}, host)
		settle()
		if got, ok := l.Quick(); ok {
			t.Fatalf("quick play picked the lobby room %s", got.Summary().Code)
		}
		if s := r.Summary(); s.Game.Seats != 4 || s.Humans != 1 {
			t.Fatalf("summary %+v", s)
		}
		seat.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		if r.Summary().Game.Phase != "playing" {
			t.Fatal("not started")
		}
		if _, ok := l.Quick(); ok {
			t.Fatal("quick play picked the created room while it plays")
		}
		q, err := l.Create(game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 2, Listed: true})
		if err != nil {
			t.Fatal(err)
		}
		settle()
		if got, ok := l.Quick(); !ok || got != q {
			t.Fatal("quick play skips its own kind of room")
		}
	})
}

// A host who drops and rejoins under its pilot token within
// ReturnTicks is the host again; later, or another pilot, is not.
func TestHostReturnsAfterReconnect(t *testing.T) {
	m := New(lobby2, nil)
	host, _ := m.Join(room.Who{Name: "host", Pilot: "ph"})
	friend, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	m.Leave(host)
	if m.g.Host() != sim.ID(friend) {
		t.Fatal("the friend holds the room meanwhile")
	}
	stranger, _ := m.Join(room.Who{Name: "x", Pilot: "px"})
	back, _ := m.Join(room.Who{Name: "host", Pilot: "ph"})
	if m.g.Host() != sim.ID(back) || back <= stranger {
		t.Fatalf("host %d, want the returning pilot %d", m.g.Host(), back)
	}

	late := New(lobby2, nil)
	h, _ := late.Join(room.Who{Name: "host", Pilot: "ph"})
	f, _ := late.Join(room.Who{Name: "friend", Pilot: "pf"})
	late.Leave(h)
	for range ReturnTicks + 1 {
		late.g.Step(nil)
	}
	if b, _ := late.Join(room.Who{Name: "host", Pilot: "ph"}); late.g.Host() != sim.ID(f) || b == f {
		t.Fatal("a host back after the window takes the role over")
	}
}

// A host whose new seat arrives before the old socket times out keeps the
// role when the old seat leaves.
func TestHostReconnectBeforeOldSeatLeaves(t *testing.T) {
	m := New(lobby2, nil)
	old, _ := m.Join(room.Who{Name: "host", Pilot: "ph"})
	friend, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	again, _ := m.Join(room.Who{Name: "host", Pilot: "ph"})
	m.Leave(old)
	if m.g.Host() != sim.ID(again) || again == friend {
		t.Fatalf("host %d, want the new seat %d", m.g.Host(), again)
	}
}

// A friend who drops in the lobby and returns within ReturnTicks gets its
// side and jet back (not the auto-balanced side and its default); later,
// it is seated as a newcomer.
func TestLobbyReturnKeepsSideAndJet(t *testing.T) {
	m := New(lobby2, nil)
	m.Join(room.Who{Name: "host", Pilot: "ph"})
	f, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	if err := m.g.SetSide(sim.ID(f), sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	m.g.SetLoadout(sim.ID(f), sim.LoadRadar)
	if err := m.g.Pick(sim.ID(f), sim.F15); err != nil {
		t.Fatal(err)
	}
	m.Leave(f)
	back, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	p := playerOf(t, m, back)
	if p.Team != sim.TeamNATO || p.Kind != sim.F15 || p.Loadout != sim.LoadRadar {
		t.Fatalf("back as %+v", p)
	}

	m.Leave(back)
	for range ReturnTicks + 1 {
		m.g.Step(nil)
	}
	late, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	if p := playerOf(t, m, late); p.Team != sim.TeamSoviet {
		t.Fatalf("after the window the newcomer is auto-balanced: %+v", p)
	}
}

// The new seat arrived first (the old socket had not timed out yet): when
// the old seat leaves, the new one takes its side and jet.
func TestLobbyReturnBeforeOldSeatLeaves(t *testing.T) {
	m := New(lobby2, nil)
	m.Join(room.Who{Name: "host", Pilot: "ph"})
	old, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	_ = m.g.SetSide(sim.ID(old), sim.TeamNATO)
	_ = m.g.Pick(sim.ID(old), sim.F15)
	again, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"}) // auto: Soviet
	m.Leave(old)
	if p := playerOf(t, m, again); p.Team != sim.TeamNATO || p.Kind != sim.F15 {
		t.Fatalf("new seat %+v", p)
	}
}

func playerOf(t *testing.T, m *Match, id room.PlayerID) game.Player {
	t.Helper()
	for _, p := range m.g.Players() {
		if p.ID == sim.ID(id) {
			return p
		}
	}
	t.Fatalf("no player %d", id)
	return game.Player{}
}

// A draining server closes a room waiting in its lobby after
// LobbyDrainTicks (lobby_closed to everyone, once); a running room plays on;
// an undrain before the grace keeps the lobby.
func TestDrainClosesLobby(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		d := &Drain{}
		mk, _ := Factory(nil, d, Moderation{})(lobby2)
		r := room.New("ABCD", mk, room.Options{})
		quick, _ := Factory(nil, d, Moderation{})(game.Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 1})
		q := room.New("QQQQ", quick, room.Options{})
		ctx, cancel := context.WithCancel(t.Context())
		defer cancel()
		go r.Run(ctx)
		go q.Run(ctx)
		a, b, c := &fakeSender{}, &fakeSender{}, &fakeSender{}
		r.Join(ctx, room.Who{Name: "a"}, a)
		r.Join(ctx, room.Who{Name: "b"}, b)
		q.Join(ctx, room.Who{Name: "c"}, c)
		d.Set(true)
		time.Sleep(5 * time.Second)
		d.Set(false) // rollback inside the grace
		time.Sleep(10 * time.Second)
		synctest.Wait()
		if len(a.noticeCodes()) != 0 {
			t.Fatal("closed after an undrain")
		}
		d.Set(true)
		time.Sleep(time.Duration(LobbyDrainTicks/tickRate)*time.Second + time.Second)
		time.Sleep(30 * time.Second)
		synctest.Wait()
		for _, s := range []*fakeSender{a, b} {
			if n := s.noticeCodes(); len(n) != 1 || n[0] != protocol.CodeLobbyClosed {
				t.Fatalf("lobby notices %v", n)
			}
		}
		if len(c.noticeCodes()) != 0 {
			t.Fatal("a running room was closed")
		}
	})
}

// A lobby room's whole round through the room actor: Start, the round runs
// out, the scoreboard, back to the Lobby (lobby message phase "lobby", room
// list phase "lobby", no bots), each pilot's match recorded exactly once;
// then the host starts again.
func TestLobbyRoundThroughTick(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sk := &sink{}
		s := lobby2
		r, _, cancel := startMatch(t, s, sk)
		defer cancel()
		a, b := &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(t.Context(), room.Who{Name: "a", Pilot: "pa"}, a)
		r.Join(t.Context(), room.Who{Name: "b", Pilot: "pb"}, b)
		sa.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		for range 120 { // up to 20 min of fake time
			time.Sleep(10 * time.Second)
			synctest.Wait()
			if r.Summary().Game.Phase == "lobby" {
				break
			}
		}
		if s := r.Summary(); s.Game.Phase != "lobby" || s.Bots != 0 || s.Humans != 2 {
			t.Fatalf("after the round %+v", s)
		}
		if l, _ := b.lastLobby(); l.Phase != "lobby" || len(l.List) != 2 {
			t.Fatalf("lobby message %+v", l)
		}
		time.Sleep(time.Minute) // the lobby records nothing more
		synctest.Wait()
		got := map[string]int{}
		for _, d := range sk.all() {
			got[d.Pilot] += d.Matches
		}
		if got["pa"] != 1 || got["pb"] != 1 {
			t.Fatalf("matches recorded %v (%+v)", got, sk.all())
		}
		sa.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		if r.Summary().Game.Phase != "playing" {
			t.Fatal("no second round")
		}
	})
}

// While a round runs the lobby message goes out only on a phase change:
// picks and joins are in the players message already.
func TestLobbyMessageQuietWhilePlaying(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, lobby2, nil)
		defer cancel()
		a := &fakeSender{}
		sa, _ := r.Join(t.Context(), room.Who{Name: "a"}, a)
		sa.Input(protocol.ClientMsg{T: protocol.TStart})
		settle()
		n := a.count("lobby")
		sa.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f15"})
		r.Join(t.Context(), room.Who{Name: "late"}, &fakeSender{})
		settle()
		if a.count("lobby") != n || a.count("players") == 0 {
			t.Fatalf("lobby messages %d → %d while playing", n, a.count("lobby"))
		}
	})
}

// Two tabs of one browser share a pilot token: one leaving hands nothing
// to the other, older seat (only a newer seat is a reconnect).
func TestOlderSeatOfSamePilotIsNotAReturn(t *testing.T) {
	m := New(lobby2, nil)
	host, _ := m.Join(room.Who{Name: "host", Pilot: "same"})
	tab, _ := m.Join(room.Who{Name: "tab", Pilot: "same"})
	_ = m.g.Pick(sim.ID(tab), sim.Su27)
	m.Leave(tab)
	if p := playerOf(t, m, host); p.Team != sim.TeamNATO || p.Kind == sim.Su27 {
		t.Fatalf("the host took the other tab's seat: %+v", p)
	}
}
