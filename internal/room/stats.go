package room

import (
	"playground/internal/game"
	"playground/internal/sim"
	"playground/internal/stats"
)

// StatsSink takes a pilot's tally; it must not block (spec §10.3).
type StatsSink interface{ Record(stats.Delta) bool }

// MatchTicks is the presence in a round's play a pilot needs (airborne at
// least once too) for the round to count as a match.
const MatchTicks = 60 * TickRate

// counted reports the session of id when its pilot is counted.
func (r *Room) counted(id sim.ID) (*session, bool) {
	s, ok := r.sessions[id]
	return s, ok && s.pilot != "" && r.stats != nil
}

// countEvents tallies one tick's events (spec §10.2). A kill of a human in
// a listed room counts toward Kills (the leaderboard); a kill of a bot, or
// of a human in a private room, toward BotKills (personal card only, rulings
// S5 and fix 1: no farming the board between two tabs in a private room).
// Team kills and kills between two sessions of one pilot (two tabs, one
// token) count for nobody.
func (r *Room) countEvents(evs []sim.Event) {
	if r.stats == nil || len(evs) == 0 {
		return
	}
	var teams map[sim.ID]sim.Team // built on the first kill only
	for _, e := range evs {
		switch e.Kind {
		case sim.EvKill:
			if s, ok := r.counted(e.Plane); ok {
				s.tally.Deaths++
				if e.Other == 0 && (e.Weapon == sim.WCrash || e.Weapon == sim.WBounds) {
					s.tally.Crashes++
				}
			}
			s, ok := r.counted(e.Other)
			if !ok || e.Other == e.Plane {
				continue
			}
			if v, human := r.sessions[e.Plane]; human && v.pilot == s.pilot {
				continue // two tabs, one token: no self-farming
			}
			if teams == nil {
				teams = r.teams()
			}
			if teams[e.Other] != sim.TeamNone && teams[e.Other] == teams[e.Plane] {
				continue
			}
			if _, human := r.sessions[e.Plane]; human && r.game.Settings().Listed {
				s.tally.Kills++
			} else {
				s.tally.BotKills++
			}
		case sim.EvMissileLaunch:
			if s, ok := r.counted(e.By); ok {
				s.tally.Fired++
			}
		case sim.EvHit:
			if s, ok := r.counted(e.Other); ok && e.Weapon == sim.WMissile {
				s.tally.Hits++
			}
		}
	}
}

// countFlight adds one snapshot interval of flight for every counted pilot
// alive and off the wheels, and marks it airborne in this round. Only round
// play counts: the frozen scoreboard world (Ended) is no flight.
func (r *Room) countFlight(snap sim.Snapshot, phase game.Phase) {
	if r.stats == nil || phase != game.Playing {
		return
	}
	for _, p := range snap.Planes {
		if s, ok := r.counted(p.ID); ok && p.Alive && !p.Ground {
			s.airborne = true
			s.tally.Flight += SnapEvery
			if s.tally.Kinds == nil {
				s.tally.Kinds = map[string]int{}
			}
			s.tally.Kinds[p.Kind.String()] += SnapEvery
		}
	}
}

// countPresence adds one tick of round play for every counted pilot.
func (r *Room) countPresence() {
	if r.stats == nil {
		return
	}
	for id, s := range r.sessions {
		if _, ok := r.counted(id); ok {
			s.roundTicks++
		}
	}
}

// played reports whether s has earned a match this round: MatchTicks of
// presence and airborne at least once.
func (s *session) played() bool { return s.roundTicks >= MatchTicks && s.airborne }

// newRound forgets s's presence in the round that just ended.
func (s *session) newRound() { s.roundTicks, s.airborne, s.flushed = 0, false, false }

// roundOver counts a match (and a win) for every counted pilot who played
// the round, and flushes every counted tally.
func (r *Room) roundOver(rd game.Round) {
	if r.stats == nil {
		return
	}
	teams := r.teams()
	for id, s := range r.sessions {
		if _, ok := r.counted(id); !ok {
			continue
		}
		if s.played() {
			if !s.flushed {
				s.tally.Matches++
			}
			if (rd.WinnerTeam != sim.TeamNone && teams[id] == rd.WinnerTeam) || rd.WinnerID == id {
				s.tally.Wins++
			}
		}
		s.newRound()
		r.flush(s)
	}
}

// leaveCount closes a leaving pilot's tally: a round it played counts as a
// match without a win, so leaving cannot dodge a loss.
func (r *Room) leaveCount(s *session) {
	if _, ok := r.counted(s.id); ok && s.played() && !s.flushed {
		s.tally.Matches++
	}
	s.newRound()
	r.flush(s)
}

// flush hands a session's tally to the sink and starts a new one. A name
// change alone is not recorded.
func (r *Room) flush(s *session) {
	if r.stats == nil || s.pilot == "" || s.tally.Empty() {
		return
	}
	s.tally.Pilot, s.tally.Name = s.pilot, s.name
	r.stats.Record(s.tally)
	s.tally = stats.Delta{}
}
