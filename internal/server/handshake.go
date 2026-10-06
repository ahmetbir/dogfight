package server

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"time"

	"playground/core/limit"
	"playground/core/lobby"
	"playground/core/netproto"
	"playground/core/pilot"
	"playground/core/room"
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/match"
	"playground/internal/mode"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

// handshake reads hello then create|join|quick and seats the player. On failure
// it returns the user-facing error text.
func (s *Server) handshake(ctx context.Context, p *peer) (*match.Seat, string) {
	m, err := s.recv(ctx, p)
	if err != nil {
		return nil, s.msgOf(err, p)
	}
	if m.T != protocol.THello {
		return nil, msgBad
	}
	if m.V != protocol.Version {
		return nil, msgVersion
	}
	who := identify(netproto.CleanName(m.Name), m.Tok)

	m, err = s.recv(ctx, p)
	if err != nil {
		return nil, s.msgOf(err, p)
	}
	if s.draining() {
		return s.updating(p)
	}
	var rm *match.Room
	switch m.T {
	case protocol.TCreate:
		st, ok := settings(m, s.o.Now())
		if !ok {
			return nil, msgBadRoom
		}
		var msg string
		if rm, msg = s.create(p, st); msg != "" {
			return nil, msg
		}
	case protocol.TQuick:
		if seat, msg, done := s.quickJoin(ctx, p, who); done {
			return seat, msg
		}
		var msg string
		if rm, msg = s.create(p, quickSettings(s.o.Now())); msg != "" {
			return nil, msg
		}
	case protocol.TJoin:
		if s.joinFails.Blocked(p.key, s.o.Now()) {
			s.rejects.note(s.keyedReason(s.joinFails, p.key, "join-fail-rate"), p.ip)
			return nil, msgJoins
		}
		// Like creates: take the token first, give it back if no room is
		// found (that attempt is counted as a failed join instead).
		if !s.joins.Allow(p.key, s.o.Now()) {
			s.rejects.note(s.keyedReason(s.joins, p.key, "join-rate"), p.ip)
			return nil, msgJoins
		}
		var ok bool
		if rm, ok = s.lobby.Get(m.Code); !ok {
			s.joins.Refund(p.key, s.o.Now())
			s.joinFails.Allow(p.key, s.o.Now())
			return nil, msgNoRoom
		}
	default:
		return nil, msgBad
	}

	seat, err := rm.Join(ctx, who, roomConn{p.conn, s})
	switch {
	case errors.Is(err, game.ErrFull):
		return nil, msgFull
	case errors.Is(err, room.ErrClosed):
		return nil, msgNoRoom
	case err != nil:
		return nil, s.msgOf(err, p)
	}
	return seat, ""
}

// identify is the hello's player: a valid token is kept, anything else is
// replaced by a fresh one that the welcome hands back. Only the hash is kept.
func identify(name, tok string) room.Who {
	fresh := ""
	if !pilot.Valid(tok) {
		tok = pilot.New()
		fresh = tok
	}
	return room.Who{Name: name, Pilot: pilot.Hash(tok), NewToken: fresh}
}

// create makes a room under the address's create limit. On failure it
// returns the user-facing error text.
func (s *Server) create(p *peer, st game.Settings) (*match.Room, string) {
	// Take the token first (check and spend in one step, so concurrent
	// creates cannot share one); a create that fails gives it back.
	if !s.creates.Allow(p.key, s.o.Now()) {
		s.rejects.note(s.keyedReason(s.creates, p.key, "create-rate"), p.ip)
		return nil, msgCreates
	}
	rm, err := s.lobby.Create(st)
	if err != nil {
		s.creates.Refund(p.key, s.o.Now()) // a full server costs no create token
	}
	switch {
	case errors.Is(err, lobby.ErrDraining):
		p.conn.Restart(msgUpdating) // the caller's fail is then a no-op
		return nil, msgUpdating
	case errors.Is(err, lobby.ErrBusy):
		s.rejects.note("max-rooms", p.ip)
		return nil, msgBusy
	case err != nil:
		slog.Error("create room", "err", err)
		return nil, msgNoCreate
	}
	return rm, ""
}

// quickJoin joins the room quick play picks, under the address's join
// limit. done is false when no listed room has a free seat, or the picked
// one filled or closed before the join (its token is given back): the
// caller then makes a new room.
func (s *Server) quickJoin(ctx context.Context, p *peer, who room.Who) (seat *match.Seat, msg string, done bool) {
	r, ok := s.quickPick()
	if !ok {
		return nil, "", false
	}
	if !s.joins.Allow(p.key, s.o.Now()) {
		s.rejects.note(s.keyedReason(s.joins, p.key, "join-rate"), p.ip)
		return nil, msgJoins, true
	}
	seat, err := r.Join(ctx, who, roomConn{p.conn, s})
	switch {
	case err == nil:
		return seat, "", true
	case errors.Is(err, game.ErrFull), errors.Is(err, room.ErrClosed):
		s.joins.Refund(p.key, s.o.Now())
		return nil, "", false
	}
	return nil, s.msgOf(err, p), true
}

// quickSettings is the room quick play makes when none is free (spec §9.2).
func quickSettings(now time.Time) game.Settings {
	return game.Settings{Mode: mode.Team, Size: 2, Difficulty: bot.Normal, Seed: now.UnixNano(),
		Map: maps.Ada, Weather: weather.Clear, Start: sim.StartAir, Listed: true}
}

// keyedReason names a Keyed refusal: its own reason, or "limiter-full" when
// the table refused a new address (key) because it is at capacity.
func (s *Server) keyedReason(k *limit.Keyed, key, reason string) string {
	if k.Full() && !k.Known(key) {
		return "limiter-full"
	}
	return reason
}

// settings builds room settings from a create message; missing optional
// fields take the spec §8 defaults (ada, acik, hava, acik). Unknown values
// of any field are refused.
func settings(m protocol.ClientMsg, now time.Time) (game.Settings, bool) {
	k, ok1 := mode.ParseKind(m.Mode)
	d, ok2 := bot.ParseDifficulty(m.Diff)
	mk, ok3 := orDefault(m.Map, "ada", maps.ParseKind)
	wk, ok4 := orDefault(m.Wx, "acik", weather.ParseKind)
	start, ok5 := orDefault(m.Start, "hava", parseStart)
	listed, ok6 := orDefault(m.Vis, "acik", parseVis)
	seed := m.Seed
	if seed == 0 {
		seed = now.UnixNano()
	}
	return game.Settings{Mode: k, Size: m.Size, Difficulty: d, Seed: seed, Map: mk, Weather: wk, Start: start, Listed: listed},
		ok1 && ok2 && ok3 && ok4 && ok5 && ok6
}

func orDefault[T any](s, def string, parse func(string) (T, bool)) (T, bool) {
	if s == "" {
		s = def
	}
	return parse(s)
}

func parseStart(s string) (sim.StartMode, bool) {
	switch s {
	case "pist":
		return sim.StartRunway, true
	case "hava":
		return sim.StartAir, true
	}
	return 0, false
}

func parseVis(s string) (bool, bool) { return s == "acik", s == "acik" || s == "ozel" }

// recv waits for the next handshake message, answering pings on the way.
func (s *Server) recv(ctx context.Context, p *peer) (protocol.ClientMsg, error) {
	for {
		select {
		case <-ctx.Done():
			return protocol.ClientMsg{}, errTimeout
		case b, ok := <-p.conn.Recv():
			if !ok {
				return protocol.ClientMsg{}, net.ErrClosed
			}
			m, err := s.next(p, b)
			if err != nil {
				return m, err
			}
			if m.T == protocol.TPing {
				p.conn.Send(netproto.NewPong(m.TS))
				continue
			}
			return m, nil
		}
	}
}
