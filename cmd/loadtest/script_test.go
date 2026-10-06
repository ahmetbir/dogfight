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
