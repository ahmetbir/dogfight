// Package match is Dogfight's room.Game: it wraps game.Game for the room
// actor, encodes Dogfight's messages, tallies pilot stats and turns refused
// team choices into notices. Every method runs on the room goroutine.
package match

import (
	"errors"
	"fmt"
	"math"

	"playground/core/room"
	"playground/internal/game"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/stats"
)

const (
	tickRate   = 60
	SnapEvery  = 2             // ticks between snapshots
	RoundEvery = 60            // ticks between periodic round broadcasts
	MatchTicks = 60 * tickRate // presence in a round's play (plus airborne once) that counts as a match
)

// StatsSink takes a pilot's tally; it must not block (spec §10.3 of v2).
type StatsSink interface{ Record(stats.Delta) bool }

// Info is Dogfight's part of the lobby summary.
type Info struct {
	Mode, Map, Weather, Phase string // phase: playing|ended
	LeftS                     int    // seconds left in the round
	NATO, Soviet              int    // humans per team (team and base modes)
}

type roundKey struct {
	phase                                game.Phase
	nato, soviet, totalKills, totalScore int
	objNATO, objSoviet                   int // base attack HP in 10 HP steps: bars move without a flood of updates
}

// human is one seated human's tally state.
type human struct {
	pilot      string // token hash; "" = not counted
	name       string // roster name, reported with the tally
	tally      stats.Delta
	roundTicks int
	airborne   bool
	flushed    bool // a drain flush already counted this round's match
}

// Match is not safe for concurrent use; the room goroutine owns it.
type Match struct {
	g         *game.Game
	static    protocol.Static // welcome terrain and map, encoded once
	stats     StatsSink
	seats     int // every seat, bots included
	humans    map[sim.ID]*human
	events    []protocol.EventJSON
	rosterVer int
	round     roundKey
}

var (
	_ room.Game[protocol.ClientMsg, sim.Input, Info] = (*Match)(nil)
	_ room.Acker                                     = protocol.Snap{}
)

// New builds the game (every seat a bot). sink nil: nothing is counted.
func New(s game.Settings, sink StatsSink) *Match {
	g := game.New(s)
	return &Match{g: g, static: protocol.NewStatic(g), stats: sink, seats: len(g.Players()),
		humans: map[sim.ID]*human{}, rosterVer: g.RosterVersion()}
}

// Factory is the lobby's room factory for Dogfight.
func Factory(sink StatsSink) func(game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) {
	return func(s game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) {
		return New(s, sink), nil
	}
}

func (m *Match) Join(who room.Who) (room.PlayerID, error) {
	id, err := m.g.AddHuman(who.Name)
	if errors.Is(err, game.ErrFull) {
		return 0, fmt.Errorf("%w: %w", room.ErrFull, err)
	}
	if err != nil {
		return 0, err
	}
	h := &human{pilot: who.Pilot}
	for _, p := range m.g.Players() {
		if p.ID == id {
			h.name = p.Name // the roster's cleaned name
		}
	}
	m.humans[id] = h
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	w := protocol.NewWelcome(sim.ID(id), code, m.g, m.static)
	w.Tok = newToken
	out.To(id, w)
	m.broadcastPlayers(out)
	out.To(id, protocol.NewRound(m.g.Round()))
}

func (m *Match) Leave(id room.PlayerID) {
	sid := sim.ID(id)
	if h, ok := m.humans[sid]; ok {
		m.leaveCount(sid, h)
		delete(m.humans, sid)
	}
	m.g.RemoveHuman(sid)
}

func (m *Match) Handle(id room.PlayerID, msg protocol.ClientMsg, out room.Outbox) {
	sid := sim.ID(id)
	switch msg.T {
	case protocol.TPick:
		if lo, ok := sim.ParseLoadout(msg.Lo); ok { // before Pick: a respawning pick takes it at once
			m.g.SetLoadout(sid, lo)
		}
		if k, ok := sim.ParseKind(msg.Kind); ok {
			_ = m.g.Pick(sid, k) // a kind the team may not fly is ignored
		}
	case protocol.TTeam:
		m.team(id, msg.Team, out)
	}
}

// Step runs one tick and sends, in this order: the snapshot (every
// SnapEvery ticks, with the events since the last one), the roster when it
// changed, the round when its key changed or every RoundEvery ticks.
func (m *Match) Step(inputs map[room.PlayerID]sim.Input, out room.Outbox) {
	evs := m.g.Step(inputs)
	m.countEvents(evs)
	tick := m.g.Tick()
	m.events = append(m.events, protocol.NewEvents(evs, tick)...)
	rd := m.g.Round()
	if tick%SnapEvery == 0 {
		world := m.g.Snapshot()
		m.countFlight(world, rd.Phase)
		snap := protocol.NewSnap(world, m.events, tick)
		m.events = nil // snap owns the old slice; sessions share it read-only
		out.Snap(snap)
	}
	if m.g.RosterVersion() != m.rosterVer {
		m.broadcastPlayers(out)
	}
	key := roundKey{phase: rd.Phase, nato: rd.NATO, soviet: rd.Soviet,
		objNATO: int(math.Ceil(rd.ObjNATO / 10)), objSoviet: int(math.Ceil(rd.ObjSoviet / 10))}
	for _, l := range rd.Board {
		key.totalKills += l.Kills
		key.totalScore += l.Score // +2 for a destroyed target is not a kill
	}
	if rd.Phase == game.Playing {
		m.countPresence()
	}
	if m.round.phase == game.Playing && rd.Phase == game.Ended {
		m.roundOver(rd)
	}
	if key != m.round || tick%RoundEvery == 0 {
		m.round = key
		out.All(protocol.NewRound(rd))
	}
}

func (m *Match) broadcastPlayers(out room.Outbox) {
	m.rosterVer = m.g.RosterVersion()
	out.All(protocol.NewPlayers(m.g.Players()))
}

// ChatScope: team-only in team and base modes, everyone in FFA. Scoped by
// the room's mode, not the sender's team: a sender missing from the roster
// (TeamNone) must not reach both teams.
func (m *Match) ChatScope(from room.PlayerID) func(to room.PlayerID) bool {
	teams := m.teams()
	team, ffa := teams[sim.ID(from)], m.g.Settings().Mode == mode.FFA
	return func(to room.PlayerID) bool { return ffa || (team != sim.TeamNone && teams[sim.ID(to)] == team) }
}

// teams maps every seated player to its team (TeamNone in FFA).
func (m *Match) teams() map[sim.ID]sim.Team {
	ps := m.g.Players()
	out := make(map[sim.ID]sim.Team, len(ps))
	for _, p := range ps {
		out[p.ID] = p.Team
	}
	return out
}

func (m *Match) Info() room.Info[Info] {
	st := m.g.Settings()
	rd := m.g.Round()
	phase := "playing"
	if rd.Phase == game.Ended {
		phase = "ended"
	}
	nato, soviet := m.g.HumanTeams()
	return room.Info[Info]{Humans: m.g.Humans(), Seats: m.seats, Listed: st.Listed, Game: Info{
		Mode: st.Mode.String(), Map: st.Map.String(), Weather: st.Weather.String(), Phase: phase,
		LeftS: rd.TicksLeft / tickRate, NATO: nato, Soviet: soviet}}
}

func (m *Match) Label() string { return m.g.Settings().Mode.String() }
