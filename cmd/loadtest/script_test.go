package main

import (
	"sync/atomic"
	"testing"

	"playground/internal/protocol"
)

func TestReactPicksOnceForOwnTeam(t *testing.T) {
	d := dogfight{picked: make([]atomic.Bool, 2)}
	raw := []byte(`{"t":"players","list":[{"id":1,"team":"nato"},{"id":2,"team":"soviet"}]}`)
	if d.React(1, 2, "snap", raw) != nil || d.React(1, 9, "players", raw) != nil {
		t.Fatal("reacted to a non-roster message or an unknown id")
	}
	m, ok := d.React(1, 2, "players", raw).(protocol.ClientMsg)
	if !ok || m.T != protocol.TPick || m.Kind != "su27" {
		t.Fatalf("pick = %+v, %v; want su27", m, ok)
	}
	if d.React(1, 2, "players", raw) != nil {
		t.Error("picked twice")
	}
}

// The host of a created room asks to start on its lobby messages and the
// lobby's round messages; guests never do, nor anyone once it runs.
func TestReactHostStartsLobby(t *testing.T) {
	d := dogfight{picked: make([]atomic.Bool, 2), host: make([]atomic.Bool, 2)}
	lobby := []byte(`{"t":"lobby","phase":"lobby","host":2,"seats":2,"list":[]}`)
	round := []byte(`{"t":"round","phase":"lobby","left":0}`)
	if d.React(0, 3, "lobby", lobby) != nil || d.React(0, 3, "round", round) != nil {
		t.Fatal("a guest started")
	}
	for _, m := range []any{d.React(1, 2, "lobby", lobby), d.React(1, 2, "round", round)} {
		if m, ok := m.(protocol.ClientMsg); !ok || m.T != protocol.TStart {
			t.Fatalf("start = %+v, %v", m, ok)
		}
	}
	if d.React(1, 2, "lobby", []byte(`{"t":"lobby","phase":"playing","host":2}`)) != nil ||
		d.React(1, 2, "round", []byte(`{"t":"round","phase":"playing"}`)) != nil {
		t.Fatal("started a running round")
	}
}
