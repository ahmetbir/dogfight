package game

import (
	"flag"
	"fmt"
	"runtime"
	"strings"
	"sync"
	"testing"

	"playground/internal/bot"
	"playground/internal/sim"
	"playground/internal/terrain"
)

var strictBalance = flag.Bool("balance", false, "full bot round-robin; fail when a kind's win rate is outside ±15% of the mean")

const (
	balanceSeeds      = 200 // duels per pair with -balance
	balanceShortSeeds = 2   // duels per pair otherwise: the harness runs, nothing is judged
	balanceMaxTicks   = 90 * 60
	balanceBand       = 0.15 // relative to the mean win rate
)

// duel flies a 1v1 Hard-bot FFA duel, both on the Karışık loadout (missile
// options ruling), until the first kill and returns the winning kind (0 on
// timeout). A crash or bounds death loses the duel. Plane
// IDs alternate with the seed so processing order favors neither kind. The
// sim's per-kind hit, ram and wall spheres (sim.Spec sizes) apply as in a game.
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

// roundRobin is a bot round-robin over every pair of kinds, both sides
// against each other and within a side.
type roundRobin struct {
	kinds []sim.Kind
	wins  [][]int // wins[i][j]: kind i beat kind j
	games [][]int // duels between i and j (timeouts included)
}

// playRoundRobin flies seeds duels per pair, spread over the CPUs. Each duel
// is its own world, so the result does not depend on the scheduling.
func playRoundRobin(kinds []sim.Kind, seeds int) *roundRobin {
	n := len(kinds)
	rr := &roundRobin{kinds: kinds, wins: make([][]int, n), games: make([][]int, n)}
	for i := range n {
		rr.wins[i], rr.games[i] = make([]int, n), make([]int, n)
	}
	type job struct{ i, j int }
	jobs := make(chan job)
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range runtime.GOMAXPROCS(0) {
		wg.Add(1)
		go func() {
			defer wg.Done()
			for jb := range jobs {
				wi, wj := 0, 0
				for seed := range int64(seeds) {
					switch duel(kinds[jb.i], kinds[jb.j], seed) {
					case kinds[jb.i]:
						wi++
					case kinds[jb.j]:
						wj++
					}
				}
				mu.Lock()
				rr.wins[jb.i][jb.j], rr.wins[jb.j][jb.i] = wi, wj
				rr.games[jb.i][jb.j], rr.games[jb.j][jb.i] = seeds, seeds
				mu.Unlock()
			}
		}()
	}
	for i := range n {
		for j := i + 1; j < n; j++ {
			jobs <- job{i, j}
		}
	}
	close(jobs)
	wg.Wait()
	return rr
}

// rate is kind i's share of the decided duels against j (0.5 when none was).
func (rr *roundRobin) rate(i, j int) float64 {
	d := rr.wins[i][j] + rr.wins[j][i]
	if d == 0 {
		return 0.5
	}
	return float64(rr.wins[i][j]) / float64(d)
}

// overall is kind i's share of all its decided duels.
func (rr *roundRobin) overall(i int) float64 {
	won, decided := 0, 0
	for j := range rr.kinds {
		won += rr.wins[i][j]
		decided += rr.wins[i][j] + rr.wins[j][i]
	}
	if decided == 0 {
		return 0.5
	}
	return float64(won) / float64(decided)
}

func (rr *roundRobin) mean() float64 {
	s := 0.0
	for i := range rr.kinds {
		s += rr.overall(i)
	}
	return s / float64(len(rr.kinds))
}

// matrix prints the win-rate matrix (row beats column, in %), then each
// kind's overall win rate and timeouts.
func (rr *roundRobin) matrix() string {
	var b strings.Builder
	fmt.Fprintf(&b, "%-8s", "")
	for _, k := range rr.kinds {
		fmt.Fprintf(&b, "%8s", k)
	}
	fmt.Fprintf(&b, "%8s %5s\n", "all", "t/o")
	for i, k := range rr.kinds {
		fmt.Fprintf(&b, "%-8s", k)
		timeouts := 0
		for j := range rr.kinds {
			if i == j {
				fmt.Fprintf(&b, "%8s", "-")
				continue
			}
			fmt.Fprintf(&b, "%8.0f", 100*rr.rate(i, j))
			timeouts += rr.games[i][j] - rr.wins[i][j] - rr.wins[j][i]
		}
		fmt.Fprintf(&b, "%8.1f %5d\n", 100*rr.overall(i), timeouts)
	}
	fmt.Fprintf(&b, "mean %.1f%%, band ±%.0f%% of it\n", 100*rr.mean(), 100*balanceBand)
	return b.String()
}

// outliers lists the kinds whose overall win rate is outside the band.
func (rr *roundRobin) outliers() []string {
	m := rr.mean()
	var out []string
	for i, k := range rr.kinds {
		if r := rr.overall(i); r < m*(1-balanceBand) || r > m*(1+balanceBand) {
			out = append(out, fmt.Sprintf("%v %.3f", k, r))
		}
	}
	return out
}

// TestBalance: a Hard-bot round-robin over every pair of kinds (spec Phase 4):
// every kind's win rate within ±15% of the mean. Without -balance it flies a
// small sample, so the harness itself stays tested, and judges nothing.
func TestBalance(t *testing.T) {
	seeds := balanceShortSeeds
	if *strictBalance {
		seeds = balanceSeeds
	} else if testing.Short() {
		t.Skip("round-robin sample: not in -short")
	}
	rr := playRoundRobin(sim.Kinds(), seeds)
	t.Logf("%d duels per pair, win %% of the decided ones (row beats column):\n%s", seeds, rr.matrix())
	for i := range rr.kinds {
		for j := range rr.kinds {
			if i != j && rr.games[i][j] != seeds {
				t.Fatalf("%v vs %v: %d duels, want %d", rr.kinds[i], rr.kinds[j], rr.games[i][j], seeds)
			}
		}
	}
	if !*strictBalance {
		return
	}
	if out := rr.outliers(); len(out) > 0 {
		t.Errorf("outside ±%.0f%% of the mean %.3f: %v", 100*balanceBand, rr.mean(), out)
	}
}
