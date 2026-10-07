package game

import (
	"errors"

	"playground/internal/mode"
	"playground/internal/sim"
)

var (
	ErrNotHost  = errors.New("game: only the host may start")
	ErrNotLobby = errors.New("game: not in the lobby")
	ErrSideFull = errors.New("game: side has no free seat")
)

// Host is the room's host: the one SetHost named while seated, else the
// human who joined earliest among those still seated (IDs only grow, so the
// lowest human ID). 0 when no human is seated.
func (g *Game) Host() sim.ID {
	if p, ok := g.players[g.hostPin]; ok && !p.Bot {
		return g.hostPin
	}
	var host sim.ID
	for id, p := range g.players {
		if !p.Bot && (host == 0 || id < host) {
			host = id
		}
	}
	return host
}

// SetHost makes seated human id the host (a host's return under a new
// seat); false when id is no seated human.
func (g *Game) SetHost(id sim.ID) bool {
	if p, ok := g.players[id]; !ok || p.Bot {
		return false
	}
	g.hostPin = id
	return true
}

// InLobby reports whether the room waits in the pre-match lobby.
func (g *Game) InLobby() bool { return g.phase == Lobby }

// Seats is the room's seat count, bots included (constant for its life).
func (g *Game) Seats() int { return g.rules.Slots() }

// SideSeats is the seat count of one side: per team in team modes, the
// whole room in FFA.
func (g *Game) SideSeats() int { return g.s.Size }

// Bots counts the bots seated now.
func (g *Game) Bots() int { return len(g.bots) }

// addLobbyHuman seats a human in the lobby on the side auto-balance picks,
// with no plane and no pick timeout.
func (g *Game) addLobbyHuman(name string) (sim.ID, error) {
	humans := map[sim.Team]int{}
	total := 0
	for _, p := range g.players {
		humans[p.Team]++
		total++
	}
	team := g.rules.TeamFor(humans)
	if g.s.Mode != mode.FFA && humans[team] >= g.s.Size {
		team = otherTeam(team)
	}
	if total >= g.rules.Slots() || (g.s.Mode != mode.FFA && humans[team] >= g.s.Size) {
		return 0, ErrFull
	}
	return g.seat(cleanName(name), team, teamKinds(team)[0], false), nil
}

// SetSide moves human id to side want in the lobby (TeamNone: the side
// auto-balance picks). With humans on both sides afterwards, a side may not
// exceed the other by more than one human, unless the move narrows the gap;
// every human on one side (friends against bots) is always allowed. A side
// never holds more humans than its seats. The aircraft resets to the new
// side's first kind when the old one is not allowed there.
func (g *Game) SetSide(id sim.ID, want sim.Team) error {
	p, ok := g.players[id]
	if !ok || p.Bot {
		return ErrNoPlayer
	}
	if g.phase != Lobby {
		return ErrNotLobby
	}
	if g.s.Mode == mode.FFA {
		return ErrNoTeams
	}
	others := map[sim.Team]int{}
	for _, o := range g.players {
		if o.ID != id {
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
	if others[want] >= g.s.Size {
		return ErrSideFull
	}
	if !sideBalanced(others[sim.TeamNATO], others[sim.TeamSoviet], p.Team, want) {
		return ErrUneven
	}
	p.Team = want
	if !flies(want, p.Kind) {
		p.Kind = teamKinds(want)[0]
	}
	g.rosterVer++
	return nil
}

// Start begins the round from the lobby: the host only, with at least one
// human. Every human spawns in its chosen aircraft per the room's start
// mode, then bots fill the empty seats of each side, and the clock runs.
func (g *Game) Start(id sim.ID) error {
	if g.phase != Lobby {
		return ErrNotLobby
	}
	if host := g.Host(); host == 0 || host != id {
		return ErrNotHost
	}
	g.board.Reset()
	for _, p := range g.Players() { // ID order: the join order
		g.world.AddPlaneLoadout(p.ID, p.Team, p.Kind, p.Loadout)
	}
	if g.s.Mode == mode.FFA {
		for len(g.players) < g.rules.Slots() {
			g.addBot(sim.TeamNone)
		}
	} else {
		for _, t := range [...]sim.Team{sim.TeamNATO, sim.TeamSoviet} {
			for g.sideCount(t) < g.s.Size {
				g.addBot(t)
			}
		}
	}
	g.phase, g.winner = Playing, ""
	g.winTeam, g.winID = sim.TeamNone, 0
	g.roundEnd = g.tick + g.rules.DurationTicks()
	g.rosterVer++
	return nil
}

// toLobby ends the scoreboard of a lobby room: the bots leave, the humans
// keep their sides and picks, and a fresh world (same seed) waits for the
// next Start.
func (g *Game) toLobby() {
	for id := range g.bots {
		g.remove(id)
	}
	clear(g.pending)
	clear(g.swappedLife)
	clear(g.switchAt)
	clear(g.hurtAt)
	g.botKind = map[sim.Team]int{}
	g.board.Reset()
	g.world = sim.NewWorld(g.worldConfig())
	g.phase, g.winner = Lobby, ""
	g.winTeam, g.winID = sim.TeamNone, 0
	g.rosterVer++
}

func (g *Game) sideCount(t sim.Team) int {
	n := 0
	for _, p := range g.players {
		if p.Team == t {
			n++
		}
	}
	return n
}

// sideBalanced is the lobby's balance rule for moving a human from mine
// to want, given the other humans per side (nato, soviet).
func sideBalanced(nato, soviet int, mine, want sim.Team) bool {
	count := func(t sim.Team) (int, int) {
		if t == sim.TeamNATO {
			return nato + 1, soviet
		}
		return nato, soviet + 1
	}
	an, as := count(want)
	if an == 0 || as == 0 { // everyone on one side: together against bots
		return true
	}
	nn, ns := count(mine)
	return abs(an-as) <= 1 || abs(an-as) < abs(nn-ns)
}

// flies reports whether team t may fly kind k.
func flies(t sim.Team, k sim.Kind) bool {
	for _, tk := range teamKinds(t) {
		if tk == k {
			return true
		}
	}
	return false
}

func otherTeam(t sim.Team) sim.Team {
	if t == sim.TeamNATO {
		return sim.TeamSoviet
	}
	return sim.TeamNATO
}
