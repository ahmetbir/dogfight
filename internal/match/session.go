package match

import (
	"sync/atomic"

	"github.com/ahmetbir/roomkit/netproto"
	"github.com/ahmetbir/roomkit/room"
	"playground/internal/protocol"
	"playground/internal/sim"
)

// ReturnTicks is how long a pilot who dropped keeps its place: the host
// role and, in the lobby, its side and jet. The client's reconnect backoff
// (0.5, 1, 2, 4, 8, 8 … s) rejoins within it, and the server idle-closes a
// silent socket at 30 s.
const ReturnTicks = 60 * tickRate

// seatMemo is what a dropped pilot gets back on its return (by token hash).
type seatMemo struct {
	host    bool
	lobby   bool // the side and jet below are a lobby seat's
	team    sim.Team
	kind    sim.Kind
	loadout sim.Loadout
	left    int // game tick it left
}

// returns are the seats of dropped pilots, by pilot hash.
type returns map[string]seatMemo

// memo is what id holds now: host role, and in the lobby side and jet.
func (m *Match) memo(id sim.ID) seatMemo {
	s := seatMemo{host: m.g.Host() == id, lobby: m.g.InLobby(), left: m.g.Tick()}
	for _, p := range m.g.Players() {
		if p.ID == id {
			s.team, s.kind, s.loadout = p.Team, p.Kind, p.Loadout
		}
	}
	return s
}

// dropped keeps the seat id of a leaving pilot for its return: at once
// when the same pilot already sits again in a newer seat (the new socket
// came before the old one timed out; an older seat of the same pilot is
// another tab, not a reconnect), else for ReturnTicks.
func (m *Match) dropped(id sim.ID, pilot string, s seatMemo) {
	if pilot == "" || (!s.host && !s.lobby) {
		return
	}
	var again sim.ID // the earliest newer seat of the same pilot (map order is not defined)
	for oid, o := range m.humans {
		if o.pilot == pilot && oid > id && (again == 0 || oid < again) {
			again = oid
		}
	}
	if again != 0 {
		m.restore(again, s)
		return
	}
	for p, old := range m.back { // keep the map to pilots that may still return
		if s.left-old.left > ReturnTicks {
			delete(m.back, p)
		}
	}
	m.back[pilot] = s
}

// returned gives a joining pilot back what it held when it dropped, within
// ReturnTicks.
func (m *Match) returned(id sim.ID, pilot string) {
	s, ok := m.back[pilot]
	if pilot == "" || !ok {
		return
	}
	delete(m.back, pilot)
	if m.g.Tick()-s.left <= ReturnTicks {
		m.restore(id, s)
	}
}

// restore puts s back on seat id: the host role, and while the lobby is
// still open the side (if the balance and seats allow) and the jet.
func (m *Match) restore(id sim.ID, s seatMemo) {
	if s.host {
		m.g.SetHost(id)
	}
	if !s.lobby || !m.g.InLobby() {
		return
	}
	_ = m.g.SetSide(id, s.team) // refused (side full now): the auto-balanced side stays
	m.g.SetLoadout(id, s.loadout)
	_ = m.g.Pick(id, s.kind) // a kind of the other side is refused: the side's default stays
}

// Drain is the server's drain state as the rooms see it (blue/green): the
// drain actor sets it, every room's Step reads it. Safe across goroutines.
type Drain struct{ on atomic.Bool }

// Set records the drain state (true: draining).
func (d *Drain) Set(on bool) { d.on.Store(on) }

// On reports whether the server drains; a nil Drain never does.
func (d *Drain) On() bool { return d != nil && d.on.Load() }

// LobbyDrainTicks is the grace a room waiting in its lobby gets once the
// server drains (the host may still press Start); then everyone is told
// the lobby closed, so the old server does not wait on it until drain-max
// while new link joiners reach the new server.
const LobbyDrainTicks = 10 * tickRate

// drainLobby closes a lobby on a draining server after LobbyDrainTicks:
// a lobby_closed notice to everyone, whose clients then leave.
func (m *Match) drainLobby(out room.Outbox) {
	if !m.drain.On() || !m.g.InLobby() {
		m.drainAt, m.closed = -1, false
		return
	}
	if m.drainAt < 0 {
		m.drainAt = m.g.Tick()
	}
	if !m.closed && m.g.Tick()-m.drainAt >= LobbyDrainTicks {
		m.closed = true
		out.All(netproto.NewNotice(protocol.CodeLobbyClosed, msgLobbyClosed))
	}
}
