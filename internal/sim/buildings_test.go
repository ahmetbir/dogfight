package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/terrain"
)

// skyBox floats far above the island so only the box, never the terrain,
// can stop a plane, round or missile in these tests.
var skyBox = maps.Box{Min: geom.V(-50, 1800, -50), Max: geom.V(50, 2200, 50)}

// boxWorld is a world whose map holds only skyBox, or no solids at all when
// withBox is false (the control that proves each scenario's geometry works).
func boxWorld(withBox bool) *World {
	var boxes []maps.Box
	if withBox {
		boxes = []maps.Box{skyBox}
	}
	m := &maps.Map{Kind: maps.Ada, Seed: 1, Terrain: terrain.Generate(1), Solids: maps.NewIndex(boxes)}
	return NewWorld(Config{Seed: 1, Terrain: m.Terrain, Map: m})
}

// boxCenter is the middle of skyBox; north and south are along Z.
func boxCenter() geom.Vec3 { return skyBox.Min.Add(skyBox.Max).Scale(0.5) }

func TestPlaneHitsBuilding(t *testing.T) {
	for _, withBox := range []bool{true, false} {
		w := boxWorld(withBox)
		w.AddPlane(1, TeamNATO, F16)
		from := geom.V(0, boxCenter().Y, skyBox.Max.Z+40)
		w.setFlight(1, FlightState{Pos: from, Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
		w.prev[1] = from
		var crash *Event
		for range 60 {
			for _, e := range w.Step(nil) {
				if e.Kind == EvKill && e.Plane == 1 {
					crash = &e
				}
			}
		}
		switch {
		case withBox && (crash == nil || crash.Weapon != WCrash || crash.Other != 0):
			t.Fatalf("flying into a building must crash, got %+v", crash)
		case withBox && crash.Pos.Z < skyBox.Min.Z-10:
			t.Fatalf("crashed only after passing through the box at %v", crash.Pos)
		case !withBox && crash != nil:
			t.Fatalf("control: open sky must not kill, got %+v", crash)
		}
	}
}

func TestBulletStopsAtBuilding(t *testing.T) {
	for _, withBox := range []bool{true, false} {
		w := boxWorld(withBox)
		w.AddPlane(1, TeamNATO, F16)
		w.AddPlane(2, TeamSoviet, MiG29)
		w.clearProtection()
		c := boxCenter()
		from := geom.V(c.X, c.Y, skyBox.Max.Z+300)
		behind := geom.V(c.X, c.Y, skyBox.Min.Z-50) // target hidden behind the box
		fired, hits := 0, 0
		for range 60 {
			w.setFlight(1, FlightState{Pos: from, Rot: geom.Identity(), Vel: geom.V(0, 0, -100), Throttle: 1})
			w.setFlight(2, FlightState{Pos: behind, Rot: geom.Identity(), Vel: geom.V(0, 0, -1), Throttle: 0})
			for _, e := range w.Step(map[ID]Input{1: {Throttle: 1, Fire: true}}) {
				switch {
				case e.Kind == EvFire && e.Plane == 1:
					fired++
				case e.Kind == EvHit && e.Plane == 2:
					hits++
				}
			}
		}
		a, _ := w.Plane(1)
		b, _ := w.Plane(2)
		if fired == 0 || !a.Alive || !b.Alive {
			t.Fatalf("box=%v: fired %d, shooter alive %v, target alive %v", withBox, fired, a.Alive, b.Alive)
		}
		if withBox && hits != 0 {
			t.Fatalf("bullets must not pass through the building: %d hits", hits)
		}
		if !withBox && hits == 0 {
			t.Fatal("control: without the box the same burst must hit")
		}
	}
}

func TestMissileDetonatesOnBuilding(t *testing.T) {
	for _, withBox := range []bool{true, false} {
		w := boxWorld(withBox)
		w.AddPlane(2, TeamSoviet, MiG29)
		w.clearProtection()
		c := boxCenter()
		target := geom.V(c.X, c.Y, skyBox.Min.Z-100)
		w.setFlight(2, FlightState{Pos: target, Rot: geom.Identity(), Vel: geom.V(0, 0, -1)})
		w.addMissileForTest(9, 2, geom.V(c.X, c.Y, skyBox.Max.Z+200), geom.V(0, 0, -400))
		var gone *Event
		for range 120 {
			for _, e := range w.Step(nil) {
				if e.Kind == EvMissileGone && gone == nil {
					gone = &e
				}
			}
			if gone != nil {
				break
			}
		}
		if gone == nil {
			t.Fatalf("box=%v: missile never ended", withBox)
		}
		p, _ := w.Plane(2)
		hurt := p.HP < SpecOf(MiG29).MaxHP
		switch {
		case withBox && (hurt || gone.Pos.Z < skyBox.Min.Z || gone.Pos.Z > skyBox.Max.Z+10):
			t.Fatalf("missile must end at the building unharmed target: hp %v, gone at %v", p.HP, gone.Pos)
		case !withBox && !hurt:
			t.Fatal("control: without the box the missile must hit the target")
		}
	}
}
