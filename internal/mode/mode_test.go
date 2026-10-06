package mode

import (
	"testing"

	"playground/internal/sim"
)

func TestTeamScoringAndWin(t *testing.T) {
	r := NewRules(Team, 4)
	b := NewScoreboard()
	teamOf := func(id sim.ID) sim.Team { return map[sim.ID]sim.Team{1: sim.TeamNATO, 2: sim.TeamSoviet}[id] }
	for range 25 {
		b.Apply(sim.Event{Kind: sim.EvKill, Plane: 2, Other: 1}, teamOf)
	}
	if over, w := r.Over(b); !over || w != "NATO" {
		t.Fatalf("over=%v winner=%q", over, w)
	}
	if b.Lines()[0].ID != 1 || b.Lines()[0].Kills != 25 {
		t.Fatalf("lines %+v", b.Lines())
	}
}

func TestSuicidePenalty(t *testing.T) {
	b := NewScoreboard()
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 3, Other: 0, Weapon: sim.WCrash}, func(sim.ID) sim.Team { return sim.TeamNone })
	if l := b.Lines()[0]; l.Score != -1 || l.Deaths != 1 {
		t.Fatalf("%+v", l)
	}
}

func TestTeamBalance(t *testing.T) {
	r := NewRules(Team, 3)
	if r.TeamFor(map[sim.Team]int{sim.TeamNATO: 2, sim.TeamSoviet: 1}) != sim.TeamSoviet {
		t.Fatal("should fill smaller team")
	}
	if NewRules(Team, 99).Slots() != 12 || NewRules(FFA, 1).Slots() != 2 {
		t.Fatal("size clamp wrong")
	}
}

// Controller ruling (final review): a teammate ram scores nothing for the
// rammer and costs the victim nothing beyond the death (no griefing by ram).
func TestTeammateKillScoresNothing(t *testing.T) {
	r := NewRules(Team, 2)
	b := NewScoreboard()
	teamOf := func(sim.ID) sim.Team { return sim.TeamNATO }
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 2, Other: 1, Weapon: sim.WRam}, teamOf)
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 1, Other: 2, Weapon: sim.WRam}, teamOf)
	for _, l := range b.Lines() {
		if l.Kills != 0 || l.Score != 0 || l.Deaths != 1 {
			t.Fatalf("teammate kill must only count the death: %+v", l)
		}
	}
	if b.TeamScore(sim.TeamNATO) != 0 {
		t.Fatalf("team score %d", b.TeamScore(sim.TeamNATO))
	}
	if over, _ := r.Over(b); over {
		t.Fatal("not over")
	}
}

func TestFFAWinAndTeamFor(t *testing.T) {
	r := NewRules(FFA, 6)
	if r.TeamFor(map[sim.Team]int{}) != sim.TeamNone || r.FriendlyFire() || r.KillLimit() != 15 || r.Slots() != 6 {
		t.Fatal("ffa rules wrong")
	}
	b := NewScoreboard()
	none := func(sim.ID) sim.Team { return sim.TeamNone }
	for range 14 {
		b.Apply(sim.Event{Kind: sim.EvKill, Plane: 4, Other: 7}, none)
	}
	if over, _ := r.Over(b); over {
		t.Fatal("14 kills must not end the round")
	}
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 4, Other: 7}, none)
	if over, w := r.Over(b); !over || w != "7" {
		t.Fatalf("over=%v winner=%q", over, w)
	}
	if b.TeamScore(sim.TeamNone) != 0 {
		t.Fatal("ffa kills must not score a team")
	}
}

func TestBoardAddRemoveReset(t *testing.T) {
	b := NewScoreboard()
	b.Add(5)
	b.Add(2)
	b.Add(5)
	if ls := b.Lines(); len(ls) != 2 || ls[0].ID != 2 || ls[1] != (Line{ID: 5}) {
		t.Fatalf("zero rows %+v", ls)
	}
	teamOf := func(id sim.ID) sim.Team { return sim.Team(id%2 + 1) }
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 2, Other: 5}, teamOf)
	b.Apply(sim.Event{Kind: sim.EvHit, Plane: 5, Other: 2}, teamOf)
	if ls := b.Lines(); ls[0].ID != 5 || ls[0].Kills != 1 || ls[1].Deaths != 1 {
		t.Fatalf("after kill %+v", ls)
	}
	b.Remove(5)
	if ls := b.Lines(); len(ls) != 1 || ls[0].ID != 2 {
		t.Fatalf("after remove %+v", ls)
	}
	b.Reset()
	if ls := b.Lines(); len(ls) != 1 || ls[0] != (Line{ID: 2}) || b.TeamScore(sim.TeamSoviet) != 0 {
		t.Fatalf("reset must keep zeroed rows: %+v", ls)
	}
}

func TestParseKindAndString(t *testing.T) {
	for _, k := range []Kind{Team, FFA} {
		if got, ok := ParseKind(k.String()); !ok || got != k {
			t.Fatalf("round trip %v", k)
		}
	}
	if _, ok := ParseKind("tdm"); ok {
		t.Fatal("unknown kind accepted")
	}
	r := NewRules(Team, 0)
	if r.Slots() != 2 || r.FriendlyFire() || r.KillLimit() != 25 || r.DurationTicks() != 8*60*60 || r.Kind() != Team {
		t.Fatal("team rules wrong")
	}
	if NewRules(FFA, 99).Slots() != 12 {
		t.Fatal("ffa clamp")
	}
}
