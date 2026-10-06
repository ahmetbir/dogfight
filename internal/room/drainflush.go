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

// flushAll is FlushStats inside the actor.
func (r *Room) flushAll() {
	for _, s := range r.sessions {
		r.leaveCount(s)
	}
}
