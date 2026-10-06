package mode

import (
	"testing"

	"playground/internal/sim"
)

func TestBaseRules(t *testing.T) {
	r := NewRules(Base, 3)
	if r.Kind() != Base || r.Slots() != 6 || r.KillLimit() != 0 || r.DurationTicks() != 10*60*60 || r.FriendlyFire() {
		t.Fatal("base rules")
	}
	if k, ok := ParseKind("base"); !ok || k != Base || Base.String() != "base" {
		t.Fatal("parse")
	}
	b := NewScoreboard()
	b.SetObjective(1950, 1950)
	teamOf := func(id sim.ID) sim.Team { return map[sim.ID]sim.Team{1: sim.TeamNATO, 2: sim.TeamSoviet}[id] }
	b.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, 2), Other: 1, Value: 250}, teamOf)
	b.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(1, 2), Other: 1}, teamOf)
	if b.ObjectiveHP(sim.TeamSoviet) != 1700 || b.Lines()[0].Score != 2 || b.Lines()[0].Kills != 0 {
		t.Fatalf("objective %v lines %+v", b.ObjectiveHP(sim.TeamSoviet), b.Lines())
	}
	if over, _ := r.Over(b); over {
		t.Fatal("not over")
	}
	b.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(1, 0), Other: 1, Value: 5000}, teamOf)
	if over, w := r.Over(b); !over || w != "NATO" {
		t.Fatalf("over=%v winner=%q", over, w)
	}
	b.Reset()
	if b.ObjectiveHP(sim.TeamSoviet) != 1950 {
		t.Fatal("reset restores the objective")
	}
}

func TestAAKillCostsNoPoint(t *testing.T) {
	b := NewScoreboard()
	b.Apply(sim.Event{Kind: sim.EvKill, Plane: 3, Weapon: sim.WAA}, func(sim.ID) sim.Team { return sim.TeamNATO })
	if l := b.Lines()[0]; l.Deaths != 1 || l.Score != 0 {
		t.Fatalf("%+v", l)
	}
}

// hitAll destroys side's six targets (HP as in the base layout) in
// interleaved, non-dyadic chunks the way sim.damageStruct reports them: each
// hit takes min(dmg, HP left), the last one emits EvStructDown.
func hitAll(b *Scoreboard, side int, dmgs []float64) {
	hp := []float64{400, 400, 250, 250, 300, 350}
	teamOf := func(sim.ID) sim.Team { return sim.TeamNATO }
	for k := 0; ; k++ {
		left := false
		for i := range hp {
			if hp[i] <= 0 {
				continue
			}
			left = true
			taken := min(dmgs[(k+i)%len(dmgs)], hp[i])
			hp[i] -= taken
			b.Apply(sim.Event{Kind: sim.EvStructHit, Plane: sim.StructID(side, i), Other: 1, Value: taken}, teamOf)
			if hp[i] == 0 {
				b.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(side, i), Other: 1}, teamOf)
			}
		}
		if !left {
			return
		}
	}
}

// Review I1: the event-accumulated objective can keep a float residual with
// every target down; the round still ends on the last EvStructDown.
func TestAllTargetsDownEndsRound(t *testing.T) {
	r := NewRules(Base, 3)
	dmgs := []float64{1.5, 237.13377, 0.1, 99.999, 1.5, 211.7, 1.5, 3.3333333}
	for rot := range 50 {
		b := NewScoreboard()
		b.SetObjective(1950, 1950)
		b.SetTargets(6, 6)
		hitAll(b, 1, append(dmgs[rot%len(dmgs):], dmgs[:rot%len(dmgs)]...))
		if over, w := r.Over(b); !over || w != "NATO" || b.ObjectiveHP(sim.TeamSoviet) != 0 {
			t.Fatalf("rotation %d: over=%v winner=%q objective %v", rot, over, w, b.ObjectiveHP(sim.TeamSoviet))
		}
	}
}

// Review m1: both sides' last targets down together is a draw.
func TestBothBasesDownIsDraw(t *testing.T) {
	b := NewScoreboard()
	b.SetObjective(1950, 1950)
	b.SetTargets(6, 6)
	hitAll(b, 0, []float64{260})
	hitAll(b, 1, []float64{260})
	if over, w := NewRules(Base, 2).Over(b); !over || w != Draw {
		t.Fatalf("over=%v winner=%q", over, w)
	}
	b.Reset()
	if over, _ := NewRules(Base, 2).Over(b); over || b.ObjectiveHP(sim.TeamNATO) != 1950 {
		t.Fatal("reset restores the targets")
	}
}
