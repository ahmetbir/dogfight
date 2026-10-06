package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

// matchStats runs a 2v2 normal-bot team match for minutes and counts kills
// (by a plane) and crashes (no killer), and which planes were more than
// 100 m above the ground within the first minute.
func matchStats(k maps.Kind, start sim.StartMode, seed int64, minutes int) (kills, crashes, flew int) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: seed, Map: k, Start: start})
	up := map[sim.ID]bool{}
	for tick := range 60 * 60 * minutes {
		for _, e := range g.Step(nil) {
			if e.Kind == sim.EvKill {
				if e.Other == 0 {
					crashes++
				} else {
					kills++
				}
			}
		}
		if tick < 60*60 {
			for _, p := range g.Snapshot().Planes {
				if p.Alive && !p.Ground && p.Pos.Y-g.Terrain().Ground(p.Pos.X, p.Pos.Z) > 100 {
					up[p.ID] = true
				}
			}
		}
	}
	return kills, crashes, len(up)
}

// Fix-round ruling: on dag's ridges bots crash less than 0.1 times per bot
// per minute, from the air and from the runway (3 seeds, 2v2, 3 min each).
func TestBotsSurviveDag(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	const bots, minutes, seeds = 4, 3, 3
	for _, start := range []sim.StartMode{sim.StartAir, sim.StartRunway} {
		kills, crashes := 0, 0
		for seed := int64(1); seed <= seeds; seed++ {
			k, c, _ := matchStats(maps.Dag, start, seed, minutes)
			kills, crashes = kills+k, crashes+c
		}
		rate := float64(crashes) / bots / minutes / seeds
		t.Logf("dag start %d: kills %d crashes %d (%.3f per bot per minute)", start, kills, crashes, rate)
		if rate >= 0.1 {
			t.Errorf("dag start %d: %.3f crashes per bot per minute", start, rate)
		}
	}
}
