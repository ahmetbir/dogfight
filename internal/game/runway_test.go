package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestRunwayStartParksEveryone(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: 1, Map: maps.Ada, Start: sim.StartRunway})
	for _, p := range g.Snapshot().Planes {
		if !p.Ground {
			t.Fatalf("plane %d not parked", p.ID)
		}
	}
	if g.Settings().Start != sim.StartRunway {
		t.Fatal("start type not kept")
	}
	if New(Settings{Mode: mode.Team, Size: 2, Seed: 1}).Settings().Start != sim.StartAir {
		t.Fatal("zero start must mean air")
	}
}

// Spec §14 (M2) as a 3-seed aggregate (fix-round rulings): 2v2 normal bots
// from the runway on the city map, 4 minutes each (a runway death costs
// ~75 s of hangar, taxi and climb): all airborne within 60 s, mean kills
// >= 5, crashes < 0.5 per bot per minute.
func TestBotsRunwayMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	const bots, minutes, seeds = 4, 4, 3
	kills, crashes := 0, 0
	for seed := int64(1); seed <= seeds; seed++ {
		k, c, flew := matchStats(maps.Sehir, sim.StartRunway, seed, minutes)
		t.Logf("seed %d: airborne within 60 s %d/%d, kills %d, crashes %d", seed, flew, bots, k, c)
		if flew != bots {
			t.Errorf("seed %d: airborne within 60 s: %d/%d", seed, flew, bots)
		}
		kills, crashes = kills+k, crashes+c
	}
	mean, rate := float64(kills)/seeds, float64(crashes)/bots/minutes/seeds
	t.Logf("mean kills %.2f, crashes %.3f per bot per minute", mean, rate)
	if mean < 5 || rate >= 0.5 {
		t.Fatalf("mean kills %.2f crashes %.3f per bot per minute", mean, rate)
	}
}
