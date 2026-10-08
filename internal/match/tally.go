package match

import (
	"playground/internal/game"
	"playground/internal/sim"
	"playground/internal/stats"
)

// counted reports the human of id when its pilot is counted.
func (m *Match) counted(id sim.ID) (*human, bool) {
	h, ok := m.humans[id]
	return h, ok && h.pilot != "" && m.stats != nil
}

// countEvents tallies one tick's events (spec §10.2). A kill of a human in
// a listed room counts toward Kills (the leaderboard); a kill of a bot, or
// of a human in a private room, toward BotKills (personal card only, rulings
// S5 and fix 1: no farming the board between two tabs in a private room).
// Team kills and kills between two sessions of one pilot (two tabs, one
// token) count for nobody.
func (m *Match) countEvents(evs []sim.Event) {
	if m.stats == nil || len(evs) == 0 {
		return
	}
	var teams map[sim.ID]sim.Team // built on the first kill only
	for _, e := range evs {
		switch e.Kind {
		case sim.EvKill:
			if h, ok := m.counted(e.Plane); ok {
				h.tally.Deaths++
				if e.Other == 0 && (e.Weapon == sim.WCrash || e.Weapon == sim.WBounds) {
					h.tally.Crashes++
				}
			}
			h, ok := m.counted(e.Other)
			if !ok || e.Other == e.Plane {
				continue
			}
			if v, human := m.humans[e.Plane]; human && v.pilot == h.pilot {
				continue // two tabs, one token: no self-farming
			}
			if teams == nil {
				teams = m.teams()
			}
			if teams[e.Other] != sim.TeamNone && teams[e.Other] == teams[e.Plane] {
				continue
			}
			if _, human := m.humans[e.Plane]; human && m.g.Settings().Listed {
				h.tally.Kills++
			} else {
				h.tally.BotKills++
			}
		case sim.EvMissileLaunch:
			if h, ok := m.counted(e.By); ok {
				h.tally.Fired++
			}
		case sim.EvHit:
			if h, ok := m.counted(e.Other); ok && e.Weapon == sim.WMissile {
				h.tally.Hits++
			}
		}
	}
}

// countFlight adds one snapshot interval of flight for every counted pilot
// alive and off the wheels, and marks it airborne in this round. Only round
// play counts: the frozen scoreboard world (Ended) is no flight.
func (m *Match) countFlight(snap sim.Snapshot, phase game.Phase) {
	if m.stats == nil || phase != game.Playing {
		return
	}
	for _, p := range snap.Planes {
		if h, ok := m.counted(p.ID); ok && p.Alive && !p.Ground {
			h.airborne = true
			h.tally.Flight += SnapEvery
			if h.tally.Kinds == nil {
				h.tally.Kinds = map[string]int{}
			}
			h.tally.Kinds[p.Kind.String()] += SnapEvery
		}
	}
}

// countPresence adds one tick of round play for every counted pilot.
func (m *Match) countPresence() {
	if m.stats == nil {
		return
	}
	for id, h := range m.humans {
		if _, ok := m.counted(id); ok {
			h.roundTicks++
		}
	}
}

// played reports whether h has earned a match this round: MatchTicks of
// presence and airborne at least once.
func (h *human) played() bool { return h.roundTicks >= MatchTicks && h.airborne }

// newRound forgets h's presence in the round that just ended.
func (h *human) newRound() { h.roundTicks, h.airborne, h.flushed = 0, false, false }

// roundOver counts a match (and a win) for every counted pilot who played
// the round, and flushes every counted tally.
func (m *Match) roundOver(rd game.Round) {
	if m.stats == nil {
		return
	}
	teams := m.teams()
	for id, h := range m.humans {
		if _, ok := m.counted(id); !ok {
			continue
		}
		if h.played() {
			if !h.flushed {
				h.tally.Matches++
			}
			if (rd.WinnerTeam != sim.TeamNone && teams[id] == rd.WinnerTeam) || rd.WinnerID == id {
				h.tally.Wins++
			}
		}
		h.newRound()
		m.flush(h)
	}
}

// leaveCount closes a leaving pilot's tally: a round it played counts as a
// match without a win, so leaving cannot dodge a loss.
func (m *Match) leaveCount(id sim.ID, h *human) {
	if _, ok := m.counted(id); ok && h.played() && !h.flushed {
		h.tally.Matches++
	}
	h.newRound()
	m.flush(h)
}

// flush hands a human's tally to the sink and starts a new one. A name
// change alone is not recorded. A name blocked since the pilot was seated
// is not stored (the tally counts, the row keeps its name or gets the
// default, and a purged pilot's tally is dropped by the store).
func (m *Match) flush(h *human) {
	if m.stats == nil || h.pilot == "" || h.tally.Empty() {
		return
	}
	h.tally.Pilot, h.tally.Name = h.pilot, h.name
	if n := m.mod.Names; n != nil && n.Blocked(h.name) {
		h.tally.Name = ""
	}
	m.stats.Record(h.tally)
	h.tally = stats.Delta{}
}

// FlushStats hands every seated pilot's open tally over while the players
// stay seated: a played round counts as a match now (as a leave would),
// without a win, and the round goes on; after an undrain its end credits
// the win without a second match.
func (m *Match) FlushStats() {
	for id, h := range m.humans {
		if _, ok := m.counted(id); ok && h.played() && !h.flushed {
			h.tally.Matches++
			h.flushed = true
		}
		m.flush(h)
	}
}

// Close hands over every open tally as the room stops.
func (m *Match) Close() {
	for _, h := range m.humans {
		m.flush(h)
	}
}
