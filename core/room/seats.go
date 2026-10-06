package room

import (
	"context"
	"time"

	"playground/internal/protocol"
	"playground/internal/sim"
)

type joinReq struct {
	who   Who
	out   Sender
	reply chan joinResp
}

type joinResp struct {
	id  sim.ID
	err error
}

// Join seats a human. It fails with ErrClosed if the room has stopped,
// game.ErrFull if no bot seat is left, or ctx's error.
func (r *Room) Join(ctx context.Context, who Who, out Sender) (*Seat, error) {
	req := joinReq{who: who, out: out, reply: make(chan joinResp, 1)}
	select {
	case r.joins <- req:
	case <-r.done:
		return nil, ErrClosed
	case <-ctx.Done():
		return nil, ctx.Err()
	}
	// The actor answers right away; waiting on ctx here could orphan a seat.
	var resp joinResp
	select {
	case resp = <-req.reply:
	case <-r.done:
		return nil, ErrClosed
	}
	if resp.err != nil {
		return nil, resp.err
	}
	return &Seat{id: resp.id, r: r, slots: make(chan struct{}, seatInbox)}, nil
}

// Seat is one joined human's handle on the room, used by its connection
// goroutine only.
type Seat struct {
	id    sim.ID
	r     *Room
	slots chan struct{} // messages in flight; the room frees one per message
}

func (s *Seat) ID() sim.ID { return s.id }

// Done is closed when the room stops.
func (s *Seat) Done() <-chan struct{} { return s.r.done }

// Input hands a client message to the room. It drops the message if this
// seat already has seatInbox messages waiting, or the room is busy.
func (s *Seat) Input(m protocol.ClientMsg) {
	select {
	case s.slots <- struct{}{}:
	default:
		return
	}
	select {
	case s.r.inputs <- inputMsg{s, m}:
	case <-s.r.done:
	default:
		<-s.slots
	}
}

func (s *Seat) Leave() {
	select {
	case s.r.leaves <- s.id:
	case <-s.r.done:
	}
}

func (r *Room) join(req joinReq) {
	id, err := r.game.AddHuman(req.who.Name)
	if err != nil {
		req.reply <- joinResp{err: err}
		return
	}
	s := newSession(id, req.out)
	s.pilot = req.who.Pilot
	for _, p := range r.game.Players() {
		if p.ID == id {
			s.name = p.Name // the roster's cleaned name
		}
	}
	r.sessions[id] = s
	r.joined = true
	r.gauge(+1, -1) // the human took a bot's seat
	r.publish()     // before the reply: a lobby read after Join sees the seat
	req.reply <- joinResp{id: id}
	w := protocol.NewWelcome(id, r.code, r.game, r.static)
	w.Tok = req.who.NewToken
	s.out.Send(w)
	r.broadcastPlayers()
	s.out.Send(protocol.NewRound(r.game.Round()))
}

func (r *Room) leave(id sim.ID) {
	s, ok := r.sessions[id]
	if !ok {
		return
	}
	r.leaveCount(s)
	delete(r.sessions, id)
	r.game.RemoveHuman(id)
	r.gauge(-1, +1) // a bot takes the seat back
	if len(r.sessions) == 0 {
		r.emptySince = time.Now()
	}
	r.publish()
}
