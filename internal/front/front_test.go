package front

import (
	"encoding/json"
	"testing"
	"time"

	"github.com/ahmetbir/roomkit/room"
	"github.com/ahmetbir/roomkit/server"
	"playground/internal/game"
	"playground/internal/match"
	"playground/internal/protocol"
	"playground/internal/sim"
)

var _ server.Kit[game.Settings, protocol.ClientMsg, match.Info] = Kit{}

func TestKitClassesAndInRoom(t *testing.T) {
	k := Kit{}
	if k.Class(protocol.TPick) != server.ClassChoice || k.Class(protocol.TTeam) != server.ClassChoice || k.Class(protocol.TChat) != server.ClassAll {
		t.Fatal("classes")
	}
	for m, want := range map[protocol.ClientMsg]bool{
		{T: protocol.TTeam, Team: "nato"}: true,
		{T: protocol.TPick, Kind: "su27"}: true,
		{T: protocol.TPick, Kind: "x"}:    false,
		{T: protocol.TQuick}:              false,
		{T: protocol.THello}:              false,
	} {
		if k.InRoom(m) != want {
			t.Errorf("InRoom(%+v) != %v", m, want)
		}
	}
	if k.Version() != 2 {
		t.Fatal("version")
	}
}

// Every kind of the sim is a valid pick on the wire; anything else is not in
// the room's vocabulary, so the core closes that connection ("bad"), as it
// always did for unknown kinds. The new jets needed no protocol version bump.
func TestPickOfEveryKindPassesUnknownIsRefused(t *testing.T) {
	k := Kit{}
	for _, kind := range sim.Kinds() {
		if !k.InRoom(protocol.ClientMsg{T: protocol.TPick, Kind: kind.String()}) {
			t.Errorf("pick %q refused", kind)
		}
	}
	for _, bad := range []string{"zeppelin", "F16", "", "su-27", "mig31 "} {
		if k.InRoom(protocol.ClientMsg{T: protocol.TPick, Kind: bad}) {
			t.Errorf("pick %q accepted", bad)
		}
	}
}

func TestRowBytes(t *testing.T) {
	team := room.Summary[match.Info]{Code: "ABCD", Info: room.Info[match.Info]{Humans: 1, Seats: 4,
		Game: match.Info{Mode: "team", Map: "ada", Weather: "acik", Phase: "playing", LeftS: 42, NATO: 1}}}
	b, _ := json.Marshal(Kit{}.Row(team))
	if string(b) != `{"code":"ABCD","mode":"team","map":"ada","wx":"acik","humans":1,"seats":4,"phase":"playing","left":42,"teams":[1,0]}` {
		t.Fatal(string(b))
	}
	ffa := team
	ffa.Game.Mode = "ffa"
	b, _ = json.Marshal(Kit{}.Row(ffa))
	if string(b) != `{"code":"ABCD","mode":"ffa","map":"ada","wx":"acik","humans":1,"seats":4,"phase":"playing","left":42}` {
		t.Fatal(string(b))
	}
}

// Review Focus 3: stats off must be a nil interface, not a typed nil.
func TestNewStatsNilIsNilInterface(t *testing.T) {
	if NewStats(nil) != nil {
		t.Fatal("NewStats(nil) must be a nil server.Stats")
	}
}

func TestQuickSettings(t *testing.T) {
	s := Kit{}.QuickSettings(time.Unix(0, 7))
	if s.Seed != 7 || !s.Listed || s.Size != 2 {
		t.Fatalf("%+v", s)
	}
}
