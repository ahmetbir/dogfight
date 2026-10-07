package front

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/server"
	"playground/internal/protocol"
)

// welcomeOf reads the welcome: my id, the room code and a token the server
// issued (empty when it kept mine).
func (c *client) welcomeOf() (you int, code, tok string) {
	var w struct {
		You  int
		Code string
		Tok  string
	}
	_ = json.Unmarshal(c.until("welcome", 5*time.Second, nil), &w)
	return w.You, w.Code, w.Tok
}

// lobbyWhere reads lobby messages until ok accepts one.
func (c *client) lobbyWhere(ok func(protocol.LobbyMsg) bool) protocol.LobbyMsg {
	var l protocol.LobbyMsg
	c.until("lobby", 5*time.Second, func(b []byte) bool { return json.Unmarshal(b, &l) == nil && ok(l) })
	return l
}

func entryOf(l protocol.LobbyMsg, id int) (protocol.LobbyEntryJSON, bool) {
	for _, e := range l.List {
		if int(e.ID) == id {
			return e, true
		}
	}
	return protocol.LobbyEntryJSON{}, false
}

// Through the real handshake: the host and a friend share NATO, the friend
// flies an F-15; both drop and come back with their pilot tokens (the
// client's reconnect: hello with tok, join by code). The host is the host
// again, and the friend is back on NATO in the F-15, not auto-balanced to
// Soviet with its default jet.
func TestLobbyReturnThroughHandshake(t *testing.T) {
	srv := newServer(t, server.Options{Web: web})
	a := dial(t, srv)
	a.send(hello("host"))
	a.send(protocol.ClientMsg{T: protocol.TCreate, Mode: "team", Size: 2, Diff: "easy"})
	_, code, aTok := a.welcomeOf()
	b := dial(t, srv)
	b.send(hello("friend"))
	b.send(protocol.ClientMsg{T: protocol.TJoin, Code: code})
	bID, _, bTok := b.welcomeOf()
	if aTok == "" || bTok == "" {
		t.Fatal("the server issues tokens to new pilots")
	}
	b.send(protocol.ClientMsg{T: protocol.TSide, Team: "nato"})
	b.send(protocol.ClientMsg{T: protocol.TPick, Kind: "f15"})
	a.lobbyWhere(func(l protocol.LobbyMsg) bool {
		e, ok := entryOf(l, bID)
		return ok && e.Team == "nato" && e.Kind == "f15"
	})

	b.ws.CloseNow()
	a.lobbyWhere(func(l protocol.LobbyMsg) bool { _, ok := entryOf(l, bID); return !ok })
	b2 := dial(t, srv)
	b2.send(protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: "friend", Tok: bTok})
	b2.send(protocol.ClientMsg{T: protocol.TJoin, Code: code})
	b2ID, _, _ := b2.welcomeOf()
	l := b2.lobbyWhere(func(protocol.LobbyMsg) bool { return true })
	if e, _ := entryOf(l, b2ID); e.Team != "nato" || e.Kind != "f15" {
		t.Fatalf("the friend came back as %+v", e)
	}

	a.ws.CloseNow()
	b2.lobbyWhere(func(l protocol.LobbyMsg) bool { return int(l.Host) == b2ID })
	a2 := dial(t, srv)
	a2.send(protocol.ClientMsg{T: protocol.THello, V: protocol.Version, Name: "host", Tok: aTok})
	a2.send(protocol.ClientMsg{T: protocol.TJoin, Code: code})
	a2ID, _, _ := a2.welcomeOf()
	b2.lobbyWhere(func(l protocol.LobbyMsg) bool { return int(l.Host) == a2ID })
}
