package game

import (
	"testing"

	"playground/internal/bot"
	"playground/internal/mode"
	"playground/internal/sim"
)

func other(t sim.Team) sim.Team {
	if t == sim.TeamNATO {
		return sim.TeamSoviet
	}
	return sim.TeamNATO
}

// flying seats a human and gives it a plane (its first pick).
func flying(t *testing.T, g *Game, name string) sim.ID {
	t.Helper()
	id, err := g.AddHuman(name)
	if err != nil {
		t.Fatal(err)
	}
	if err := g.Pick(id, player(t, g, id).Kind); err != nil {
		t.Fatal(err)
	}
	return id
}

func teamCounts(g *Game) (humans, bots map[sim.Team]int) {
	humans, bots = map[sim.Team]int{}, map[sim.Team]int{}
	for _, p := range g.Players() {
		if p.Bot {
			bots[p.Team]++
		} else {
			humans[p.Team]++
		}
	}
	return humans, bots
}

// The pick-screen choice is free while balanced; a bot refills the seat left.
func TestChooseTeamOnPickScreen(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1})
	a, _ := g.AddHuman("a") // NATO by auto-balance
	if player(t, g, a).Team != sim.TeamNATO {
		t.Fatal("auto puts the first human on NATO")
	}
	if err := g.ChooseTeam(a, sim.TeamSoviet); err != nil {
		t.Fatal(err)
	}
	p := player(t, g, a)
	if p.Team != sim.TeamSoviet || (p.Kind != sim.MiG29 && p.Kind != sim.Su27) {
		t.Fatalf("after the choice: %+v", p)
	}
	humans, bots := teamCounts(g)
	if humans[sim.TeamSoviet] != 1 || bots[sim.TeamNATO] != 2 || bots[sim.TeamSoviet] != 1 || len(g.Players()) != 4 {
		t.Fatalf("seats: humans=%v bots=%v", humans, bots)
	}
	if !g.Waiting(a) {
		t.Fatal("a choice before the first pick keeps the human on the pick screen")
	}
	// No cooldown before the first plane: back to auto (NATO) at once.
	if err := g.ChooseTeam(a, sim.TeamNone); err != nil || player(t, g, a).Team != sim.TeamNATO {
		t.Fatalf("auto: %v %v", err, player(t, g, a).Team)
	}
}

// A choice leaving the human counts two apart is refused.
func TestChooseTeamBalanceRule(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 3, Difficulty: bot.Easy, Seed: 1})
	a, _ := g.AddHuman("a") // NATO
	b, _ := g.AddHuman("b") // Soviet
	c, _ := g.AddHuman("c") // NATO
	if err := g.ChooseTeam(b, sim.TeamNATO); err != ErrUneven {
		t.Fatalf("3-0 must be refused: %v", err)
	}
	if err := g.ChooseTeam(c, sim.TeamSoviet); err != nil {
		t.Fatalf("2-1 to 1-2 is fine: %v", err)
	}
	if err := g.ChooseTeam(a, sim.TeamSoviet); err != ErrUneven {
		t.Fatalf("0-3 must be refused: %v", err)
	}
	if _, err := g.AddHuman("d"); err != nil {
		t.Fatal(err)
	}
	humans, _ := teamCounts(g)
	if humans[sim.TeamNATO] != 2 || humans[sim.TeamSoviet] != 2 {
		t.Fatalf("auto-balance after choices: %v", humans)
	}
}

// A move that narrows an existing gap is allowed even if still >1 apart.
func TestChooseTeamNarrowsGap(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 4, Difficulty: bot.Easy, Seed: 1})
	var nato []sim.ID
	for _, n := range []string{"a", "b", "c", "d", "e", "f", "g", "h"} {
		if _, err := g.AddHuman(n); err != nil {
			t.Fatal(err)
		}
	}
	for _, p := range g.Players() {
		if p.Bot {
			continue
		}
		if p.Team == sim.TeamSoviet {
			g.RemoveHuman(p.ID) // the Soviet humans leave: 4-0
		} else {
			nato = append(nato, p.ID)
		}
	}
	humans, _ := teamCounts(g)
	if humans[sim.TeamNATO] != 4 || humans[sim.TeamSoviet] != 0 {
		t.Fatalf("setup: %v", humans)
	}
	if err := g.ChooseTeam(nato[0], sim.TeamSoviet); err != nil {
		t.Fatalf("4-0 to 3-1 narrows the gap: %v", err)
	}
}

// A mid-game switch removes the plane with no event and no score change,
// waits on the pick screen, then cools down for 30 s.
func TestSwitchNoScoreChangeAndCooldown(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 4})
	a := flying(t, g, "a")
	from := player(t, g, a).Team
	// a scores a kill on an enemy bot.
	var enemy sim.ID
	for _, p := range g.Players() {
		if p.Bot && p.Team != from {
			enemy = p.ID
		}
	}
	g.board.Apply(sim.Event{Kind: sim.EvKill, Plane: enemy, Other: a, Weapon: sim.WCannon}, g.teamOf)
	natoBefore, sovBefore := g.Round().NATO, g.Round().Soviet
	if _, ok := g.world.Plane(a); !ok {
		t.Fatal("a has a plane")
	}
	if err := g.ChooseTeam(a, other(from)); err != nil {
		t.Fatal(err)
	}
	if _, ok := g.world.Plane(a); ok || !g.Waiting(a) {
		t.Fatal("the switcher's plane leaves the world and the human waits for a pick")
	}
	rd := g.Round()
	if rd.NATO != natoBefore || rd.Soviet != sovBefore {
		t.Fatalf("team scores moved: %d-%d → %d-%d", natoBefore, sovBefore, rd.NATO, rd.Soviet)
	}
	for _, l := range rd.Board {
		if l.ID == a && (l.Kills != 1 || l.Deaths != 0 || l.Score != 1) {
			t.Fatalf("switcher's line changed: %+v", l)
		}
	}
	evs := g.Step(nil)
	for _, e := range evs {
		if e.Kind == sim.EvKill {
			t.Fatalf("switch produced a kill event: %+v", e)
		}
	}
	if err := g.ChooseTeam(a, from); err != ErrCooldown {
		t.Fatalf("inside the cooldown: %v", err)
	}
	if err := g.Pick(a, teamKinds(other(from))[1]); err != nil {
		t.Fatal(err)
	}
	pl, ok := g.world.Plane(a)
	if !ok || pl.Team != other(from) {
		t.Fatalf("respawn on the new team: %+v %v", pl, ok)
	}
	g.tick += SwitchCooldownTicks // 30 s later, still mid-round
	g.roundEnd = g.tick + 10*SwitchCloseTicks
	delete(g.hurtAt, a)
	if err := g.ChooseTeam(a, from); err != nil {
		t.Fatalf("after the cooldown: %v", err)
	}
}

// No switch in the round's last minute, in every team mode (no late jump to
// the winning team); the scoreboard break is not the last minute.
func TestSwitchBlockedLastMinute(t *testing.T) {
	for _, m := range []mode.Kind{mode.Team, mode.Base} {
		g := New(Settings{Mode: m, Size: 2, Difficulty: bot.Easy, Seed: 5})
		a := flying(t, g, "a")
		from := player(t, g, a).Team
		g.roundEnd = g.tick + SwitchCloseTicks - 1
		if err := g.ChooseTeam(a, other(from)); err != ErrLate {
			t.Fatalf("%v last minute: %v", m, err)
		}
		g.roundEnd = g.tick + SwitchCloseTicks
		if err := g.ChooseTeam(a, other(from)); err != nil {
			t.Fatalf("%v a minute left: %v", m, err)
		}
	}
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 5})
	a := flying(t, g, "a")
	g.finish("NATO") // scoreboard break: switching for the next round is fine
	if err := g.ChooseTeam(a, other(player(t, g, a).Team)); err != nil {
		t.Fatalf("ended: %v", err)
	}
}

func TestChooseTeamRefusals(t *testing.T) {
	g := New(Settings{Mode: mode.FFA, Size: 4, Difficulty: bot.Easy, Seed: 1})
	a, _ := g.AddHuman("a")
	if err := g.ChooseTeam(a, sim.TeamNATO); err != ErrNoTeams {
		t.Fatalf("ffa: %v", err)
	}
	t1 := New(Settings{Mode: mode.Team, Size: 1, Difficulty: bot.Easy, Seed: 1})
	x, _ := t1.AddHuman("x")
	y, _ := t1.AddHuman("y")
	_ = y
	if err := t1.ChooseTeam(x, other(player(t, t1, x).Team)); err != ErrUneven {
		t.Fatalf("1v1, 2-0 afterwards: %v", err)
	}
	// Equal seats per team make a full target team always fail the balance
	// first; the seat check still guards: drop the Soviet bots' seats.
	t2 := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1})
	s := flying(t, t2, "s") // NATO
	for _, p := range t2.Players() {
		if p.Bot && p.Team == sim.TeamSoviet {
			delete(t2.players, p.ID)
		}
	}
	if err := t2.ChooseTeam(s, sim.TeamSoviet); err != ErrTeamFull {
		t.Fatalf("no bot seat on the target team: %v", err)
	}
	if err := t1.ChooseTeam(999, sim.TeamNATO); err != ErrNoPlayer {
		t.Fatalf("unknown: %v", err)
	}
	if err := t1.ChooseTeam(x, player(t, t1, x).Team); err != nil {
		t.Fatalf("same team is a no-op: %v", err)
	}
}

// Leaving after a switch frees the seat for a bot on the new team.
func TestLeaveAfterSwitchRefillsNewTeam(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 1})
	a := flying(t, g, "a")
	to := other(player(t, g, a).Team)
	if err := g.ChooseTeam(a, to); err != nil {
		t.Fatal(err)
	}
	g.RemoveHuman(a)
	_, bots := teamCounts(g)
	if bots[sim.TeamNATO] != 2 || bots[sim.TeamSoviet] != 2 {
		t.Fatalf("bots after leave: %v", bots)
	}
}

// While its plane is alive, a pilot under a lock, targeted by a missile or
// hit in the last 10 s may not switch; its own missile in flight is removed
// with the plane and scores nothing.
func TestSwitchBlockedUnderFire(t *testing.T) {
	g := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 6})
	a := flying(t, g, "a")
	b := flying(t, g, "b")
	if player(t, g, a).Team == player(t, g, b).Team {
		t.Fatal("setup: a and b on opposite teams")
	}
	from := player(t, g, a).Team
	lock := func(on bool) {
		g.world.Edit(b, func(p *sim.Plane) {
			p.LockTarget, p.Locked = 0, false
			if on {
				p.LockTarget, p.Locked = a, true
			}
		})
	}
	lock(true)
	if err := g.ChooseTeam(a, other(from)); err != ErrLocked {
		t.Fatalf("locked: %v", err)
	}
	lock(false)
	g.hurtAt[a] = g.tick - HurtTicks + 1
	if err := g.ChooseTeam(a, other(from)); err != ErrHurt {
		t.Fatalf("hit 9.98 s ago: %v", err)
	}
	g.hurtAt[a] = g.tick - HurtTicks
	// b fires a missile at a: a missile in flight blocks too.
	pa, _ := g.world.Plane(a)
	g.world.Edit(b, func(p *sim.Plane) {
		p.Pos, p.Rot, p.Vel = pa.Pos.Sub(pa.Vel.Norm().Scale(600)), pa.Rot, pa.Vel
		p.LockTarget, p.Locked, p.LockTime = a, true, 10
		p.ProtectUntil = 0
	})
	g.Step(map[sim.ID]sim.Input{b: {Missile: true, Throttle: 1}})
	inFlight := false
	for _, m := range g.world.Snapshot().Missiles {
		inFlight = inFlight || m.Target == a
	}
	if !inFlight {
		t.Fatal("setup: b's missile at a did not launch")
	}
	lock(false)
	delete(g.hurtAt, a)
	if err := g.ChooseTeam(a, other(from)); err != ErrLocked {
		t.Fatalf("missile in flight at me: %v", err)
	}
	// A switcher's own missile in flight goes with its plane and scores nothing.
	g2 := New(Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Easy, Seed: 7})
	c := flying(t, g2, "c")
	pc, _ := g2.world.Plane(c)
	var e sim.ID
	for _, p := range g2.Players() {
		if p.Bot && p.Team != pc.Team {
			e = p.ID
		}
	}
	g2.world.Edit(e, func(p *sim.Plane) { p.Pos, p.Rot, p.Vel = pc.Pos.Add(pc.Vel.Norm().Scale(600)), pc.Rot, pc.Vel })
	g2.world.Edit(c, func(p *sim.Plane) { p.LockTarget, p.Locked, p.LockTime, p.ProtectUntil = e, true, 10, 0 })
	g2.Step(map[sim.ID]sim.Input{c: {Missile: true, Throttle: 1}})
	own := false
	for _, m := range g2.world.Snapshot().Missiles {
		own = own || m.Owner == c
	}
	if !own {
		t.Fatal("setup: c's missile did not launch")
	}
	delete(g2.hurtAt, c)
	if err := g2.ChooseTeam(c, other(pc.Team)); err != nil {
		t.Fatalf("c with its own missile out: %v", err)
	}
	for _, m := range g2.world.Snapshot().Missiles {
		if m.Owner == c {
			t.Fatalf("c's missile outlived the switch: %+v", m)
		}
	}
	for range 120 {
		for _, ev := range g2.Step(nil) {
			if ev.Kind == sim.EvKill && ev.Other == c {
				t.Fatalf("kill credited to a switched plane: %+v", ev)
			}
		}
	}
	// Dead: nothing to escape from, so no fire gate (a was never hit for real).
	g.world.Edit(a, func(p *sim.Plane) { p.Alive = false })
	g.hurtAt[a] = g.tick
	if err := g.switchGate(a, false); err != nil && err != ErrLate {
		t.Fatalf("dead pilot gated by fire: %v", err)
	}
}
