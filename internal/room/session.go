package room

import (
	"playground/internal/sim"
	"playground/internal/stats"
)

const (
	queueCap  = 8 // inputs buffered per player
	queueKeep = 4 // backlog above this is dropped at tick time
)

// session is one connected human, owned by the room goroutine.
type session struct {
	id      sim.ID
	out     Sender
	queue   []sim.Input
	seqs    []uint32
	last    sim.Input
	lastSeq uint32 // highest seq accepted
	ack     uint32 // seq of the input last applied
	chatAt  int    // game tick of the last chat relayed; 0 = never
	pilot   string // token hash; "" = not counted
	name    string // roster name, reported with the tally
	tally   stats.Delta
	// this round's play, for the match rule (see played)
	roundTicks int
	airborne   bool
}

func newSession(id sim.ID, out Sender) *session {
	return &session{
		id:    id,
		out:   out,
		queue: make([]sim.Input, 0, queueCap),
		seqs:  make([]uint32, 0, queueCap),
	}
}

// push queues an input; duplicates and out-of-order seqs are dropped, and a
// full queue loses its oldest entry.
func (s *session) push(seq uint32, in sim.Input) {
	if seq <= s.lastSeq {
		return
	}
	s.lastSeq = seq
	if len(s.queue) == queueCap {
		s.drop(1)
	}
	s.queue = append(s.queue, in)
	s.seqs = append(s.seqs, seq)
}

// next pops the input for this tick, dropping a backlog beyond queueKeep.
// With an empty queue it repeats the last input without its one-shot
// presses and reports false.
func (s *session) next() (sim.Input, bool) {
	if len(s.queue) == 0 {
		return s.last, false
	}
	if n := len(s.queue) - queueKeep; n > 0 {
		s.drop(n)
	}
	in := s.queue[0]
	s.ack = s.seqs[0]
	s.queue = append(s.queue[:0], s.queue[1:]...)
	s.seqs = append(s.seqs[:0], s.seqs[1:]...)
	// Kept for repeats while starved: held controls carry over, one-shot
	// presses (missile, flare, bomb) do not.
	s.last = in
	s.last.Missile, s.last.Flare, s.last.Bomb = false, false, false
	return in, true
}

// drop removes the n oldest queued inputs; their one-shot presses (missile,
// flare, bomb) carry over to the oldest kept input so a backlog never eats
// them.
func (s *session) drop(n int) {
	kept := &s.queue[n]
	for _, in := range s.queue[:n] {
		kept.Missile = kept.Missile || in.Missile
		kept.Flare = kept.Flare || in.Flare
		kept.Bomb = kept.Bomb || in.Bomb
	}
	s.queue = append(s.queue[:0], s.queue[n:]...)
	s.seqs = append(s.seqs[:0], s.seqs[n:]...)
}
