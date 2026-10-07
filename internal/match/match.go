// Package match is Dogfight's room.Game: it wraps game.Game for the room
// actor, encodes Dogfight's messages, tallies pilot stats and turns refused
// team choices into notices. Every method runs on the room goroutine.
package match

import (
	"errors"
	"fmt"
	"math"

	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/wsconn"
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
	Mode, Map, Weather, Phase string // phase: playing|ended|lobby
	LeftS                     int    // seconds left in the round
	NATO, Soviet              int    // humans per team (team and base modes)
	Seats                     int    // every seat of the room (the room list shows it)
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
	lobby     lobbyKey // last lobby state sent (lobby rooms only)
	back      returns  // seats of pilots who dropped, kept for their return (session.go)
	drain     *Drain   // the server's drain state (nil: never drains)
	drainAt   int      // game tick the drain was first seen in the lobby (-1: not draining)
	closed    bool     // lobby_closed went out for this drain
}

// lobbyKey is what a lobby message carries, as a change detector: outside
// the Lobby only the phase counts (the players message carries the roster).
type lobbyKey struct {
	phase     game.Phase
	host      sim.ID
	rosterVer int
}

var (
	_ room.Game[protocol.ClientMsg, sim.Input, Info] = (*Match)(nil)
	_ room.Acker                                     = protocol.Snap{}
	// Snapshots are the only messages a full outbound queue may evict, and
	// an evicted one hands its events to the next.
	_ wsconn.Carrier = protocol.Snap{}
)

// New builds the game (every seat a bot, or an empty lobby). sink nil:
// nothing is counted.
func New(s game.Settings, sink StatsSink) *Match {
	g := game.New(s)
	return &Match{g: g, static: protocol.NewStatic(g), stats: sink, seats: g.Seats(),
		humans: map[sim.ID]*human{}, rosterVer: g.RosterVersion(), back: returns{}, drainAt: -1}
}

// Factory is the lobby's room factory for Dogfight; every room watches d
// (nil: no drain signal).
func Factory(sink StatsSink, d *Drain) func(game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) {
	return func(s game.Settings) (room.Game[protocol.ClientMsg, sim.Input, Info], error) {
		m := New(s, sink)
		m.drain = d
		return m, nil
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
	m.returned(id, who.Pilot)
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	w := protocol.NewWelcome(sim.ID(id), code, m.g, m.static)
	w.Tok = newToken
	out.To(id, w)
	m.broadcastPlayers(out)
	out.To(id, protocol.NewRound(m.g.Round()))
	if m.g.Settings().Lobby { // the others hear of the new seat with the next Step (in the Lobby)
		out.To(id, m.lobbyMsg())
	}
}

// Leave frees id's seat; a lobby room keeps what the pilot had (session.go).
func (m *Match) Leave(id room.PlayerID) {
	sid := sim.ID(id)
	h, ok := m.humans[sid]
	var kept seatMemo
	if ok {
		kept = m.memo(sid)
		m.leaveCount(sid, h)
		delete(m.humans, sid)
	}
	m.g.RemoveHuman(sid)
	if ok {
		m.dropped(sid, h.pilot, kept)
	}
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
	case protocol.TSide:
		m.side(id, msg.Team, out)
	case protocol.TStart:
		m.start(id, out)
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
	if m.g.Settings().Lobby && m.lobbyKey() != m.lobby {
		m.broadcastLobby(out)
	}
	m.drainLobby(out)
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
	if m.round.phase != 0 && key.phase != m.round.phase {
		out.Changed() // the room list shows the phase
	}
	if key != m.round || tick%RoundEvery == 0 {
		m.round = key
		out.All(protocol.NewRound(rd))
	}
}

func (m *Match) lobbyKey() lobbyKey {
	if !m.g.InLobby() {
		return lobbyKey{phase: m.g.Round().Phase}
	}
	return lobbyKey{phase: game.Lobby, host: m.g.Host(), rosterVer: m.g.RosterVersion()}
}

// broadcastLobby sends the lobby state to everyone (lobby rooms only).
func (m *Match) broadcastLobby(out room.Outbox) {
	m.lobby = m.lobbyKey()
	out.All(m.lobbyMsg())
}

func (m *Match) lobbyMsg() protocol.LobbyMsg {
	return protocol.NewLobby(m.g.Round().Phase, m.g.Host(), m.g.SideSeats(), m.g.Players())
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

// Info: a created (lobby) room offers quick play no seat: the core's
// Summary.Seats is its human count, so lobby.Quick, the only reader of
// Summary.Seats, passes it by and nobody lands in a friend's lobby (or in a
// round that ends in one). Its link and room-list joins are unaffected; the
// room list reads the real seats from Info.Seats.
func (m *Match) Info() room.Info[Info] {
	st := m.g.Settings()
	rd := m.g.Round()
	nato, soviet := m.g.HumanTeams()
	humans := m.g.Humans()
	quickSeats := m.seats
	if st.Lobby {
		quickSeats = humans
	}
	return room.Info[Info]{Humans: humans, Seats: quickSeats, Bots: m.g.Bots(), Listed: st.Listed, Game: Info{
		Mode: st.Mode.String(), Map: st.Map.String(), Weather: st.Weather.String(), Phase: protocol.PhaseName(rd.Phase),
		LeftS: rd.TicksLeft / tickRate, NATO: nato, Soviet: soviet, Seats: m.seats}}
}

func (m *Match) Label() string { return m.g.Settings().Mode.String() }
