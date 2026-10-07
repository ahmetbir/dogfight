package game

import (
	"errors"

	"playground/internal/mode"
	"playground/internal/sim"
)

var (
	ErrNoTeams  = errors.New("game: mode has no teams")
	ErrUneven   = errors.New("game: teams would be uneven")
	ErrTeamFull = errors.New("game: team has no free seat")
	ErrCooldown = errors.New("game: team switch cooling down")
	ErrLate     = errors.New("game: too late in the round to switch")
	ErrLocked   = errors.New("game: locked or targeted by a missile")
	ErrHurt     = errors.New("game: damaged too recently to switch")
)

const (
	// SwitchCooldownTicks is the least time between two team switches of a player.
	SwitchCooldownTicks = 30 * 60
	// SwitchCloseTicks: no switch in the round's last minute (no late jump to the winner).
	SwitchCloseTicks = 60 * 60
	// HurtTicks: no switch this soon after taking damage (no escape from a fight).
	HurtTicks = 10 * 60
)

// HumanTeams counts the humans on each team.
func (g *Game) HumanTeams() (nato, soviet int) {
	for _, p := range g.players {
		if p.Bot {
			continue
		}
		switch p.Team {
		case sim.TeamNATO:
			nato++
		case sim.TeamSoviet:
			soviet++
		}
	}
	return nato, soviet
}

// ChooseTeam moves human id to team want (TeamNone: the team auto-balance
// picks). On the pick screen before its first plane the choice is free;
// later it is a switch: not in the round's last SwitchCloseTicks, at most
// once per SwitchCooldownTicks, and, while the plane is alive, not under a
// lock or a missile nor within HurtTicks of damage. Either way the human
// counts may differ by at most 1 afterwards (or the move must narrow the
// gap), and want must have a bot seat to take; a bot refills the seat left.
// A switcher's plane leaves the world with no death, kill or score change,
// and the human waits on the pick screen for the new team's aircraft. In the
// Lobby it is SetSide.
func (g *Game) ChooseTeam(id sim.ID, want sim.Team) error {
	p, ok := g.players[id]
	if !ok || p.Bot {
		return ErrNoPlayer
	}
	if g.phase == Lobby {
		return g.SetSide(id, want)
	}
	if g.s.Mode == mode.FFA {
		return ErrNoTeams
	}
	others := map[sim.Team]int{}
	for _, o := range g.players {
		if !o.Bot && o.ID != id {
			others[o.Team]++
		}
	}
	if want == sim.TeamNone {
		want = g.rules.TeamFor(others)
	}
	if want != sim.TeamNATO && want != sim.TeamSoviet {
		return ErrNoTeams
	}
	if want == p.Team {
		return nil
	}
	_, switched := g.switchAt[id]
	fresh := g.Waiting(id) && !switched // never flown in this room
	if !fresh {
		if err := g.switchGate(id, switched); err != nil {
			return err
		}
	}
	gap := func(c map[sim.Team]int) int { return abs(c[sim.TeamNATO] - c[sim.TeamSoviet]) }
	now := map[sim.Team]int{sim.TeamNATO: others[sim.TeamNATO], sim.TeamSoviet: others[sim.TeamSoviet]}
	now[p.Team]++
	others[want]++
	if after := gap(others); after > 1 && after >= gap(now) {
		return ErrUneven
	}
	victim := g.newestBot(want)
	if victim == 0 {
		return ErrTeamFull
	}
	old := p.Team
	g.remove(victim)
	g.world.RemovePlane(id) // no event: no death, no kill credit, no score change
	p.Team, p.Kind = want, teamKinds(want)[0]
	delete(g.swappedLife, id)
	if !fresh {
		g.switchAt[id] = g.tick
		g.pending[id] = g.tick + PickTimeoutTicks
	}
	g.rosterVer++
	g.addBot(old)
	return nil
}

// switchGate refuses a switch of a human who has flown: late in the round,
// inside the cooldown, or (plane alive) under fire.
func (g *Game) switchGate(id sim.ID, switched bool) error {
	if g.phase == Playing && g.roundEnd-g.tick < SwitchCloseTicks {
		return ErrLate
	}
	if switched && g.tick-g.switchAt[id] < SwitchCooldownTicks {
		return ErrCooldown
	}
	if pl, ok := g.world.Plane(id); !ok || !pl.Alive {
		return nil // dead or waiting: nothing to escape from
	}
	snap := g.world.Snapshot()
	for _, p := range snap.Planes {
		if p.Alive && p.LockTarget == id && p.Locked {
			return ErrLocked
		}
	}
	for _, m := range snap.Missiles {
		if m.Target == id {
			return ErrLocked
		}
	}
	if at, ok := g.hurtAt[id]; ok && g.tick-at < HurtTicks {
		return ErrHurt
	}
	return nil
}

// newestBot is the bot on team that gives up its seat to a human (0: none).
func (g *Game) newestBot(team sim.Team) sim.ID {
	var victim sim.ID
	for id, p := range g.players {
		if p.Bot && p.Team == team && id > victim {
			victim = id
		}
	}
	return victim
}

func abs(x int) int {
	if x < 0 {
		return -x
	}
	return x
}
