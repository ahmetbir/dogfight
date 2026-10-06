package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

func TestHumanReplacesBot(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: 1})
	if len(g.Players()) != 4 {
		t.Fatalf("want 4 seats filled, got %d", len(g.Players()))
	}
	id, err := g.AddHuman("maverick")
	if err != nil || len(g.Players()) != 4 || g.Humans() != 1 {
		t.Fatalf("id=%v err=%v players=%d", id, err, len(g.Players()))
	}
	g.RemoveHuman(id)
	if len(g.Players()) != 4 || g.Humans() != 0 {
		t.Fatal("bot must refill the seat")
	}
}

func TestPickRespectsTeam(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 1})
	id, _ := g.AddHuman("a")
	var team sim.Team
	for _, p := range g.Players() {
		if p.ID == id {
			team = p.Team
		}
	}
	wrong := sim.Su27
	if team == sim.TeamSoviet {
		wrong = sim.F16
	}
	if g.Pick(id, wrong) == nil {
		t.Fatal("enemy aircraft must be rejected in team mode")
	}
}

func player(t *testing.T, g *Game, id sim.ID) Player {
	t.Helper()
	for _, p := range g.Players() {
		if p.ID == id {
			return p
		}
	}
	t.Fatalf("player %d not found", id)
	return Player{}
}

func TestHumansBalanceTeamsAndFill(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Normal, Seed: 2})
	a, _ := g.AddHuman("")
	b, _ := g.AddHuman("abcdefghijklmnopqrstuvwxyz")
	pa, pb := player(t, g, a), player(t, g, b)
	if pa.Team == pb.Team {
		t.Fatalf("second human must join the other team: %v %v", pa.Team, pb.Team)
	}
	if pa.Name != "Pilot" || pb.Name != "abcdefghijklmnop" || pa.Bot || pb.Bot {
		t.Fatalf("names %q %q", pa.Name, pb.Name)
	}
	if pa.Kind != sim.F16 && pa.Kind != sim.MiG29 {
		t.Fatalf("default kind %v", pa.Kind)
	}
	if _, err := g.AddHuman("c"); err != ErrFull {
		t.Fatalf("want ErrFull, got %v", err)
	}
	if g.Humans() != 2 || len(g.Players()) != 2 {
		t.Fatal("room must hold exactly two humans")
	}
}

func TestBotsAreNamedAndCycleKinds(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 5, Difficulty: bot.Easy, Seed: 3})
	ps := g.Players()
	kinds := map[sim.Kind]int{}
	for i, p := range ps {
		if !p.Bot || p.Team != sim.TeamNone || p.Name != botNames[i] {
			t.Fatalf("bot %d: %+v", i, p)
		}
		kinds[p.Kind]++
	}
	if len(kinds) != 4 {
		t.Fatalf("ffa bots must cycle all kinds: %v", kinds)
	}
	tg := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 3})
	for _, p := range tg.Players() {
		if sim.SpecOf(p.Kind).Team != p.Team {
			t.Fatalf("team bot flies enemy aircraft: %+v", p)
		}
	}
}

func TestPickDuringSpawnProtectionRespawnsNow(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 4})
	id, _ := g.AddHuman("x")
	g.Step(nil)
	if err := g.Pick(id, sim.Su27); err != nil {
		t.Fatal(err)
	}
	if p, ok := findPlane(g.Snapshot().Planes, id); !ok || p.Kind != sim.Su27 {
		t.Fatalf("plane must respawn with the picked kind at once: %+v", p)
	}
	if player(t, g, id).Kind != sim.Su27 {
		t.Fatal("roster kind not updated")
	}
	v := g.RosterVersion()
	for range 200 {
		g.Step(map[sim.ID]sim.Input{id: {Throttle: 1}})
	}
	if err := g.Pick(id, sim.F15); err != nil || g.RosterVersion() == v {
		t.Fatalf("pick: %v ver %d", err, g.RosterVersion())
	}
	if p, _ := findPlane(g.Snapshot().Planes, id); p.Kind != sim.Su27 || p.NextKind != sim.F15 {
		t.Fatalf("after protection the pick waits for respawn: %+v", p.Kind)
	}
	if g.Pick(id, sim.Kind(99)) != ErrBadKind || g.Pick(999, sim.F16) == nil {
		t.Fatal("unknown kind or player must be rejected")
	}
}

func TestBoardListsEveryPlayer(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 3, Difficulty: bot.Normal, Seed: 5})
	id, _ := g.AddHuman("y")
	r := g.Round()
	if len(r.Board) != 6 || r.Phase != Playing || r.TicksLeft != 8*60*60 {
		t.Fatalf("round %+v", r)
	}
	found := false
	for _, l := range r.Board {
		found = found || l.ID == id
	}
	if !found {
		t.Fatal("human missing from board")
	}
}

func TestRoundEndsAndRestarts(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Normal, Seed: 6})
	ids := []sim.ID{g.Players()[0].ID, g.Players()[1].ID}
	for range 15 {
		g.board.Apply(sim.Event{Kind: sim.EvKill, Plane: ids[1], Other: ids[0]}, g.teamOf)
	}
	g.Step(nil)
	r := g.Round()
	if r.Phase != Ended || r.Winner != g.Players()[0].Name || r.TicksLeft != EndedTicks {
		t.Fatalf("round %+v", r)
	}
	tick := g.Snapshot().Tick
	for range EndedTicks - 1 {
		if len(g.Step(nil)) != 0 {
			t.Fatal("no events while ended")
		}
	}
	if g.Snapshot().Tick != tick {
		t.Fatal("world must not advance while ended")
	}
	evs := g.Step(nil)
	r = g.Round()
	if r.Phase != Playing || r.Winner != "" || r.Board[0].Kills != 0 {
		t.Fatalf("new round %+v", r)
	}
	spawns := 0
	for _, e := range evs {
		if e.Kind == sim.EvSpawn {
			spawns++
		}
	}
	if spawns != 2 {
		t.Fatalf("all planes respawn at round start, got %d", spawns)
	}
}

func TestTimeUpEndsRound(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 7})
	g.roundEnd = g.tick + 1
	g.Step(nil)
	if r := g.Round(); r.Phase != Ended || r.Winner != drawWinner { // no kills after one tick
		t.Fatalf("round %+v", r)
	}
}

// Headless 4v4 normal bots, 3 minutes, 10 seeds: spec §9 quality bar.
func TestBotsPlayARealMatch(t *testing.T) {
	if testing.Short() {
		t.Skip("long")
	}
	for seed := range int64(10) {
		g := New(Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Normal, Seed: seed})
		kills, crashes := 0, 0
		for range 60 * 180 {
			for _, e := range g.Step(nil) {
				if e.Kind == sim.EvKill {
					if e.Other == 0 {
						crashes++
					} else {
						kills++
					}
				}
			}
		}
		t.Logf("seed %d: %d kills, %d crashes", seed, kills, crashes)
		// Flare ruling (2026-10-06): burning flares plus a flare a second from
		// bots cut missile hits ~47% -> ~28%; 10 seeds averaged 25 kills
		// before, 16 after (12-24). The floor still catches bots that do not fight.
		if kills < 10 {
			t.Errorf("seed %d: only %d kills in 3 min", seed, kills)
		}
		if per := float64(crashes) / 8 / 3; per >= 0.5 {
			t.Errorf("seed %d: %.2f crashes per bot per minute", seed, per)
		}
	}
}

func findPlane(ps []sim.Plane, id sim.ID) (sim.Plane, bool) {
	for _, p := range ps {
		if p.ID == id {
			return p, true
		}
	}
	return sim.Plane{}, false
}

// Regression (G4 review, Important 1): repeated picks during spawn protection
// must not extend protection or teleport the plane more than once per life.
func TestRepeatedPickNeverExtendsProtection(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 8})
	id := spawnHuman(t, g, "x", sim.F16)
	g.Step(nil)
	p0, _ := findPlane(g.Snapshot().Planes, id)
	kinds := []sim.Kind{sim.Su27, sim.F15, sim.MiG29, sim.F16}
	var first sim.Plane
	for i := range 10 {
		if err := g.Pick(id, kinds[i%len(kinds)]); err != nil {
			t.Fatal(err)
		}
		p, _ := findPlane(g.Snapshot().Planes, id)
		if p.ProtectUntil != p0.ProtectUntil {
			t.Fatalf("pick %d: protection %d -> %d", i, p0.ProtectUntil, p.ProtectUntil)
		}
		if i == 0 {
			first = p
			if p.Pos == p0.Pos || p.Kind != sim.Su27 {
				t.Fatalf("first pick must respawn once with the new kind: %+v", p)
			}
		} else if p.Pos != first.Pos {
			t.Fatalf("pick %d moved the plane again", i)
		}
	}
	spawns := 0
	for range 3 {
		for _, e := range g.Step(nil) {
			if e.Kind == sim.EvSpawn && e.Plane == id {
				spawns++
			}
		}
		p, _ := findPlane(g.Snapshot().Planes, id)
		if p.ProtectUntil != p0.ProtectUntil {
			t.Fatalf("protection extended to %d", p.ProtectUntil)
		}
	}
	if spawns != 1 {
		t.Fatalf("want exactly one respawn, got %d", spawns)
	}
}

func TestPickAfterInstantSwapOnlySetsNextKind(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 2, Difficulty: bot.Easy, Seed: 9})
	id := spawnHuman(t, g, "x", sim.F16)
	g.Step(nil)
	if err := g.Pick(id, sim.Su27); err != nil {
		t.Fatal(err)
	}
	for _, k := range []sim.Kind{sim.F15, sim.MiG29} {
		if err := g.Pick(id, k); err != nil {
			t.Fatal(err)
		}
		p, _ := findPlane(g.Snapshot().Planes, id)
		if p.Kind != sim.Su27 || p.NextKind != k || player(t, g, id).Kind != k {
			t.Fatalf("later pick must only set NextKind: kind %v next %v", p.Kind, p.NextKind)
		}
	}
}

// spawnHuman joins a human and spawns it with kind (its first pick).
func spawnHuman(t *testing.T, g *Game, name string, kind sim.Kind) sim.ID {
	t.Helper()
	id, err := g.AddHuman(name)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Pick(id, kind); err != nil {
		t.Fatal(err)
	}
	return id
}

// A joining human has no plane until its first pick, but is already in the
// roster and on the scoreboard, and its bot left at join.
func TestNoPlaneBeforeFirstPick(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 11})
	id, err := g.AddHuman("a")
	if err != nil {
		t.Fatal(err)
	}
	for range 60 {
		g.Step(map[sim.ID]sim.Input{id: {Throttle: 1, Fire: true}})
	}
	if _, ok := findPlane(g.Snapshot().Planes, id); ok {
		t.Fatal("plane before first pick")
	}
	if !g.Waiting(id) || len(g.Players()) != 4 || len(g.Snapshot().Planes) != 3 {
		t.Fatalf("waiting=%v players=%d planes=%d", g.Waiting(id), len(g.Players()), len(g.Snapshot().Planes))
	}
	if _, ok := lineOf(g.Round().Board, id); !ok {
		t.Fatal("waiting human missing from the board")
	}
}

func TestFirstPickSpawnsChosenKind(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 12})
	id, _ := g.AddHuman("a")
	g.Step(nil)
	team := player(t, g, id).Team
	kind := teamKinds(team)[1] // not the default
	if err := g.Pick(id, kind); err != nil {
		t.Fatal(err)
	}
	spawned := false
	for _, e := range g.Step(nil) {
		spawned = spawned || (e.Kind == sim.EvSpawn && e.Plane == id)
	}
	p, ok := findPlane(g.Snapshot().Planes, id)
	if !ok || !p.Alive || p.Kind != kind || !spawned || g.Waiting(id) {
		t.Fatalf("after pick: ok=%v alive=%v kind=%v spawned=%v waiting=%v", ok, p.Alive, p.Kind, spawned, g.Waiting(id))
	}
}

func TestPickTimeoutSpawnsDefaultKind(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 13})
	id, _ := g.AddHuman("a")
	for range PickTimeoutTicks - 1 {
		g.Step(nil)
	}
	if _, ok := findPlane(g.Snapshot().Planes, id); ok {
		t.Fatal("spawned before the timeout")
	}
	g.Step(nil)
	p, ok := findPlane(g.Snapshot().Planes, id)
	want := teamKinds(player(t, g, id).Team)[0]
	if !ok || !p.Alive || p.Kind != want || g.Waiting(id) {
		t.Fatalf("after timeout: ok=%v alive=%v kind=%v want %v", ok, p.Alive, p.Kind, want)
	}
}

func lineOf(ls []mode.Line, id sim.ID) (mode.Line, bool) {
	for _, l := range ls {
		if l.ID == id {
			return l, true
		}
	}
	return mode.Line{}, false
}
