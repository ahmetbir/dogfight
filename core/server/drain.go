package server

import (
	"context"
	"net/http"
	"sync/atomic"

	"playground/core/wsconn"
	"playground/internal/match"
)

// msgUpdating is the close reason (and API error) of a draining server: a
// new version has taken over, reconnect.
const msgUpdating = "sunucu güncelleniyor, yeniden bağlan"

// drain is the blue/green handover state; the zero value is serving.
type drain struct {
	on   atomic.Bool
	open atomic.Int64 // game sockets past the upgrade
}

// Drain(true) hands the server over to a new version: players already in a
// room play on; every new socket is closed with 1012 (msgUpdating), as is
// each player's socket when its room ends; /api/* answers 503. Drain(false)
// serves again (rollback).
func (s *Server) Drain(on bool) {
	s.drain.on.Store(on)
	s.lobby.Drain(on)
}

// Conns is the number of open game sockets.
func (s *Server) Conns() int { return int(s.drain.open.Load()) }

func (s *Server) draining() bool { return s.drain.on.Load() }

// apiDraining answers 503 while draining and reports whether it did.
func (s *Server) apiDraining(w http.ResponseWriter) bool {
	if !s.draining() {
		return false
	}
	writeJSON(w, http.StatusServiceUnavailable, errorJSON(msgUpdating))
	return true
}

// roomConn is the connection a room holds: when the room closes it while
// the server drains, the close is 1012, so the client reconnects instead of
// stopping on a normal closure.
type roomConn struct {
	*wsconn.Conn
	s *Server
}

func (c roomConn) Close() {
	if c.s.draining() {
		c.Restart(msgUpdating)
		return
	}
	c.Conn.Close()
}

// counted tracks the open game socket requests for Conns.
func (s *Server) counted(next http.HandlerFunc) http.HandlerFunc {
	return func(w http.ResponseWriter, r *http.Request) {
		s.drain.open.Add(1)
		defer s.drain.open.Add(-1)
		next(w, r)
	}
}

// updating closes the handshaking socket with 1012 (msgUpdating); the
// socket handler's later Fail is a no-op on the closed connection.
func (s *Server) updating(p *peer) (*match.Seat, string) {
	p.conn.Restart(msgUpdating)
	return nil, msgUpdating
}

// FlushStats makes every room hand its open tallies to the stats sink (see
// lobby.FlushStats); the drainer calls it before closing the stats store.
func (s *Server) FlushStats(ctx context.Context) bool { return s.lobby.FlushStats(ctx) }
