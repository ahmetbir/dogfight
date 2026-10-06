package sim

import "testing"

func TestInputLatchAndHeld(t *testing.T) {
	in := Input{Pitch: 0.5, Throttle: 1, Fire: true}
	got := in.Latch(Input{Missile: true, Flare: true, Bomb: true, Pitch: -1})
	if got != (Input{Pitch: 0.5, Throttle: 1, Fire: true, Missile: true, Flare: true, Bomb: true}) {
		t.Fatalf("latch %+v", got)
	}
	if h := got.Held(); h != (Input{Pitch: 0.5, Throttle: 1, Fire: true}) {
		t.Fatalf("held %+v", h)
	}
}
