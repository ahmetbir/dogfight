package front

import (
	"encoding/json"
	"net/http"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/server"
	"playground/internal/protocol"
)

// A team message reaches the room (the lobby list shows the new split); an
// unknown team ends the connection like any malformed message.
func TestTeamMessageEndToEnd(t *testing.T) {
	now := time.Unix(1000, 0)
	srv := newServer(t, server.Options{Now: func() time.Time { return now }})
	c := dial(t, srv)
	c.send(hello("a"))
	c.send(protocol.ClientMsg{T: "create", Mode: "team", Size: 2, Diff: "easy"})
	c.until("welcome", 2*time.Second, nil)
	c.send(protocol.ClientMsg{T: protocol.TTeam, Team: "soviet"})
	c.until("players", 2*time.Second, func(b []byte) bool {
		var m protocol.PlayersMsg
		_ = json.Unmarshal(b, &m)
		for _, p := range m.List {
			if !p.Bot && p.Team == "soviet" {
				return true
			}
		}
		return false
	})
	now = now.Add(1100 * time.Millisecond)
	res, err := http.Get(srv.URL + "/api/rooms")
	if err != nil {
		t.Fatal(err)
	}
	var body struct {
		Rooms []struct {
			Teams *[2]int `json:"teams"`
		} `json:"rooms"`
	}
	_ = json.NewDecoder(res.Body).Decode(&body)
	res.Body.Close()
	if len(body.Rooms) != 1 || body.Rooms[0].Teams == nil || *body.Rooms[0].Teams != [2]int{0, 1} {
		t.Fatalf("rooms %+v", body.Rooms)
	}
	c.writeRaw(`{"t":"team","team":"martian"}`)
	if !c.closed(2 * time.Second) {
		t.Fatal("an unknown team must end the connection")
	}
}
