package match

import (
	"errors"
	"testing"
	"testing/synctest"
	"time"

	"playground/core/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// A switch moves quick chat to the new team, lists the new split in the
// lobby summary, and a second switch inside the cooldown gets a notice.
func TestTeamSwitchChatSummaryNotice(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		r, _, cancel := startMatch(t, game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1}, nil)
		defer cancel()
		ctx := t.Context()
		a, b, c := &fakeSender{}, &fakeSender{}, &fakeSender{}
		sa, _ := r.Join(ctx, room.Who{Name: "a"}, a) // NATO
		r.Join(ctx, room.Who{Name: "b"}, b)          // Soviet
		r.Join(ctx, room.Who{Name: "c"}, c)          // NATO
		if s := r.Summary(); s.Game.NATO != 2 || s.Game.Soviet != 1 {
			t.Fatalf("summary before %+v", s)
		}
		sa.Input(protocol.ClientMsg{T: protocol.TPick, Kind: "f16"})
		sa.Input(protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if s := r.Summary(); s.Game.NATO != 1 || s.Game.Soviet != 2 {
			t.Fatalf("summary after %+v", s)
		}
		sa.Input(protocol.ClientMsg{T: protocol.TChat, Chat: 2})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if a.count("chat") != 1 || b.count("chat") != 1 || c.count("chat") != 0 {
			t.Fatalf("chat after switch a=%d b=%d c=%d", a.count("chat"), b.count("chat"), c.count("chat"))
		}
		sa.Input(protocol.ClientMsg{T: protocol.TTeam, Team: "nato"})
		time.Sleep(100 * time.Millisecond)
		synctest.Wait()
		if n := a.notices(); len(n) != 1 || n[0] != "Takım değiştirmek için 30 sn bekle" {
			t.Fatalf("notices %q", n)
		}
		if len(b.notices()) != 0 {
			t.Fatal("a notice goes to the asker only")
		}
	})
}

// The team at round end gets the win; presence before the switch counts.
func TestSwitchWinGoesToTeamAtRoundEnd(t *testing.T) {
	sk := &sink{}
	m := New(game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1}, sk)
	a := seatCounted(t, m, "a") // NATO
	a.roundTicks, a.airborne = MatchTicks/2, true
	if err := m.g.Pick(a.id, sim.F16); err != nil { // flying: the change is a switch
		t.Fatal(err)
	}
	if err := m.g.ChooseTeam(a.id, sim.TeamSoviet); err != nil {
		t.Fatal(err)
	}
	a.roundTicks += MatchTicks / 2 // the rest of the minute on the new team
	m.roundOver(game.Round{Phase: game.Ended, WinnerTeam: sim.TeamSoviet})
	got := sk.all()
	if len(got) != 1 || got[0].Matches != 1 || got[0].Wins != 1 {
		t.Fatalf("switcher's tally: %+v", got)
	}
}

func TestTeamRefusalTexts(t *testing.T) {
	for err, want := range map[error][2]string{
		game.ErrLate:     {protocol.CodeTeamLate, "Raundun son 60 saniyesinde takım değiştirilemez"},
		game.ErrLocked:   {protocol.CodeTeamLocked, "Kilitliyken takım değiştiremezsin"},
		game.ErrHurt:     {protocol.CodeTeamHurt, "Hasar aldıktan sonra 10 sn bekle"},
		game.ErrUneven:   {protocol.CodeTeamUneven, "Takımlar dengesiz olur"},
		game.ErrTeamFull: {protocol.CodeTeamFull, "Takım dolu"},
		game.ErrCooldown: {protocol.CodeTeamCooldown, "Takım değiştirmek için 30 sn bekle"},
		game.ErrNoTeams:  {protocol.CodeTeamNone, "Bu modda takım yok"},
	} {
		if code, msg := teamMsg(err); code != want[0] || msg != want[1] {
			t.Fatalf("%v → %q %q", err, code, msg)
		}
	}
	if code, msg := teamMsg(errors.New("x")); code != "" || msg != "" {
		t.Fatal("unknown error got a notice")
	}
}
