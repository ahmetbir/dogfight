package mode

import (
	"cmp"
	"slices"

	"playground/internal/sim"
)

type Line struct {
	ID                   sim.ID
	Kills, Deaths, Score int
}

// Scoreboard tallies kills per player and per team for one round, and in
// base attack the remaining target HP per side.
type Scoreboard struct {
	lines       map[sim.ID]*Line
	teams       map[sim.Team]int
	obj, objMax map[sim.Team]float64
	targets     map[sim.Team]int // targets per side (0: unknown)
	down        map[sim.Team]int // targets destroyed this round
}

func NewScoreboard() *Scoreboard {
	return &Scoreboard{
		lines: map[sim.ID]*Line{}, teams: map[sim.Team]int{},
		obj: map[sim.Team]float64{}, objMax: map[sim.Team]float64{},
		targets: map[sim.Team]int{}, down: map[sim.Team]int{},
	}
}

// SetObjective sets each side's target HP; it is also the Reset value.
func (b *Scoreboard) SetObjective(nato, soviet float64) {
	b.objMax[sim.TeamNATO], b.objMax[sim.TeamSoviet] = nato, soviet
	b.obj[sim.TeamNATO], b.obj[sim.TeamSoviet] = nato, soviet
}

// SetTargets sets how many targets each side has, so a side loses on its
// last EvStructDown rather than on a summed HP that keeps float residue.
func (b *Scoreboard) SetTargets(nato, soviet int) {
	b.targets[sim.TeamNATO], b.targets[sim.TeamSoviet] = nato, soviet
}

// ObjectiveHP is the side's remaining target HP (0 without an objective).
func (b *Scoreboard) ObjectiveHP(t sim.Team) float64 { return b.obj[t] }

// Lost reports whether every target of side t is down: by count when the
// targets are known, else by objective HP.
func (b *Scoreboard) Lost(t sim.Team) bool {
	if !b.HasObjective() {
		return false
	}
	if n := b.targets[t]; n > 0 {
		return b.down[t] >= n
	}
	return b.obj[t] <= 0
}

// HasObjective reports whether the round tracks targets (base attack).
func (b *Scoreboard) HasObjective() bool { return len(b.objMax) > 0 }

// Add ensures id has a (zero) row, so the board lists players without events.
func (b *Scoreboard) Add(id sim.ID) { b.line(id) }

func (b *Scoreboard) line(id sim.ID) *Line {
	l, ok := b.lines[id]
	if !ok {
		l = &Line{ID: id}
		b.lines[id] = l
	}
	return l
}

// Apply scores an event. EvStructHit lowers the target side's objective and
// EvStructDown gives the destroyer +2; other non-kill events are ignored.
// On EvKill the victim always gets a death. A kill by another plane scores
// +1 for the killer (and its team) unless both are on the same team; a kill
// without an attacker (crash, bounds) costs the victim 1 point, except an AA
// kill, which only counts the death.
func (b *Scoreboard) Apply(ev sim.Event, teamOf func(sim.ID) sim.Team) {
	switch ev.Kind {
	case sim.EvStructHit:
		if t, ok := sim.StructTeam(ev.Plane); ok && b.HasObjective() {
			b.obj[t] = max(0, b.obj[t]-ev.Value)
		}
		return
	case sim.EvStructDown:
		if t, ok := sim.StructTeam(ev.Plane); ok && b.HasObjective() {
			if b.down[t]++; b.targets[t] > 0 && b.down[t] >= b.targets[t] {
				b.obj[t] = 0 // all down: drop the summed float residue
			}
		}
		if ev.Other != 0 {
			b.line(ev.Other).Score += 2
		}
		return
	case sim.EvKill:
	default:
		return
	}
	b.line(ev.Plane).Deaths++
	switch {
	case ev.Other == 0:
		if ev.Weapon != sim.WAA {
			b.line(ev.Plane).Score--
		}
	case ev.Other == ev.Plane:
		// self-inflicted with an attacker ID: death only
	default:
		team := teamOf(ev.Other)
		if team != sim.TeamNone && team == teamOf(ev.Plane) {
			return // teammate kill: no point
		}
		k := b.line(ev.Other)
		k.Kills++
		k.Score++
		if team != sim.TeamNone {
			b.teams[team]++
		}
	}
}

// Lines returns the rows sorted by Score desc, Kills desc, ID asc.
func (b *Scoreboard) Lines() []Line {
	out := make([]Line, 0, len(b.lines))
	for _, l := range b.lines {
		out = append(out, *l)
	}
	slices.SortFunc(out, func(x, y Line) int {
		if c := cmp.Compare(y.Score, x.Score); c != 0 {
			return c
		}
		if c := cmp.Compare(y.Kills, x.Kills); c != 0 {
			return c
		}
		return cmp.Compare(x.ID, y.ID)
	})
	return out
}

func (b *Scoreboard) TeamScore(t sim.Team) int { return b.teams[t] }

func (b *Scoreboard) Remove(id sim.ID) { delete(b.lines, id) }

// Reset zeroes every row (rows are kept) and the team scores, and restores
// the objective, for a new round.
func (b *Scoreboard) Reset() {
	for id := range b.lines {
		b.lines[id] = &Line{ID: id}
	}
	clear(b.teams)
	clear(b.down)
	for t, v := range b.objMax {
		b.obj[t] = v
	}
}
