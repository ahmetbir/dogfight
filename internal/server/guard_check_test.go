package server

import (
	"testing"
	"time"

	"playground/internal/protocol"
)

func TestGuardVerdicts(t *testing.T) {
	now := time.Unix(0, 0)
	g := newMsgGuard(Limits{MsgRate: 90, MsgBurst: 3, PickRate: 2, PickBurst: 1, PingRate: 2, PingBurst: 1}, func() time.Time { return now })
	for i := range 3 {
		if v, _ := g.check(protocol.TIn); v != pass {
			t.Fatalf("in %d: %v", i, v)
		}
	}
	if v, b := g.check(protocol.TIn); v != drop || b != "in" {
		t.Fatalf("in over burst = %v %q, want drop in", v, b)
	}
	if v, _ := g.check(protocol.TPick); v != pass {
		t.Fatal("first pick refused: inputs share no bucket with other kinds")
	}
	if v, b := g.check(protocol.TPick); v != kick || b != "pick" {
		t.Fatalf("pick over burst = %v %q", v, b)
	}
	if v, _ := g.check(protocol.TPing); v != pass {
		t.Fatal("first ping refused")
	}
	if v, b := g.check(protocol.TPing); v != kick || b != "ping" {
		t.Fatalf("ping over burst = %v %q", v, b)
	}
	g.check(protocol.TChat)
	if v, b := g.check(protocol.TChat); v != kick || b != "all" {
		t.Fatalf("chat over the shared burst = %v %q", v, b)
	}
	now = now.Add(time.Second)
	if v, _ := g.check(protocol.TIn); v != pass {
		t.Fatal("inputs pass again after a refill")
	}
}
