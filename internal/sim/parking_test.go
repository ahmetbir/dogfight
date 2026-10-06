package sim

import (
	"testing"

	"playground/internal/maps"
)

func TestParkedPlaneHoldsWithoutThrust(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	p0, _ := w.Plane(1)
	if !p0.Parked || p0.Throttle != 0 {
		t.Fatalf("a hangar spawn starts parked at idle: %+v", p0.FlightState)
	}
	// Stale inputs from the last life (full throttle, afterburner) arrive first.
	for range ParkGraceTicks - 1 {
		w.Step(map[ID]Input{1: {Throttle: 1, AB: true, Gear: true}})
	}
	for range 300 { // then none at all: the server repeats the last (idle) one
		w.Step(nil)
	}
	p, _ := w.Plane(1)
	if !p.Parked || p.Pos.Sub(p0.Pos).Len() > 1e-9 || p.Throttle != 0 {
		t.Fatalf("parked plane moved or spooled up: %v → %v th %v", p0.Pos, p.Pos, p.Throttle)
	}
}

func TestParkingBrakeReleasesOnThrottle(t *testing.T) {
	w := runwayWorld(maps.Ada)
	w.AddPlane(1, TeamNATO, F16)
	p0, _ := w.Plane(1)
	for range ParkGraceTicks {
		w.Step(map[ID]Input{1: {Gear: true}})
	}
	for range 120 {
		w.Step(map[ID]Input{1: {Throttle: 0.3, Gear: true}})
	}
	p, _ := w.Plane(1)
	if p.Parked || !p.Alive || p.Pos.Sub(p0.Pos).Len() < 1 {
		t.Fatalf("throttle must release the brake and roll: parked %v alive %v moved %.2f", p.Parked, p.Alive, p.Pos.Sub(p0.Pos).Len())
	}
}
