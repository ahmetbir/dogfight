package room

import (
	"playground/internal/sim"
	"playground/internal/stats"
)

// session is one connected human, owned by the room goroutine.
type session struct {
	id     sim.ID
	out    Sender
	q      queue[sim.Input]
	chatAt int    // game tick of the last chat relayed; 0 = never
	pilot  string // token hash; "" = not counted
	name   string // roster name, reported with the tally
	tally  stats.Delta
	// this round's play, for the match rule (see played)
	roundTicks int
	airborne   bool
	flushed    bool // a drain flush already counted this round's match
}

func newSession(id sim.ID, out Sender) *session {
	return &session{
		id:  id,
		out: out,
		q:   newQueue[sim.Input](),
	}
}
