package sim

import (
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

// FB-A 6 ("füze sayısı gitgide artıyor mu?"): no mix of in-flight regen,
// missile pickups, landing rearms, reseats (instant swap) and respawns with
// another kind and loadout ever puts more missiles (of either kind) or
// flares on a plane than its loadout, and regen alone never lifts a kind
// past ceil(load/2).
func TestMissilesNeverExceedLoadout(t *testing.T) {
	for seed := int64(1); seed <= 20; seed++ {
		w := NewWorld(Config{Seed: seed, Terrain: maps.Build(maps.Ada, 1).Terrain, Map: maps.Build(maps.Ada, 1), Start: StartRunway})
		w.AddPlane(1, TeamNATO, F15)
		rng := NewRNG(seed)
		p := w.planes[1]
		kind := func() Kind { return Kinds()[int(rng.Float64()*4)] }
		lo := func() Loadout { return Loadout(int(rng.Float64() * 3)) }
		air := func(ticks int) {
			for range ticks {
				w.setFlight(1, FlightState{Pos: geom.V(0, 2500, 0), Rot: geom.Identity(), Vel: geom.V(0, 0, -200), Throttle: 1})
				w.Step(nil)
			}
		}
		for op := range 200 {
			before, beforeR := p.Missiles, p.Radars
			var what string
			switch r := int(rng.Float64() * 7); r {
			case 0:
				what = "regen"
				air(1 + int(rng.Float64()*3*MissileRegenTicks))
				ir, rd := p.loadout()
				if lim := missileRegenCap(ir); before <= lim && p.Missiles > lim {
					t.Fatalf("seed %d op %d: regen lifted missiles %d -> %d past %d", seed, op, before, p.Missiles, lim)
				}
				if lim := missileRegenCap(rd); beforeR <= lim && p.Radars > lim {
					t.Fatalf("seed %d op %d: regen lifted radar missiles %d -> %d past %d", seed, op, beforeR, p.Radars, lim)
				}
			case 1:
				what = "pickup"
				w.applyPowerup(p, PUMissiles)
			case 2:
				what = "fire"
				p.Missiles = max(0, p.Missiles-1-int(rng.Float64()*3))
				p.Radars = max(0, p.Radars-int(rng.Float64()*2))
				p.Flares = max(0, p.Flares-int(rng.Float64()*4))
			case 3:
				what = "rearm"
				b := w.cfg.Map.Bases[0]
				pos := b.World(0, 0)
				w.setFlight(1, FlightState{Pos: pos.Add(geom.V(0, GearHeight, 0)), Rot: YawPitch(maps.HeadingOf(b.Axis), 0), Gear: true, Ground: true})
				for range RearmTicks + 2 {
					w.Step(map[ID]Input{1: {Gear: true, Brake: true}})
				}
				if ir, rd := p.loadout(); p.Missiles != ir || p.Radars != rd || p.Flares != SpecOf(p.Kind).Flares {
					t.Fatalf("seed %d op %d: rearm left %d/%d missiles, %d/%d radar", seed, op, p.Missiles, ir, p.Radars, rd)
				}
			case 4:
				what = "reseat"
				w.SetLoadout(1, lo())
				w.Reseat(1, kind())
			case 5:
				what = "respawn"
				w.SetKind(1, kind())
				w.SetLoadout(1, lo())
				var evs []Event
				w.kill(p, 0, WCrash, &evs)
				for range RespawnTicks + 1 {
					w.Step(nil)
				}
			default:
				what = "kind-next"
				w.SetKind(1, kind())
			}
			s := SpecOf(p.Kind)
			ir, rd := p.loadout()
			if p.Missiles < 0 || p.Missiles > ir || p.Radars < 0 || p.Radars > rd || p.Flares < 0 || p.Flares > s.Flares {
				t.Fatalf("seed %d op %d (%s): %v %v has %d/%d missiles, %d/%d radar, %d/%d flares", seed, op, what, p.Kind, p.Loadout,
					p.Missiles, ir, p.Radars, rd, p.Flares, s.Flares)
			}
		}
	}
}
