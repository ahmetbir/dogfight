package server

import (
	"encoding/json"
	"testing"
	"time"

	"playground/internal/protocol"
)

// roomCode creates a room and returns its code; the creator stays seated.
func roomCode(t *testing.T, srv string) string {
	t.Helper()
	c := &client{t: t}
	c.ws, _ = rawDial(t, srv, nil)
	c.ws.SetReadLimit(1 << 20)
	c.send(hello("host"))
	c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 6, Diff: "easy"})
	var w protocol.Welcome
	json.Unmarshal(c.until("welcome", 5*time.Second, nil), &w)
	return w.Code
}

// Successful joins are limited per address: a public room code must not let
// one client churn a room's seats (and its bots) as fast as it can dial.
func TestJoinsPerIP(t *testing.T) {
	srv := newServer(t, Options{Web: web, Limits: tight(func(l *Limits) { l.JoinPerMinIP = 2 })})
	code := roomCode(t, srv.URL)
	join := func(code string) *client {
		c := dial(t, srv)
		c.send(hello("y"))
		c.send(protocol.ClientMsg{T: protocol.TJoin, Code: code})
		return c
	}
	// A join that finds no room spends a failed-join token, not a join token.
	expectError(t, join("ZZZZ"), msgNoRoom)
	for range 2 {
		c := join(code)
		c.until("welcome", 5*time.Second, nil)
		c.ws.CloseNow()
	}
	expectError(t, join(code), msgJoins)
}
