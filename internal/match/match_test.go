package match

import (
	"errors"
	"testing"

	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// box records what the match sends, in order, as type names.
type box struct {
	log     []string
	changed int
}

func name(v any) string {
	switch m := v.(type) {
	case protocol.Welcome:
		return "welcome"
	case protocol.Snap:
		return "snap"
	case protocol.PlayersMsg:
		return "players"
	case protocol.RoundMsg:
		return "round"
	case netproto.NoticeMsg:
		return "notice:" + m.Code
	}
	return "?"
}

func (b *box) To(id room.PlayerID, v any) { b.log = append(b.log, "to "+name(v)) }
func (b *box) All(v any)                  { b.log = append(b.log, "all "+name(v)) }
func (b *box) Snap(v room.Acker)          { b.log = append(b.log, "snap "+name(v.WithAck(1))) }
func (b *box) Changed()                   { b.changed++ }

var ffa4 = game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1}

func TestWelcomeOrderAndFull(t *testing.T) {
	m := New(game.Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 1}, nil)
	b := &box{}
	a, err := m.Join(room.Who{Name: "a"})
	if err != nil {
		t.Fatal(err)
	}
	m.Welcome(a, "ABCD", "", b)
	if got := b.log; len(got) != 3 || got[0] != "to welcome" || got[1] != "all players" || got[2] != "to round" {
		t.Fatalf("welcome order %v", got)
	}
	if _, err := m.Join(room.Who{Name: "b"}); err != nil {
		t.Fatal(err)
	}
	if _, err := m.Join(room.Who{Name: "c"}); !errors.Is(err, room.ErrFull) || !errors.Is(err, game.ErrFull) {
		t.Fatalf("third join: %v", err)
	}
	if in := m.Info(); in.Humans != 2 || in.Seats != 2 || in.Game.Mode != "ffa" || in.Game.Phase != "playing" {
		t.Fatalf("info %+v", in)
	}
}

func TestStepOrderSnapEveryOtherTickThenRosterThenRound(t *testing.T) {
	m := New(ffa4, nil)
	b := &box{}
	a, _ := m.Join(room.Who{Name: "a"})
	m.Step(map[room.PlayerID]sim.Input{a: {Throttle: 1}}, b) // tick 1: roster changed (join), round key new
	m.Step(nil, b)                                           // tick 2: snapshot
	want := []string{"all players", "all round", "snap snap"}
	if len(b.log) < 3 || b.log[0] != want[0] || b.log[1] != want[1] || b.log[2] != want[2] {
		t.Fatalf("step order %v", b.log)
	}
}

func TestTeamRefusalIsANoticeAndSuccessRepublishes(t *testing.T) {
	m := New(game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1}, nil)
	b := &box{}
	a, _ := m.Join(room.Who{Name: "a"}) // NATO with this seed and size
	m.Handle(a, protocol.ClientMsg{T: protocol.TPick, Kind: "f16"}, b)
	m.Step(nil, b) // the plane flies: later switches are gated, not free
	b.log, b.changed = nil, 0
	cur, other := "nato", "soviet"
	if m.teams()[sim.ID(a)] == sim.TeamSoviet {
		t.Fatal("seed/size no longer seat the human on NATO")
	}
	m.Handle(a, protocol.ClientMsg{T: protocol.TTeam, Team: other}, b)
	m.Handle(a, protocol.ClientMsg{T: protocol.TTeam, Team: cur}, b) // back, inside the cooldown
	if b.changed != 1 || len(b.log) != 1 || b.log[0] != "to notice:"+protocol.CodeTeamCooldown {
		t.Fatalf("changed=%d log=%v", b.changed, b.log)
	}
	ffa := New(ffa4, nil)
	f, _ := ffa.Join(room.Who{Name: "f"})
	b2 := &box{}
	ffa.Handle(f, protocol.ClientMsg{T: protocol.TTeam, Team: "nato"}, b2)
	if len(b2.log) != 1 || b2.log[0] != "to notice:"+protocol.CodeTeamNone {
		t.Fatalf("ffa team %v", b2.log)
	}
}

func TestChatScope(t *testing.T) {
	m := New(game.Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Easy, Seed: 1}, nil)
	a, _ := m.Join(room.Who{Name: "a"})
	mine := m.teams()[sim.ID(a)]
	var foe room.PlayerID
	for _, p := range m.g.Players() {
		if p.Team != mine {
			foe = room.PlayerID(p.ID)
		}
	}
	to := m.ChatScope(a)
	if foe == 0 || !to(a) || to(foe) {
		t.Fatalf("team chat scope: foe %d, self %v, foe reached %v", foe, to(a), to(foe))
	}
	ffa := New(ffa4, nil)
	x, _ := ffa.Join(room.Who{Name: "x"})
	if !ffa.ChatScope(x)(x + 1) {
		t.Fatal("ffa chat must reach everyone")
	}
}

// A pick on the wire names its kind as a string: every kind of the table is
// accepted (FFA flies all), an unknown or wrongly cased one is ignored.
func TestPickAcceptsEveryKindAndIgnoresUnknown(t *testing.T) {
	m := New(ffa4, nil)
	b := &box{}
	a, _ := m.Join(room.Who{Name: "a"})
	kindOf := func() sim.Kind {
		for _, p := range m.g.Players() {
			if p.ID == sim.ID(a) {
				return p.Kind
			}
		}
		t.Fatal("no player")
		return 0
	}
	for _, k := range sim.Kinds() {
		m.Handle(a, protocol.ClientMsg{T: protocol.TPick, Kind: k.String()}, b)
		if kindOf() != k {
			t.Fatalf("pick %q: flies %v", k, kindOf())
		}
	}
	last := kindOf()
	for _, bad := range []string{"zeppelin", "F16", "", "su-27", "mig31 "} {
		m.Handle(a, protocol.ClientMsg{T: protocol.TPick, Kind: bad}, b)
		if kindOf() != last {
			t.Fatalf("pick %q changed the kind to %v", bad, kindOf())
		}
	}
}
