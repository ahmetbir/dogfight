// Package room runs one match as an actor: a single goroutine owns the game
// and talks to connections only through channels and Sender.
package room

import (
	"context"
	"errors"
	"log/slog"
	"math"
	"sync/atomic"
	"time"

	"playground/internal/game"
	"playground/internal/metrics"
	"playground/internal/protocol"
	"playground/internal/sim"
)

const (
	TickRate     = 60
	SnapEvery    = 2
	EmptyTimeout = 60 * time.Second
	// UnusedTimeout closes a room no human has ever joined (S11).
	UnusedTimeout = 15 * time.Second
	RoundEvery    = 60 // ticks between periodic round broadcasts
	// seatInbox bounds one seat's messages in flight to the room; with at
	// most a dozen seats the shared queue never fills, so one flooding
	// client cannot crowd out the others' inputs.
	seatInbox  = 16
	inputQueue = 256
)

var ErrClosed = errors.New("room: closed")

// Sender is the outbound side of a connection. Send must not block.
type Sender interface {
	Send(v any) bool
	Close()
}

type inputMsg struct {
	seat *Seat
	msg  protocol.ClientMsg
}

type roundKey struct {
	phase                                game.Phase
	nato, soviet, totalKills, totalScore int
	objNATO, objSoviet                   int // base attack HP in 10 HP steps: bars move without a flood of updates
}

// Options are a room's ties to its lobby.
type Options struct {
	Seq     int64             // lobby creation order (newer rooms list first on equal humans)
	Stats   StatsSink         // where pilot tallies go; nil = no counting
	Metrics *metrics.Registry // nil = not measured
}

type Room struct {
	code    string
	game    *game.Game
	static  protocol.Static // welcome terrain and map, encoded once
	seats   int             // every seat, bots included
	seq     int64
	stats   StatsSink
	m       *metrics.Registry
	summary atomic.Pointer[Summary]
	joins   chan joinReq
	leaves  chan sim.ID
	inputs  chan inputMsg
	flushes chan chan struct{} // FlushStats requests; closed reply = done
	done    chan struct{}

	// owned by the Run goroutine
	sessions   map[sim.ID]*session
	events     []protocol.EventJSON
	rosterVer  int
	round      roundKey
	emptySince time.Time
	joined     bool // a human has been seated at least once
}

func New(code string, s game.Settings, o Options) *Room {
	g := game.New(s)
	r := &Room{
		code:     code,
		game:     g,
		static:   protocol.NewStatic(g),
		seats:    len(g.Players()), // New fills every seat with a bot
		seq:      o.Seq,
		stats:    o.Stats,
		m:        o.Metrics,
		joins:    make(chan joinReq),
		leaves:   make(chan sim.ID),
		inputs:   make(chan inputMsg, inputQueue),
		flushes:  make(chan chan struct{}),
		done:     make(chan struct{}),
		sessions: map[sim.ID]*session{},
	}
	r.publish()
	r.gauge(0, int64(r.seats)) // New fills every seat with a bot
	return r
}

func (r *Room) Code() string          { return r.code }
func (r *Room) Mode() string          { return r.game.Settings().Mode.String() }
func (r *Room) Done() <-chan struct{} { return r.done }

// Run is the actor loop. It returns on ctx cancel, after EmptyTimeout with
// no humans (UnusedTimeout if none ever joined), or on a panic; every
// session is closed on the way out.
func (r *Room) Run(ctx context.Context) {
	defer close(r.done)
	defer r.closeAll()
	defer func() {
		if v := recover(); v != nil {
			slog.Error("room panic", "code", r.code, "panic", v)
		}
	}()
	t := time.NewTicker(time.Second / TickRate)
	defer t.Stop()
	r.emptySince = time.Now()
	r.rosterVer = r.game.RosterVersion()
	for {
		select {
		case <-ctx.Done():
			return
		case req := <-r.joins:
			r.join(req)
		case id := <-r.leaves:
			r.leave(id)
		case in := <-r.inputs:
			<-in.seat.slots
			r.input(in.seat.id, in.msg)
		case ack := <-r.flushes:
			r.flushAll()
			close(ack)
		case now := <-t.C:
			if len(r.sessions) == 0 && now.Sub(r.emptySince) >= r.emptyTimeout() {
				return
			}
			r.tick()
		}
	}
}

func (r *Room) emptyTimeout() time.Duration {
	if r.joined {
		return EmptyTimeout
	}
	return UnusedTimeout
}

func (r *Room) closeAll() {
	for _, s := range r.sessions {
		r.flush(s)
		s.out.Close()
	}
	humans := int64(r.game.Humans())
	r.gauge(-humans, -(int64(len(r.game.Players())) - humans))
}

// gauge moves the server-wide human and bot gauges.
func (r *Room) gauge(humans, bots int64) {
	if r.m != nil {
		r.m.Humans.Add(humans)
		r.m.Bots.Add(bots)
	}
}

func (r *Room) input(id sim.ID, m protocol.ClientMsg) {
	s, ok := r.sessions[id]
	if !ok {
		return
	}
	switch m.T {
	case protocol.TIn:
		s.push(m.Seq, m.Input())
	case protocol.TPick:
		if lo, ok := sim.ParseLoadout(m.Lo); ok { // before Pick: a respawning pick takes it at once
			r.game.SetLoadout(id, lo)
		}
		if k, ok := sim.ParseKind(m.Kind); ok {
			_ = r.game.Pick(id, k) // a kind the team may not fly is ignored
		}
	case protocol.TPing:
		s.out.Send(protocol.NewPong(m.TS))
	case protocol.TChat:
		r.chat(id, m.Chat)
	case protocol.TTeam:
		r.team(id, m.Team)
	}
}

func (r *Room) tick() {
	if r.m != nil {
		start := time.Now()
		defer func() {
			d := time.Since(start)
			r.m.TickSeconds.Observe(d.Seconds())
			if d > time.Second/TickRate {
				r.m.TickOverruns.Inc()
			}
		}()
	}
	inputs := make(map[sim.ID]sim.Input, len(r.sessions))
	for id, s := range r.sessions {
		in, _ := s.next()
		if s.lastSeq > 0 { // before its first input the plane keeps its own throttle
			inputs[id] = in
		}
	}
	evs := r.game.Step(inputs)
	r.countEvents(evs)
	tick := r.game.Tick()
	r.events = append(r.events, protocol.NewEvents(evs, tick)...)
	rd := r.game.Round()
	if tick%SnapEvery == 0 {
		world := r.game.Snapshot()
		r.countFlight(world, rd.Phase)
		snap := protocol.NewSnap(world, r.events, tick)
		r.events = nil // snap owns the old slice; sessions share it read-only
		for _, s := range r.sessions {
			ps := snap
			ps.Ack = s.ack
			s.out.Send(ps)
		}
	}
	if r.game.RosterVersion() != r.rosterVer {
		r.broadcastPlayers()
	}
	key := roundKey{phase: rd.Phase, nato: rd.NATO, soviet: rd.Soviet,
		objNATO: int(math.Ceil(rd.ObjNATO / 10)), objSoviet: int(math.Ceil(rd.ObjSoviet / 10))}
	for _, l := range rd.Board {
		key.totalKills += l.Kills
		key.totalScore += l.Score // +2 for a destroyed target is not a kill
	}
	if rd.Phase == game.Playing {
		r.countPresence()
	}
	if r.round.phase == game.Playing && rd.Phase == game.Ended {
		r.roundOver(rd)
	}
	if key != r.round || tick%RoundEvery == 0 {
		r.round = key
		r.broadcast(protocol.NewRound(rd))
	}
	if tick%RoundEvery == 0 {
		r.publish()
	}
}

func (r *Room) broadcastPlayers() {
	r.rosterVer = r.game.RosterVersion()
	r.broadcast(protocol.NewPlayers(r.game.Players()))
}

func (r *Room) broadcast(v any) {
	for _, s := range r.sessions {
		s.out.Send(v)
	}
}
