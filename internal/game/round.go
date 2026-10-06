package game

import (
	"strconv"

	"playground/internal/mode"
	"playground/internal/sim"
)

// Round is the round state the room broadcasts.
type Round struct {
	Phase        Phase
	TicksLeft    int
	Winner       string
	Board        []mode.Line
	NATO, Soviet int
	// WinnerTeam / WinnerID identify the winner apart from its name:
	// a team (team, base) or a plane (FFA); zero on a draw or while Playing.
	WinnerTeam         sim.Team
	WinnerID           sim.ID
	ObjNATO, ObjSoviet float64 // base attack: remaining target HP per side
	Base               bool    // base attack round: the objective is meaningful
}

// objTolerance is the objective HP difference below which time-up is a
// draw: the wire's 0.1 rounding, far above summed float residue.
const objTolerance = 0.05

// finish ends the round with the rules' raw winner: a team name, an FFA
// plane ID or the draw sentinel.
func (g *Game) finish(raw string) {
	g.winTeam, g.winID = sim.TeamNone, 0
	switch raw {
	case "NATO":
		g.winTeam = sim.TeamNATO
	case "Sovyet":
		g.winTeam = sim.TeamSoviet
	case drawWinner:
	default:
		if id, err := strconv.Atoi(raw); err == nil {
			g.winID = sim.ID(id)
		}
	}
	g.phase, g.winner = Ended, g.winnerName(raw)
	g.phaseEnd = g.tick + EndedTicks
}

// winnerName maps an FFA winner (a plane ID) to the player's name.
func (g *Game) winnerName(w string) string {
	if g.s.Mode != mode.FFA {
		return w
	}
	if id, err := strconv.Atoi(w); err == nil {
		if p, ok := g.players[sim.ID(id)]; ok {
			return p.Name
		}
	}
	return w
}

// leader is the raw winner when time runs out: the side with more target HP
// left (base), the higher team score (team), or the top FFA line's plane
// ID; a tie is a draw.
func (g *Game) leader() string {
	if g.s.Mode == mode.Base {
		n, s := g.board.ObjectiveHP(sim.TeamNATO), g.board.ObjectiveHP(sim.TeamSoviet)
		switch {
		case n > s+objTolerance:
			return "NATO"
		case s > n+objTolerance:
			return "Sovyet"
		}
		return drawWinner
	}
	if g.s.Mode == mode.Team {
		n, s := g.board.TeamScore(sim.TeamNATO), g.board.TeamScore(sim.TeamSoviet)
		switch {
		case n > s:
			return "NATO"
		case s > n:
			return "Sovyet"
		}
		return drawWinner
	}
	ls := g.board.Lines()
	if len(ls) == 0 || (len(ls) > 1 && ls[0].Score == ls[1].Score && ls[0].Kills == ls[1].Kills) {
		return drawWinner
	}
	return strconv.Itoa(int(ls[0].ID))
}

func (g *Game) Round() Round {
	left := g.roundEnd - g.tick
	if g.phase == Ended {
		left = g.phaseEnd - g.tick
	}
	return Round{
		Phase:     g.phase,
		TicksLeft: max(0, left),
		Winner:    g.winner,
		Board:     g.board.Lines(),
		NATO:      g.board.TeamScore(sim.TeamNATO),
		Soviet:    g.board.TeamScore(sim.TeamSoviet),

		WinnerTeam: g.winTeam,
		WinnerID:   g.winID,
		ObjNATO:    g.board.ObjectiveHP(sim.TeamNATO),
		ObjSoviet:  g.board.ObjectiveHP(sim.TeamSoviet),
		Base:       g.s.Mode == mode.Base,
	}
}
