package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

// start builds a state with the nose pitched by pitch rad (from level, facing
// -Z) and the velocity along the nose.
func start(alt, pitch, speed, th float64) vecState {
	rot := geom.AxisAngle(geom.V(1, 0, 0), pitch)
	return vecState{Pos: [3]float64{0, alt, 0}, Rot: q4(rot), Vel: v3(rot.Forward().Scale(speed)), Th: th}
}

func grassApproach() vecState {
	st := start(30+GearHeight+3, -0.02, 95, 0.2)
	st.Gear = true
	return st
}

func abStart(heat float64, lock bool) vecState {
	st := start(1500, 0, 250, 1)
	st.ABHeat, st.ABLock = heat, lock
	return st
}

// banked is level flight facing -Z rolled by bank rad (negative = right wing down).
func banked(alt, bank, speed, th float64) vecState {
	rot := geom.AxisAngle(geom.V(0, 0, 1), bank)
	return vecState{Pos: [3]float64{0, alt, 0}, Rot: q4(rot), Vel: v3(rot.Forward().Scale(speed)), Th: th}
}

func steady(p, r, y, th float64, ab bool) []vecInput {
	return []vecInput{{From: 0, P: p, R: r, Y: y, Th: th, AB: ab}}
}

func vecScenarios() []vecScenario {
	mixed := make([]vecInput, 0, 5)
	for i, in := range []vecInput{
		{P: 0.5, R: 0, Y: 0, Th: 1},
		{P: 0, R: -1, Y: 0.4, Th: 0.6, AB: true},
		{P: -0.7, R: 0.3, Y: -1, Th: 0.2},
		{P: 1, R: 1, Y: 0, Th: 1, AB: true},
		{P: 0.2, R: -0.4, Y: 0.6, Th: 0},
	} {
		in.From = i * 60
		mixed = append(mixed, in)
	}
	sc := []vecScenario{
		{Name: "f16-level-full", Kind: "f16", Start: start(1500, 0, 200, 1), Inputs: steady(0, 0, 0, 1, false)},
		{Name: "f15-afterburner", Kind: "f15", Start: start(1500, 0, 200, 1), Inputs: steady(0, 0, 0, 1, true)},
		{Name: "mig29-full-pitch", Kind: "mig29", Start: start(1500, 0, 200, 1), Inputs: steady(1, 0, 0, 1, false)},
		{Name: "su27-full-roll", Kind: "su27", Start: start(1500, 0, 200, 1), Inputs: steady(0, 1, 0, 1, false)},
		{Name: "f16-roll-pitch-spiral", Kind: "f16", Start: start(2000, 0, 200, 1), Inputs: steady(0.6, 0.5, 0, 1, false)},
		{Name: "f16-stall", Kind: "f16", Start: start(1500, 0.6, 60, 0), Inputs: steady(0, 0, 0, 0, false)},
		{Name: "f15-dive-60", Kind: "f15", Start: start(2800, -math.Pi/3, 200, 1), Inputs: steady(0, 0, 0, 1, false)},
		{Name: "mig29-climb-to-ceiling", Kind: "mig29", Start: start(2600, math.Pi/4, 250, 1), Inputs: steady(0, 0, 0, 1, true)},
		{Name: "su27-turbo", Kind: "su27", Turbo: true, Start: start(1500, 0, 200, 1), Inputs: steady(0, 0, 0, 1, false)},
		{Name: "f16-mixed", Kind: "f16", Start: start(1500, 0, 200, 1), Inputs: mixed},
	}
	sc = append(sc, v2Scenarios()...)
	sc = append(sc, fbScenarios()...)
	for _, k := range Kinds()[4:] { // Phase 4 kinds: each flies the mixed inputs
		sc = append(sc, vecScenario{Name: k.String() + "-mixed", Kind: k.String(), Start: start(1500, 0, 200, 1), Inputs: mixed})
	}
	for i := range sc {
		k, _ := ParseKind(sc[i].Kind)
		sc[i].Spec = toVecSpec(SpecOf(k))
		if sc[i].Ticks == 0 {
			sc[i].Ticks = 300
		}
	}
	return sc
}

func groundStart(h, speed, th float64) vecState {
	return vecState{Pos: [3]float64{0, h + GearHeight, 0}, Rot: q4(geom.Identity()), Vel: [3]float64{0, 0, -speed}, Th: th, Gear: true, OnGround: true}
}

// v2 scenarios: ground handling, gear and wind (appended after the v1 ten).
func v2Scenarios() []vecScenario {
	runway := &vecGround{H: 10, Surf: int(maps.SurfRunway)}
	taxi := &vecGround{H: 10, Surf: int(maps.SurfTaxi)}
	approach := start(10+GearHeight+12, -0.04, 100, 0.3)
	approach.Gear = true
	fast := start(1500, 0, 150, 1)
	fast.Gear = true
	wind := [3]float64{6, 0, -4}
	return []vecScenario{
		{Name: "f16-taxi-turn", Kind: "f16", Ground: taxi, Start: groundStart(10, 0, 0), Ticks: 300,
			Inputs: []vecInput{{From: 0, Th: 0.15, G: true}, {From: 120, Th: 0.15, Y: 1, G: true}, {From: 240, BR: true, G: true}}},
		{Name: "f15-takeoff-roll", Kind: "f15", Ground: runway, Start: groundStart(10, 0, 0), Ticks: 600,
			Inputs: []vecInput{{From: 0, Th: 1, AB: true}, {From: 240, Th: 1, AB: true, P: 1}}},
		{Name: "mig29-landing", Kind: "mig29", Ground: runway, Start: approach, Ticks: 420,
			Inputs: []vecInput{{From: 0, Th: 0.3, G: true}, {From: 150, G: true, BR: true}}},
		{Name: "su27-brake-stop", Kind: "su27", Ground: runway, Start: groundStart(10, 60, 0), Ticks: 300,
			Inputs: []vecInput{{From: 0, BR: true, G: true}}},
		{Name: "f16-gear-forced-up", Kind: "f16", Start: fast, Ticks: 300,
			Inputs: []vecInput{{From: 0, Th: 1, AB: true, G: true}}},
		{Name: "f16-wind", Kind: "f16", Wind: &wind, Start: start(1500, 0, 200, 1), Ticks: 300, Inputs: steady(0.2, 0.3, 0, 1, false)},
		// Full throttle and afterburner on the apron: the taxi governor holds 28 m/s.
		{Name: "f15-taxi-governor", Kind: "f15", Ground: taxi, Start: groundStart(10, 0, 0), Ticks: 600,
			Inputs: []vecInput{{From: 0, Th: 1, AB: true, G: true}, {From: 420, Th: 1, Y: 0.5, G: true}}},
	}
}

// FB-A scenarios (feedback #1): control inertia, pitch asymmetry.
func fbScenarios() []vecScenario {
	return []vecScenario{
		// Push reaches 0.55 of the pull rate: compare with mig29-full-pitch.
		{Name: "mig29-full-push", Kind: "mig29", Start: start(1500, 0, 200, 1), Inputs: steady(-1, 0, 0, 1, false)},
		{Name: "f15-pull-then-push", Kind: "f15", Start: start(1500, 0, 200, 1), Ticks: 300,
			Inputs: []vecInput{{From: 0, P: 1, Th: 1}, {From: 50, P: -1, Th: 1}, {From: 170, P: 0, Th: 1}}},
		// Checkpoints fall inside the build-up and decay of the rates.
		{Name: "su27-rate-buildup", Kind: "su27", Start: start(1500, 0, 200, 1), Ticks: 300,
			Inputs: []vecInput{{From: 0, Th: 1}, {From: 50, R: 1, Y: 1, P: 0.5, Th: 1}, {From: 110, R: -1, Y: -1, Th: 1}, {From: 175, Th: 1}}},
		// Induced drag: a banked max pull from corner speed bleeds speed.
		{Name: "f16-sustained-turn-bleed", Kind: "f16", Start: banked(2000, -1.45, 170, 1), Inputs: steady(1, 0, 0, 1, false)},
		// Afterburner heat: hot AB locks out at 1 and the speed decays.
		{Name: "f15-ab-lockout", Kind: "f15", Start: abStart(0.9, false), Inputs: steady(0, 0, 0, 1, true)},
		// Locked and nearly cool: unlocks at 0.3 and burns again.
		{Name: "su27-ab-unlock", Kind: "su27", Start: abStart(0.35, true), Inputs: steady(0, 0, 0, 1, true)},
		// Afterburner takeoff roll heats it too.
		{Name: "mig29-ab-ground-heat", Kind: "mig29", Ground: &vecGround{H: 10, Surf: int(maps.SurfRunway)}, Start: groundStart(10, 0, 0),
			Ticks: 300, Inputs: []vecInput{{From: 0, Th: 1, AB: true, G: true}}},
		// Grass: heavier rolling, bumps, steering, then brakes.
		{Name: "f16-grass-roll", Kind: "f16", Ground: &vecGround{H: 30, Surf: int(maps.SurfNone)}, Start: groundStart(30, 25, 0.3),
			Ticks: 300, Inputs: []vecInput{{From: 0, Th: 0.3, G: true}, {From: 100, Th: 0.3, Y: -1, G: true}, {From: 200, BR: true, G: true}}},
		// Fix round 2: full throttle + afterburner on grass is held at the 28 m/s governor.
		{Name: "su27-ab-grass-governor", Kind: "su27", Ground: &vecGround{H: 30, Surf: int(maps.SurfNone)}, Start: groundStart(30, 20, 1),
			Ticks: 300, Inputs: []vecInput{{From: 0, Th: 1, AB: true, G: true}}},
		// Touchdown on unpaved ground settles too (the server judges it).
		{Name: "f15-grass-touchdown", Kind: "f15", Ground: &vecGround{H: 30, Surf: int(maps.SurfNone)}, Start: grassApproach(),
			Ticks: 240, Inputs: []vecInput{{From: 0, Th: 0.2, G: true}, {From: 60, G: true, BR: true}}},
	}
}

func windSamples() []vecWind {
	var out []vecWind
	for _, b := range []struct {
		base [3]float64
		gust float64
	}{{[3]float64{6, 0, -4}, 2}, {[3]float64{0, 0, 10}, 6}, {[3]float64{3, 0, 0}, 0}} {
		for _, tick := range []int{0, 1, 59, 600, 12345} {
			out = append(out, vecWind{Base: b.base, Gust: b.gust, Tick: tick})
		}
	}
	return out
}
