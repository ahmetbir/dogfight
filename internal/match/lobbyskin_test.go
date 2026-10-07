package match

import (
	"testing"

	"github.com/ahmetbir/roomkit/room"
	"playground/internal/protocol"
	"playground/internal/sim"
)

func lobbyEntry(t *testing.T, m *Match, id room.PlayerID) protocol.LobbyEntryJSON {
	t.Helper()
	for _, e := range m.lobbyMsg().List {
		if e.ID == sim.ID(id) {
			return e
		}
	}
	t.Fatalf("no lobby entry %d", id)
	return protocol.LobbyEntryJSON{}
}

// The lobby list shows each human's paint; a side change gives the new
// side's jet its own paint (never the old jet's scheme); Start flies the
// lobby pick in its paint.
func TestLobbyListSideChangeAndStartCarryTheSkin(t *testing.T) {
	m := New(lobby2, nil)
	b := &box{}
	h, _ := m.Join(room.Who{Name: "host", Pilot: "ph"})
	if err := m.g.SetSide(sim.ID(h), sim.TeamSoviet); err != nil {
		t.Fatal(err)
	}
	m.Handle(h, protocol.ClientMsg{T: protocol.TPick, Kind: "su27", Skin: "flanker"}, b)
	if e := lobbyEntry(t, m, h); e.Kind != "su27" || e.Skin != "flanker" {
		t.Fatalf("lobby entry %+v", e)
	}
	if err := m.g.SetSide(sim.ID(h), sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	if e := lobbyEntry(t, m, h); e.Kind == "su27" || e.Skin != "" {
		t.Fatalf("after the side change %+v", e)
	}
	if err := m.g.SetSide(sim.ID(h), sim.TeamSoviet); err != nil {
		t.Fatal(err)
	}
	m.Handle(h, protocol.ClientMsg{T: protocol.TPick, Kind: "su27"}, b) // an older client: no skin
	if e := lobbyEntry(t, m, h); e.Skin != "" {
		t.Fatalf("no skin sent %+v", e)
	}
	m.Handle(h, protocol.ClientMsg{T: protocol.TPick, Kind: "su27", Skin: "flanker"}, b)
	if err := m.g.Start(sim.ID(h)); err != nil {
		t.Fatal(err)
	}
	p := playerOf(t, m, h)
	var flying sim.Kind
	for _, pl := range m.g.Snapshot().Planes {
		if pl.ID == sim.ID(h) {
			flying = pl.Kind
		}
	}
	if flying != sim.Su27 || p.Skin != "flanker" || p.FlySkin != "" {
		t.Fatalf("after Start: flying %v, player %+v", flying, p)
	}
}

// A pilot who drops in the lobby gets its paint back with its jet.
func TestLobbyReturnKeepsTheSkin(t *testing.T) {
	m := New(lobby2, nil)
	b := &box{}
	m.Join(room.Who{Name: "host", Pilot: "ph"})
	f, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	if err := m.g.SetSide(sim.ID(f), sim.TeamNATO); err != nil {
		t.Fatal(err)
	}
	m.Handle(f, protocol.ClientMsg{T: protocol.TPick, Kind: "f14", Skin: "blackband"}, b)
	m.Leave(f)
	back, _ := m.Join(room.Who{Name: "friend", Pilot: "pf"})
	if p := playerOf(t, m, back); p.Kind != sim.F14 || p.Skin != "blackband" {
		t.Fatalf("back as %+v", p)
	}
}
