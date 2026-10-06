package room

import (
	"testing"

	"playground/internal/protocol"
	"playground/internal/sim"
)

func TestSessionQueue(t *testing.T) {
	s := newSession(1, &fakeSender{})
	if _, ok := s.q.next(); ok {
		t.Fatal("empty session produced a fresh input")
	}
	for seq := uint32(1); seq <= 9; seq++ {
		s.q.push(seq, protocol.ClientMsg{Th: float64(seq) / 10}.Input())
	}
	s.q.push(2, protocol.ClientMsg{Th: 1}.Input()) // out of order
	in, ok := s.q.next()
	if !ok || s.q.ack != 6 || in.Throttle != 0.6 {
		t.Fatalf("after backlog: ack=%d th=%v", s.q.ack, in.Throttle)
	}
	for range 3 {
		s.q.next()
	}
	if s.q.ack != 9 {
		t.Fatalf("ack=%d", s.q.ack)
	}
	in, ok = s.q.next()
	if ok || in.Throttle != 0.9 || s.q.ack != 9 {
		t.Fatalf("repeat-last: ok=%v th=%v ack=%d", ok, in.Throttle, s.q.ack)
	}
}

// Missile and flare are one-shot presses: inputs dropped from a backlog
// (queue overflow or trim) hand their presses to the next kept input.
func TestSessionBacklogLatchesPresses(t *testing.T) {
	s := newSession(1, &fakeSender{})
	for seq := uint32(1); seq <= 9; seq++ {
		in := protocol.ClientMsg{Th: float64(seq) / 10}.Input()
		in.Missile = seq == 1 // lost to queue overflow
		in.Flare = seq == 3   // lost to the trim at tick time
		s.q.push(seq, in)
	}
	in, ok := s.q.next()
	if !ok || s.q.ack != 6 || !in.Missile || !in.Flare {
		t.Fatalf("kept input: ack=%d missile=%v flare=%v", s.q.ack, in.Missile, in.Flare)
	}
	in, _ = s.q.next()
	if in.Missile || in.Flare {
		t.Fatalf("presses repeated: missile=%v flare=%v", in.Missile, in.Flare)
	}
}

// A starved queue repeats the last input, but never its one-shot presses.
func TestRepeatedInputDropsPresses(t *testing.T) {
	s := newSession(1, &fakeSender{})
	in := protocol.ClientMsg{Th: 0.7}.Input()
	in.Missile, in.Flare, in.Fire = true, true, true
	s.q.push(1, in)
	got, ok := s.q.next()
	if !ok || !got.Missile || !got.Flare {
		t.Fatalf("fresh input lost presses: %+v", got)
	}
	got, ok = s.q.next()
	if ok || got.Missile || got.Flare || !got.Fire || got.Throttle != 0.7 {
		t.Fatalf("repeated input: ok=%v %+v", ok, got)
	}
}

// One flooding seat holds at most seatInbox slots of the shared queue, so
// another seat's input still gets in.
func TestSeatInboxBounded(t *testing.T) {
	r := New("ABCD", ffa4, Options{}) // not running: nothing drains the queue
	a := &Seat{id: 1, r: r, slots: make(chan struct{}, seatInbox)}
	b := &Seat{id: 2, r: r, slots: make(chan struct{}, seatInbox)}
	for range 10 * inputQueue {
		a.Input(protocol.ClientMsg{T: protocol.TIn})
	}
	if len(r.inputs) != seatInbox {
		t.Fatalf("flooding seat queued %d, want %d", len(r.inputs), seatInbox)
	}
	b.Input(protocol.ClientMsg{T: protocol.TIn})
	if len(r.inputs) != seatInbox+1 {
		t.Fatal("second seat starved")
	}
}

func TestBacklogKeepsBomb(t *testing.T) {
	s := newSession(1, nil)
	s.q.push(1, sim.Input{Bomb: true})
	for seq := uint32(2); seq <= 8; seq++ {
		s.q.push(seq, sim.Input{})
	}
	in, _ := s.q.next()
	if !in.Bomb {
		t.Fatal("a dropped backlog must not eat the bomb press")
	}
	s.q.items, s.q.seqs = s.q.items[:0], s.q.seqs[:0]
	if rep, _ := s.q.next(); rep.Bomb {
		t.Fatal("starved repeats drop one-shot presses")
	}
}

// A missile press in an input the connection's rate bucket dropped rides on
// the next admitted input (the server's latch is ClientMsg.Latch), then
// survives the room's backlog trim (queue.drop uses Input.Latch).
func TestDroppedPressSurvivesBothLatches(t *testing.T) {
	dropped := protocol.ClientMsg{T: protocol.TIn, Seq: 2, M: true}
	admitted := protocol.ClientMsg{T: protocol.TIn, Seq: 3}.Latch(dropped)
	s := newSession(1, nil)
	s.q.push(1, protocol.ClientMsg{T: protocol.TIn, Seq: 1}.Input())
	s.q.push(admitted.Seq, admitted.Input())
	for seq := uint32(4); seq <= 9; seq++ { // backlog: the trim drops seqs 1, 3, 4 and 5
		s.q.push(seq, protocol.ClientMsg{T: protocol.TIn, Seq: seq}.Input())
	}
	fired := 0
	for range 8 {
		if in, ok := s.q.next(); ok && in.Missile {
			fired++
		}
	}
	if fired != 1 {
		t.Fatalf("missile fired %d times, want 1", fired)
	}
}
