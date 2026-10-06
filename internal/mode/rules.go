// Package mode holds the round rules (team / free-for-all / base attack) and
// the scoreboard.
package mode

import (
	"strconv"

	"playground/internal/sim"
)

type Kind uint8

const (
	Team Kind = iota + 1
	FFA
	Base // base attack: team variant, destroy the enemy targets
)

// Draw is the winner name of a drawn round.
const Draw = "Berabere"

const (
	roundTicks     = 8 * 60 * 60  // 8 minutes at 60 Hz
	baseRoundTicks = 10 * 60 * 60 // 10 minutes at 60 Hz
)

func ParseKind(s string) (Kind, bool) {
	switch s {
	case "team":
		return Team, true
	case "ffa":
		return FFA, true
	case "base":
		return Base, true
	}
	return 0, false
}

func (k Kind) String() string {
	switch k {
	case Team:
		return "team"
	case FFA:
		return "ffa"
	case Base:
		return "base"
	}
	return "unknown"
}

// Rules decide seating, friendly fire and when a round is won. The round
// timer is checked by the game layer, not by Over.
type Rules interface {
	Kind() Kind
	Slots() int                               // total seats
	TeamFor(counts map[sim.Team]int) sim.Team // team for a newcomer
	FriendlyFire() bool
	KillLimit() int
	DurationTicks() int
	Over(b *Scoreboard) (over bool, winner string)
}

// NewRules builds the rules for k. Team and Base: size is per team, clamped
// 1..6. FFA (and any other kind): size is the total, clamped 2..12.
func NewRules(k Kind, size int) Rules {
	switch k {
	case Team:
		return teamRules{perTeam: min(6, max(1, size))}
	case Base:
		return baseRules{perTeam: min(6, max(1, size))}
	}
	return ffaRules{seats: min(12, max(2, size))}
}

type teamRules struct{ perTeam int }

func (teamRules) Kind() Kind         { return Team }
func (r teamRules) Slots() int       { return 2 * r.perTeam }
func (teamRules) FriendlyFire() bool { return false }
func (teamRules) KillLimit() int     { return 25 }
func (teamRules) DurationTicks() int { return roundTicks }

// TeamFor returns the smaller team; NATO on a tie.
func (teamRules) TeamFor(counts map[sim.Team]int) sim.Team {
	if counts[sim.TeamSoviet] < counts[sim.TeamNATO] {
		return sim.TeamSoviet
	}
	return sim.TeamNATO
}

func (r teamRules) Over(b *Scoreboard) (bool, string) {
	switch {
	case b.TeamScore(sim.TeamNATO) >= r.KillLimit():
		return true, "NATO"
	case b.TeamScore(sim.TeamSoviet) >= r.KillLimit():
		return true, "Sovyet"
	}
	return false, ""
}

type ffaRules struct{ seats int }

func (ffaRules) Kind() Kind                        { return FFA }
func (r ffaRules) Slots() int                      { return r.seats }
func (ffaRules) FriendlyFire() bool                { return false }
func (ffaRules) KillLimit() int                    { return 15 }
func (ffaRules) DurationTicks() int                { return roundTicks }
func (ffaRules) TeamFor(map[sim.Team]int) sim.Team { return sim.TeamNone }

// Over names the winner by plane ID; the game layer maps it to a name.
func (r ffaRules) Over(b *Scoreboard) (bool, string) {
	for _, l := range b.Lines() {
		if l.Kills >= r.KillLimit() {
			return true, strconv.Itoa(int(l.ID))
		}
	}
	return false, ""
}

type baseRules struct{ perTeam int }

func (baseRules) Kind() Kind                          { return Base }
func (r baseRules) Slots() int                        { return 2 * r.perTeam }
func (baseRules) FriendlyFire() bool                  { return false }
func (baseRules) KillLimit() int                      { return 0 }
func (baseRules) DurationTicks() int                  { return baseRoundTicks }
func (baseRules) TeamFor(c map[sim.Team]int) sim.Team { return teamRules{}.TeamFor(c) }

// Over: a side whose targets are all down loses, both at once is a draw;
// time-up is the game's call.
func (baseRules) Over(b *Scoreboard) (bool, string) {
	n, s := b.Lost(sim.TeamNATO), b.Lost(sim.TeamSoviet)
	switch {
	case n && s:
		return true, Draw
	case n:
		return true, "Sovyet"
	case s:
		return true, "NATO"
	}
	return false, ""
}
