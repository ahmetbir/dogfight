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
	// The pilot (token hash) of a host who left, and the game tick it left:
	// back within HostReturnTicks under a new seat, it is the host again.
	hostPilot string
	hostLeft  int
}

// HostReturnTicks is how long a host who dropped keeps the right to the
// host role: the client's reconnect backoff (0.5, 1, 2, 4, 8, 8 … s)
// rejoins within it, and the server idle-closes a silent socket at 30 s.
const HostReturnTicks = 60 * tickRate

// lobbyKey is what a lobby message carries, as a change detector.
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
	if who.Pilot != "" && who.Pilot == m.hostPilot && m.g.Tick()-m.hostLeft <= HostReturnTicks {
		m.g.SetHost(id) // the host is back (a reconnect)
		m.hostPilot = ""
	}
	return room.PlayerID(id), nil
}

func (m *Match) Welcome(id room.PlayerID, code, newToken string, out room.Outbox) {
	w := protocol.NewWelcome(sim.ID(id), code, m.g, m.static)
	w.Tok = newToken
	out.To(id, w)
	m.broadcastPlayers(out)
	out.To(id, protocol.NewRound(m.g.Round()))
	if m.g.Settings().Lobby {
		m.broadcastLobby(out)
	}
}

// Leave frees id's seat. A leaving host's pilot keeps the host role: at
// once when the same pilot already sits again (it reconnected before the
// old socket timed out), else when it rejoins within HostReturnTicks.
func (m *Match) Leave(id room.PlayerID) {
	sid := sim.ID(id)
	wasHost := m.g.Host() == sid
	h, ok := m.humans[sid]
	if ok {
		m.leaveCount(sid, h)
		delete(m.humans, sid)
	}
	m.g.RemoveHuman(sid)
	if !wasHost || !ok || h.pilot == "" {
		return
	}
	var again sim.ID // the earliest seat of the same pilot (map order is not defined)
	for oid, o := range m.humans {
		if o.pilot == h.pilot && (again == 0 || oid < again) {
			again = oid
		}
	}
	if again != 0 && m.g.SetHost(again) {
		return
	}
	m.hostPilot, m.hostLeft = h.pilot, m.g.Tick()
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
	return lobbyKey{phase: m.g.Round().Phase, host: m.g.Host(), rosterVer: m.g.RosterVersion()}
}

// broadcastLobby sends the lobby state to everyone (lobby rooms only).
func (m *Match) broadcastLobby(out room.Outbox) {
	m.lobby = m.lobbyKey()
	out.All(protocol.NewLobby(m.lobby.phase, m.lobby.host, m.g.SideSeats(), m.g.Players()))
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
