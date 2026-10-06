package room

import "context"

// FlushStats hands every session's open tally to the stats sink as a leave
// would (a played round counts as a match, without a win) while the players
// stay seated. A draining server calls it before it closes its stats store
// (blue/green deploy), so in-progress sessions are not lost. It reports
// whether the room acknowledged before ctx ended; a stopped room has
// already flushed everything (closeAll) and reports true.
func (r *Room) FlushStats(ctx context.Context) bool {
	ack := make(chan struct{})
	select {
	case r.flushes <- ack:
	case <-r.done:
		return true
	case <-ctx.Done():
		return false
	}
	select {
	case <-ack:
		return true
	case <-ctx.Done():
		return false
	}
}

// flushAll is FlushStats inside the actor: a played round counts as a
// match now (as a leave would), but the round goes on for the seated
// player; after an undrain its end credits the win without a second match.
func (r *Room) flushAll() {
	for id, s := range r.sessions {
		if _, ok := r.counted(id); ok && s.played() && !s.flushed {
			s.tally.Matches++
			s.flushed = true
		}
		r.flush(s)
	}
}
