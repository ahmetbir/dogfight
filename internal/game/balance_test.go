package game

import (
	"flag"
	"testing"

	"playground/internal/bot"
	"playground/internal/sim"
	"playground/internal/terrain"
)

var strictBalance = flag.Bool("balance", false, "fail when a matchup is outside 40-60%")

const (
	balanceSeeds    = 200
	balanceMaxTicks = 90 * 60
)

// duel flies a 1v1 Hard-bot FFA duel, both on the Karışık loadout (missile
// options ruling), until the first kill and returns the winning kind (0 on
// timeout). A crash or bounds death loses the duel. Plane
// IDs alternate with the seed so processing order favors neither kind.
func duel(a, b sim.Kind, seed int64) sim.Kind {
	ida, idb := sim.ID(1), sim.ID(2)
	if seed%2 == 1 {
		ida, idb = 2, 1
	}
	t := terrain.Generate(seed)
	w := sim.NewWorld(sim.Config{Seed: seed, Terrain: t})
	w.AddPlaneLoadout(ida, sim.TeamNone, a, sim.LoadMixed)
	w.AddPlaneLoadout(idb, sim.TeamNone, b, sim.LoadMixed)
	brains := map[sim.ID]*bot.Brain{ida: bot.New(ida, bot.Hard, seed*31+1), idb: bot.New(idb, bot.Hard, seed*31+2)}
	inputs := map[sim.ID]sim.Input{}
	for range balanceMaxTicks {
		snap := w.Snapshot()
		for id, br := range brains {
			inputs[id] = br.Think(&snap, &bot.Env{Terrain: t})
		}
		for _, e := range w.Step(inputs) {
			if e.Kind != sim.EvKill {
				continue
			}
			if e.Plane == ida {
				return b
			}
			return a
		}
	}
	return 0
}

// TestBalance: spec §3.1/§14, every aircraft pair 1v1, 200 duels, win rate 38-62%.
func TestBalance(t *testing.T) {
	if !*strictBalance {
		t.Skip("needs -balance")
	}
	ks := sim.Kinds()
	for i, a := range ks {
		for _, b := range ks[i+1:] {
			wa, wb := 0, 0
			for seed := range int64(balanceSeeds) {
				switch duel(a, b, seed) {
				case a:
					wa++
				case b:
					wb++
				}
			}
			rate := float64(wa) / float64(max(1, wa+wb))
			t.Logf("%-6v vs %-6v  %3d-%3d  timeouts %3d  win %.2f", a, b, wa, wb, balanceSeeds-wa-wb, rate)
			// Controller ruling (v2 Task 3): band widened from 40-60% to
			// 38-62%. Only ~60-70 duels per pair are decided (the rest time
			// out), so the standard error is about 6 points.
			if rate < 0.38 || rate > 0.62 {
				t.Errorf("%v vs %v outside 38-62%%: %.2f", a, b, rate)
			}
		}
	}
}
