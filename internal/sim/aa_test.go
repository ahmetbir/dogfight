package sim

import (
	"reflect"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

func hover(w *World, id ID, at geom.Vec3) {
	w.setFlight(id, FlightState{Pos: at, Rot: geom.Identity(), Vel: geom.V(0, 0, -100), Throttle: 0.5})
}

func TestAAShootsIntruders(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	b := w.cfg.Map.Bases[1] // Soviet base: fly along its runway axis over the flat footprint
	start := b.World(-900, 320)
	start.Y = b.Center.Y + 400 // ~985 m from the AA site at first
	w.setFlight(1, FlightState{Pos: start, Rot: YawPitch(maps.HeadingOf(b.Axis), 0), Vel: b.Axis.Scale(150), Throttle: 0.6})
	hit := false
	for range 6 * 60 {
		for _, e := range w.Step(nil) {
			if e.Kind == EvHit && e.Plane == 1 && e.Weapon == WAA {
				hit = true
			}
		}
	}
	if !hit {
		t.Fatal("AA must hit a plane crossing its base within 6 s")
	}
}

func TestAAIgnoresFarAndDeadSite(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	w.clearProtection()
	aa := w.cfg.Map.Structures[11]
	far := aa.Box.Max.Add(geom.V(0, 1000, 1500))
	for range 120 {
		hover(w, 1, far)
		for _, e := range w.Step(nil) {
			if e.Kind == EvFire && e.Weapon == WAA {
				t.Fatal("no fire beyond 1500 m")
			}
		}
	}
	w.structs[11].Alive = false
	near := aa.Box.Max.Add(geom.V(0, 300, 300))
	for range 120 {
		hover(w, 1, near)
		for _, e := range w.Step(nil) {
			if e.Kind == EvFire && e.Weapon == WAA {
				t.Fatal("a destroyed AA site stays silent")
			}
		}
	}
}

// AA spares protected planes and planes on their wheels (the ram rulings).
func TestAASparesProtectedAndGroundPlanes(t *testing.T) {
	w := baseWorld()
	w.AddPlane(1, TeamNATO, F16)
	parkAt(w, 1, 1) // on its wheels at the Soviet base, protection cleared
	w.clearProtection()
	w.planes[1].GroundProtect = false
	near := w.cfg.Map.Structures[11].Box.Max.Add(geom.V(0, 300, 300))
	for i := range 240 {
		if i == 120 { // then airborne but spawn-protected
			w.planes[1].ProtectUntil = w.tick + 1000
		}
		if i >= 120 {
			hover(w, 1, near)
		}
		for _, e := range w.Step(nil) {
			if e.Kind == EvFire && e.Weapon == WAA {
				t.Fatalf("tick %d: AA fired at a grounded or protected plane", i)
			}
		}
	}
}

func TestAAFireIsDeterministic(t *testing.T) {
	run := func() []Event {
		w := baseWorld()
		for _, id := range []ID{4, 1, 3} {
			w.AddPlane(id, TeamNATO, F16)
		}
		w.clearProtection()
		near := w.cfg.Map.Structures[11].Box.Max.Add(geom.V(0, 300, 300))
		var evs []Event
		for range 90 {
			for i, id := range []ID{1, 3, 4} {
				hover(w, id, near.Add(geom.V(float64(i)*40, 0, 0)))
			}
			for _, e := range w.Step(nil) {
				if e.Weapon == WAA {
					evs = append(evs, e)
				}
			}
		}
		return evs
	}
	a, b := run(), run()
	if len(a) == 0 || !reflect.DeepEqual(a, b) {
		t.Fatalf("AA fire differs between equal runs (%d vs %d events)", len(a), len(b))
	}
}
