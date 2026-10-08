package front

import (
	"context"
	"encoding/json"
	"errors"
	"net/http/httptest"
	"strings"
	"testing"
	"time"

	"github.com/coder/websocket"

	"github.com/ahmetbir/roomkit/server"
	"playground/internal/match"
	"playground/internal/protocol"
)

// drainServer is a test server whose *Server (Drain, Conns) and lobby
// context are reachable.
func drainServer(t *testing.T) (*httptest.Server, *Server, *match.Lobby, context.CancelFunc) {
	t.Helper()
	ctx, cancel := context.WithCancel(context.Background())
	lb := match.NewLobby(ctx, 0, nil, nil, nil, match.Moderation{})
	s := NewServer(lb, server.Options{Web: web, Limits: server.Limits{MaxConnsIP: 1000, CreatePerMinIP: 1000, JoinFailPerMinIP: 1000, JoinPerMinIP: 1000}})
	srv := httptest.NewServer(s)
	t.Cleanup(func() { cancel(); srv.Close() })
	return srv, s, lb, cancel
}

// expectRestart fails unless the server closes c with 1012 and msgUpdating.
func expectRestart(t *testing.T, c *client) {
	t.Helper()
	ctx, cancel := context.WithTimeout(t.Context(), 5*time.Second)
	defer cancel()
	for {
		_, b, err := c.ws.Read(ctx)
		if err == nil {
			var h struct{ T string }
			json.Unmarshal(b, &h)
			if h.T == "error" {
				t.Fatalf("draining server sent an error message: %s", b)
			}
			continue
		}
		var ce websocket.CloseError
		if !errors.As(err, &ce) || ce.Code != websocket.StatusServiceRestart || ce.Reason != msgUpdating {
			t.Fatalf("want close 1012 %q, got %v", msgUpdating, err)
		}
		return
	}
}

func waitConns(t *testing.T, s *Server, want int) {
	t.Helper()
	deadline := time.Now().Add(3 * time.Second)
	for s.Conns() != want {
		if time.Now().After(deadline) {
			t.Fatalf("conns %d, want %d", s.Conns(), want)
		}
		time.Sleep(5 * time.Millisecond)
	}
}

func createRoom(t *testing.T, srv *httptest.Server) (*client, string) {
	t.Helper()
	c := dial(t, srv)
	c.send(hello("Ace"))
	c.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"})
	var w protocol.Welcome
	json.Unmarshal(c.until("welcome", 5*time.Second, nil), &w)
	return c, w.Code
}

// Draining keeps the players already in rooms, refuses every new socket
// (also a join to a running room) with 1012, and answers the API with 503.
func TestDrainKeepsPlayersRefusesNewcomers(t *testing.T) {
	srv, s, _, _ := drainServer(t)
	a, code := createRoom(t, srv)
	waitConns(t, s, 1)

	s.Drain(true)
	for _, entry := range []protocol.ClientMsg{
		{T: protocol.TCreate, Mode: "ffa", Size: 2, Diff: "easy"},
		{T: protocol.TJoin, Code: code},
		{T: protocol.TQuick},
	} {
		b := dial(t, srv)
		b.send(hello("Bravo"))
		b.send(entry)
		expectRestart(t, b)
	}
	status, body := get(t, srv.URL+"/api/rooms")
	if status != 503 || !strings.Contains(body, msgUpdating) {
		t.Fatalf("/api/rooms while draining: %d %s", status, body)
	}

	a.send(protocol.ClientMsg{T: protocol.TPing, TS: 7}) // the old player plays on
	a.until("pong", 2*time.Second, nil)
	waitConns(t, s, 1)
	a.ws.Close(websocket.StatusNormalClosure, "")
	waitConns(t, s, 0)

	s.Drain(false)
	createRoom(t, srv) // undrain: new rooms again
	if status, _ := get(t, srv.URL+"/api/rooms"); status != 200 {
		t.Fatalf("/api/rooms after undrain: %d", status)
	}
}

// When a draining server finally stops (30 min cap), its players get 1012,
// so they reconnect to the new server instead of seeing an error.
func TestDrainStopClosesWith1012(t *testing.T) {
	srv, s, _, stop := drainServer(t)
	a, _ := createRoom(t, srv)
	s.Drain(true)
	stop() // rooms end on the lobby context, as on shutdown
	expectRestart(t, a)
}
