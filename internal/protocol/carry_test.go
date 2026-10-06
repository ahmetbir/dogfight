package protocol

import "testing"

func TestSnapCarriesEvictedEvents(t *testing.T) {
	shared := []EventJSON{{K: "fire", Tick: 4}} // shared read-only by every session's copy
	older := Snap{T: "snap", Tick: 2, Events: []EventJSON{{K: "kill", Tick: 1}, {K: "spawn", Tick: 2}}}
	newer := Snap{T: "snap", Tick: 4, Ack: 9, Events: shared}
	got, ok := newer.Carry(older).(Snap)
	if !ok || got.Tick != 4 || got.Ack != 9 {
		t.Fatalf("carry kept the wrong snapshot: %+v", got)
	}
	if len(got.Events) != 3 || got.Events[0].K != "kill" || got.Events[1].K != "spawn" || got.Events[2].K != "fire" {
		t.Fatalf("events %+v", got.Events)
	}
	if len(shared) != 1 || shared[0].K != "fire" {
		t.Fatal("carry mutated a shared events slice")
	}
	if same, _ := newer.Carry("not a snap").(Snap); len(same.Events) != 1 {
		t.Fatal("a foreign message must not change the snapshot")
	}
}
