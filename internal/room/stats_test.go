package room

import (
	"sync"
	"testing"
	"testing/synctest"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/stats"
)

type sink struct {
	mu sync.Mutex
	d  []stats.Delta
}

func (s *sink) Record(d stats.Delta) bool {
	s.mu.Lock()
	defer s.mu.Unlock()
	s.d = append(s.d, d)
	return true
}

func (s *sink) all() []stats.Delta {
	s.mu.Lock()
	defer s.mu.Unlock()
	return append([]stats.Delta(nil), s.d...)
}

func TestTalliesFlushOnLeave(t *testing.T) {
	synctest.Test(t, func(t *testing.T) {
		sk := &sink{}
		r := New("STAT", game.Settings{Mode: mode.FFA, Size: 3, Difficulty: bot.Easy, Seed: 1, Listed: true}, Options{Stats: sk})
		// drive the actor's state directly (same package): seat two humans
		a, _ := r.game.AddHuman("a")
		b, _ := r.game.AddHuman("b")
		r.sessions[a] = newSession(a, &fakeSender{})
		r.sessions[a].pilot, r.sessions[a].name = "pa", "a"
		r.sessions[a].roundTicks, r.sessions[a].airborne = MatchTicks, true
		r.sessions[b] = newSession(b, &fakeSender{})
		r.countEvents([]sim.Event{
			{Kind: sim.EvKill, Plane: b, Other: a, Weapon: sim.WMissile},
			{Kind: sim.EvMissileLaunch, Plane: 1 << 24, By: a},
			{Kind: sim.EvHit, Plane: b, Other: a, Weapon: sim.WMissile},
			{Kind: sim.EvKill, Plane: a, Weapon: sim.WCrash},
		})
		r.roundOver(game.Round{Phase: game.Ended, WinnerID: a})
		if len(sk.d) != 1 {
			t.Fatalf("one flush for the counted pilot, got %+v", sk.d)
		}
		d := sk.d[0]
		if d.Pilot != "pa" || d.Name != "a" || d.Kills != 1 || d.Deaths != 1 || d.Crashes != 1 || d.Fired != 1 || d.Hits != 1 || d.Matches != 1 || d.Wins != 1 {
			t.Fatalf("delta %+v", d)
		}
		r.leave(a)
		if len(sk.d) != 1 {
			t.Fatal("nothing new to flush after the round")
		}
	})
}

// Kills of bots go to BotKills (personal card), never to the leaderboard's
// Kills (ruling S5); a team kill counts for nobody.
func TestBotAndTeamKills(t *testing.T) {
	sk := &sink{}
	r := New("STAB", game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1, Listed: true}, Options{Stats: sk})
	a, _ := r.game.AddHuman("a") // NATO
	r.sessions[a] = newSession(a, &fakeSender{})
	r.sessions[a].pilot = "pa"
	var mate, enemy sim.ID
	teams := r.teams()
	for _, p := range r.game.Players() {
		switch {
		case p.ID == a:
		case teams[p.ID] == teams[a]:
			mate = p.ID
		default:
			enemy = p.ID
		}
	}
	if mate == 0 || enemy == 0 {
		t.Fatalf("roster: mate %d enemy %d", mate, enemy)
	}
	r.countEvents([]sim.Event{
		{Kind: sim.EvKill, Plane: enemy, Other: a, Weapon: sim.WCannon},
		{Kind: sim.EvKill, Plane: mate, Other: a, Weapon: sim.WCannon},
	})
	r.leave(a)
	got := sk.all()
	if len(got) != 1 || got[0].Kills != 0 || got[0].BotKills != 1 {
		t.Fatalf("bot kill → BotKills only, team kill not counted: %+v", got)
	}
}

// Flight is counted per snapshot for a live airborne plane, by kind.
func TestFlightCounted(t *testing.T) {
	sk := &sink{}
	r := New("STAF", ffa4, Options{Stats: sk})
	a, _ := r.game.AddHuman("a")
	r.sessions[a] = newSession(a, &fakeSender{})
	r.sessions[a].pilot = "pa"
	kind := sim.Su27
	snap := sim.Snapshot{Planes: []sim.Plane{{ID: a, Kind: kind, Alive: true}}}
	r.countFlight(snap, game.Playing)
	snap.Planes[0].Ground = true
	r.countFlight(snap, game.Playing) // on the wheels: not flight
	snap.Planes[0].Ground, snap.Planes[0].Alive = false, false
	r.countFlight(snap, game.Playing) // dead: not flight
	r.closeAll()
	got := sk.all()
	if len(got) != 1 || got[0].Flight != SnapEvery || got[0].Kinds[kind.String()] != SnapEvery {
		t.Fatalf("flight tally %+v", got)
	}
}

// Without a sink nothing is tallied.
func TestNoStatsNoTally(t *testing.T) {
	r := New("STAN", ffa4, Options{})
	a, _ := r.game.AddHuman("a")
	r.sessions[a] = newSession(a, &fakeSender{})
	r.sessions[a].pilot = "pa"
	r.countEvents([]sim.Event{{Kind: sim.EvMissileLaunch, By: a}})
	if !r.sessions[a].tally.Empty() {
		t.Fatal("tallied without a sink")
	}
}

// counted seats a counted human pilot "p<name>" straight into the actor's state.
func seatCounted(t *testing.T, r *Room, name string) *session {
	t.Helper()
	id, err := r.game.AddHuman(name)
	if err != nil {
		t.Fatal(err)
	}
	s := newSession(id, &fakeSender{})
	s.pilot, s.name = "p"+name, name
	r.sessions[id] = s
	return s
}

// In a private room a human victim gives no leaderboard credit: it goes to
// the personal card like a bot kill (two tabs cannot farm the board).
func TestPrivateRoomKillsStayOffTheBoard(t *testing.T) {
	sk := &sink{}
	r := New("PRIV", ffa4, Options{Stats: sk}) // Listed false
	a, b := seatCounted(t, r, "a"), seatCounted(t, r, "b")
	r.countEvents([]sim.Event{{Kind: sim.EvKill, Plane: b.id, Other: a.id, Weapon: sim.WCannon}})
	r.flush(a)
	got := sk.all()
	if len(got) != 1 || got[0].Kills != 0 || got[0].BotKills != 1 {
		t.Fatalf("private human kill: %+v", got)
	}
}

// Joining just before the winning end is no match and no win.
func TestLateJoinGetsNoMatch(t *testing.T) {
	sk := &sink{}
	r := New("LATE", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	a.roundTicks, a.airborne = MatchTicks-1, true
	a.tally.Fired = 1 // something to flush
	r.roundOver(game.Round{Phase: game.Ended, WinnerID: a.id})
	got := sk.all()
	if len(got) != 1 || got[0].Matches != 0 || got[0].Wins != 0 {
		t.Fatalf("late joiner: %+v", got)
	}
}

// A minute present but never airborne (parked in the hangar) is no match.
func TestNeverAirborneGetsNoMatch(t *testing.T) {
	sk := &sink{}
	r := New("PARK", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	a.roundTicks = 10 * MatchTicks
	r.roundOver(game.Round{Phase: game.Ended, WinnerID: a.id})
	if got := sk.all(); len(got) != 0 {
		t.Fatalf("no match, nothing to flush: %+v", got)
	}
}

// Leaving a played round before a loss still counts the match, without a
// win; the presence is then spent, so the next round end cannot count it again.
func TestLeavingCountsThePlayedMatch(t *testing.T) {
	sk := &sink{}
	r := New("QUIT", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	b := seatCounted(t, r, "b")
	for range MatchTicks {
		r.countPresence()
	}
	r.countFlight(sim.Snapshot{Planes: []sim.Plane{{ID: a.id, Kind: sim.F16, Alive: true}}}, game.Playing)
	r.leave(a.id)
	got := sk.all()
	if len(got) != 1 || got[0].Pilot != "pa" || got[0].Matches != 1 || got[0].Wins != 0 {
		t.Fatalf("leaver: %+v", got)
	}
	r.roundOver(game.Round{Phase: game.Ended, WinnerID: b.id})
	if got := sk.all(); len(got) != 1 {
		t.Fatalf("b never flew, a already left: %+v", got)
	}
}

// Leaving before a minute of play counts no match.
func TestEarlyLeaveCountsNoMatch(t *testing.T) {
	sk := &sink{}
	r := New("EARL", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	a.roundTicks, a.airborne = MatchTicks/2, true
	a.tally.Fired = 1
	r.leave(a.id)
	if got := sk.all(); len(got) != 1 || got[0].Matches != 0 {
		t.Fatalf("early leaver: %+v", got)
	}
}

// I2: the round-end scoreboard freezes a world that may still hold airborne
// planes; those snapshots count neither flight nor "airborne once", so the
// next round starts with no head start toward a match.
func TestEndedPhaseCountsNoFlight(t *testing.T) {
	sk := &sink{}
	r := New("STAE", ffa4, Options{Stats: sk})
	a := seatCounted(t, r, "a")
	snap := sim.Snapshot{Planes: []sim.Plane{{ID: a.id, Kind: sim.F16, Alive: true}}}
	for range game.EndedTicks / SnapEvery {
		r.countFlight(snap, game.Ended)
	}
	if a.airborne || a.tally.Flight != 0 || len(a.tally.Kinds) != 0 {
		t.Fatalf("scoreboard snapshots counted: airborne %v tally %+v", a.airborne, a.tally)
	}
	r.countFlight(snap, game.Playing)
	if !a.airborne || a.tally.Flight != SnapEvery {
		t.Fatalf("playing snapshot not counted: airborne %v tally %+v", a.airborne, a.tally)
	}
}

// Two tabs share one token: killing the other tab credits nothing, even in a
// listed room (ruling: same-token kills credit nothing).
func TestSameTokenKillCreditsNothing(t *testing.T) {
	sk := &sink{}
	r := New("SAME", game.Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1, Listed: true}, Options{Stats: sk})
	a, b := seatCounted(t, r, "a"), seatCounted(t, r, "b")
	b.pilot = a.pilot
	r.countEvents([]sim.Event{{Kind: sim.EvKill, Plane: b.id, Other: a.id, Weapon: sim.WCannon}})
	if a.tally.Kills != 0 || a.tally.BotKills != 0 {
		t.Fatalf("same-token kill credited: %+v", a.tally)
	}
	if b.tally.Deaths != 1 {
		t.Fatalf("the victim's death still counts: %+v", b.tally)
	}
}
