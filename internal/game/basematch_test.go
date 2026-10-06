package game

import (
	"math"
	"testing"

	"playground/internal/bot"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

// Spec §14 (preflight M1): a base attack 3v3 of normal bots runs its full
// 10 minutes headless and at least one target falls.
func TestBaseAttackMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	for _, start := range []sim.StartMode{sim.StartAir, sim.StartRunway} {
		g := New(Settings{Mode: mode.Base, Size: 3, Difficulty: bot.Normal, Seed: 1, Map: maps.Ada, Start: start})
		downs, hits, drops, kills, crashes, aa, aaHits := 0, 0, 0, 0, 0, 0, 0
		ticks := 0
		for range 10 * 60 * 60 {
			ticks++
			for _, e := range g.Step(nil) {
				switch {
				case e.Kind == sim.EvStructDown:
					downs++
				case e.Kind == sim.EvStructHit && e.Weapon == sim.WBomb:
					hits++
				case e.Kind == sim.EvBombDrop:
					drops++
				case e.Kind == sim.EvHit && e.Weapon == sim.WAA:
					aaHits++
				case e.Kind == sim.EvKill && e.Weapon == sim.WAA:
					aa++
				case e.Kind == sim.EvKill && e.Other == 0:
					crashes++
				case e.Kind == sim.EvKill:
					kills++
				}
			}
			if g.Round().Phase == Ended {
				break
			}
		}
		r := g.Round()
		t.Logf("start %v: %.1f min: drops %d bomb hits %d targets down %d kills %d AA hits %d AA kills %d crashes %d; objective NATO %.0f Soviet %.0f winner %q",
			start, float64(ticks)/3600, drops, hits, downs, kills, aaHits, aa, crashes, r.ObjNATO, r.ObjSoviet, r.Winner)
		left := [3]float64{}
		for _, st := range g.Snapshot().Structures {
			left[st.Side+1] += st.HP
		}
		if math.Abs(r.ObjNATO-left[sim.TeamNATO]) > 1e-6 || math.Abs(r.ObjSoviet-left[sim.TeamSoviet]) > 1e-6 {
			t.Errorf("start %v: objective %.1f/%.1f, targets' HP %.1f/%.1f", start, r.ObjNATO, r.ObjSoviet, left[sim.TeamNATO], left[sim.TeamSoviet])
		}
		if downs == 0 {
			t.Errorf("start %v: no target destroyed in 10 minutes", start)
		}
	}
}
