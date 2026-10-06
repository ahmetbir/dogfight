package sim

import (
	"encoding/json"
	"flag"
	"math"
	"os"
	"path/filepath"
	"testing"

	"playground/internal/geom"
	"playground/internal/maps"
)

var update = flag.Bool("update", false, "rewrite testdata/vectors/flight.json")

// Shared flight vectors: Go writes multi-tick trajectories that the client's
// TS port (client/src/sim/flight.ts) must reproduce within 1e-3.
//
// Indexing contract (shared with the TS test):
//   - step i (0-based; the i-th call to StepFlight) uses the last input whose
//     `from` <= i; inputs are sorted by `from` and the first has from = 0;
//   - a checkpoint with `tick` = n is the state after n steps.
//
// Without -update the test re-runs every scenario from the file and checks
// the checkpoints within vecTol (Go self-regression). The tolerance is 1e-6,
// not tighter, because arm64 fuses a*b+c (FMA) and amd64 does not.

const vecTol = 1e-6

var vectorsPath = filepath.Join("..", "..", "testdata", "vectors", "flight.json")

type vecSpec struct {
	MaxSpeed    float64 `json:"maxSpeed"`
	MaxSpeedAB  float64 `json:"maxSpeedAB"`
	Accel       float64 `json:"accel"`
	RollRate    float64 `json:"rollRate"`
	PitchRate   float64 `json:"pitchRate"`
	YawRate     float64 `json:"yawRate"`
	CornerSpeed float64 `json:"cornerSpeed"`
	RotateSpeed float64 `json:"rotateSpeed"`
}

type vecState struct {
	Pos [3]float64 `json:"pos"`
	Rot [4]float64 `json:"rot"` // w, x, y, z
	Vel [3]float64 `json:"vel"`
	Th  float64    `json:"th"`
	// v2: landing gear down, rolling on the wheels
	Gear     bool `json:"gear,omitempty"`
	OnGround bool `json:"ground,omitempty"`
	// FB-A: afterburner heat and lockout
	ABHeat float64 `json:"abh,omitempty"`
	ABLock bool    `json:"abl,omitempty"`
}

type vecInput struct {
	From int     `json:"from"`
	P    float64 `json:"p"`
	R    float64 `json:"r"`
	Y    float64 `json:"y"`
	Th   float64 `json:"th"`
	AB   bool    `json:"ab"`
	G    bool    `json:"g,omitempty"`  // desired gear down
	BR   bool    `json:"br,omitempty"` // wheel brakes
}

type vecCheckpoint struct {
	Tick   int        `json:"tick"`
	Pos    [3]float64 `json:"pos"`
	Rot    [4]float64 `json:"rot"`
	Vel    [3]float64 `json:"vel"`
	Gear   bool       `json:"gear,omitempty"`
	Ground bool       `json:"ground,omitempty"`
	W      [3]float64 `json:"w"` // FB-A: body angular rate
	ABHeat float64    `json:"abh"`
	ABLock bool       `json:"abl,omitempty"`
}

type vecGround struct {
	H    float64 `json:"h"`
	Surf int     `json:"surf"`
}

type vecWind struct {
	Base [3]float64 `json:"base"`
	Gust float64    `json:"gust"`
	Tick int        `json:"tick"`
	W    [3]float64 `json:"w"`
}

type vecScenario struct {
	Name        string          `json:"name"`
	Kind        string          `json:"kind"`
	Turbo       bool            `json:"turbo"`
	Wind        *[3]float64     `json:"wind,omitempty"`
	Ground      *vecGround      `json:"ground,omitempty"`
	Spec        vecSpec         `json:"spec"`
	Start       vecState        `json:"start"`
	Inputs      []vecInput      `json:"inputs"`
	Ticks       int             `json:"ticks"`
	Checkpoints []vecCheckpoint `json:"checkpoints"`
}

type vecFile struct {
	Scenarios []vecScenario `json:"scenarios"`
	Wind      []vecWind     `json:"wind,omitempty"`
}

func toVecSpec(s Spec) vecSpec {
	return vecSpec{s.MaxSpeed, s.MaxSpeedAB, s.Accel, s.RollRate, s.PitchRate, s.YawRate, s.CornerSpeed, s.RotateSpeed}
}

func (v vecSpec) spec() Spec {
	return Spec{MaxSpeed: v.MaxSpeed, MaxSpeedAB: v.MaxSpeedAB, Accel: v.Accel, RollRate: v.RollRate,
		PitchRate: v.PitchRate, YawRate: v.YawRate, CornerSpeed: v.CornerSpeed, RotateSpeed: v.RotateSpeed}
}

func v3(a geom.Vec3) [3]float64 { return [3]float64{a.X, a.Y, a.Z} }
func q4(q geom.Quat) [4]float64 { return [4]float64{q.W, q.X, q.Y, q.Z} }

// runScenario simulates sc from its own spec, start and inputs and returns
// the checkpoints at every 60 steps.
func runScenario(sc vecScenario) []vecCheckpoint {
	fs := FlightState{
		Pos:      geom.V(sc.Start.Pos[0], sc.Start.Pos[1], sc.Start.Pos[2]),
		Rot:      geom.Quat{W: sc.Start.Rot[0], X: sc.Start.Rot[1], Y: sc.Start.Rot[2], Z: sc.Start.Rot[3]},
		Vel:      geom.V(sc.Start.Vel[0], sc.Start.Vel[1], sc.Start.Vel[2]),
		Throttle: sc.Start.Th,
		Gear:     sc.Start.Gear,
		Ground:   sc.Start.OnGround,
		ABHeat:   sc.Start.ABHeat,
		ABLock:   sc.Start.ABLock,
	}
	spec := sc.Spec.spec()
	mods := FlightMods{Turbo: sc.Turbo}
	if w := sc.Wind; w != nil {
		mods.Wind = geom.V(w[0], w[1], w[2])
	}
	if g := sc.Ground; g != nil {
		mods.Ground = GroundSample{H: g.H, Surf: maps.Surface(g.Surf)}
	}
	var cps []vecCheckpoint
	for i := range sc.Ticks {
		var cur vecInput
		for _, in := range sc.Inputs {
			if in.From <= i {
				cur = in
			}
		}
		in := Input{Pitch: cur.P, Roll: cur.R, Yaw: cur.Y, Throttle: cur.Th, AB: cur.AB, Gear: cur.G, Brake: cur.BR}
		fs = StepFlight(fs, in, spec, mods)
		if n := i + 1; n%60 == 0 {
			cps = append(cps, vecCheckpoint{Tick: n, Pos: v3(fs.Pos), Rot: q4(fs.Rot), Vel: v3(fs.Vel), Gear: fs.Gear, Ground: fs.Ground, W: v3(fs.W),
				ABHeat: fs.ABHeat, ABLock: fs.ABLock})
		}
	}
	return cps
}

func TestFlightVectors(t *testing.T) {
	if *update {
		f := vecFile{Scenarios: vecScenarios(), Wind: windSamples()}
		for i := range f.Scenarios {
			f.Scenarios[i].Checkpoints = runScenario(f.Scenarios[i])
		}
		for i, s := range f.Wind {
			f.Wind[i].W = v3(WindAt(geom.V(s.Base[0], s.Base[1], s.Base[2]), s.Gust, s.Tick))
		}
		data, err := json.MarshalIndent(f, "", " ")
		if err != nil {
			t.Fatal(err)
		}
		if err := os.MkdirAll(filepath.Dir(vectorsPath), 0o755); err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile(vectorsPath, append(data, '\n'), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	data, err := os.ReadFile(vectorsPath)
	if err != nil {
		t.Fatalf("%v (generate with -update)", err)
	}
	var f vecFile
	if err := json.Unmarshal(data, &f); err != nil {
		t.Fatal(err)
	}
	want := vecScenarios()
	if len(f.Scenarios) != len(want) {
		t.Fatalf("file has %d scenarios, want %d (regenerate with -update)", len(f.Scenarios), len(want))
	}
	for i, sc := range f.Scenarios {
		if sc.Name != want[i].Name || sc.Spec != want[i].Spec {
			t.Fatalf("%s: scenario or aircraft spec drifted from the Go table (regenerate with -update)", sc.Name)
		}
		got := runScenario(sc)
		if len(got) != len(sc.Checkpoints) || len(got) != sc.Ticks/60 {
			t.Fatalf("%s: %d checkpoints, file has %d", sc.Name, len(got), len(sc.Checkpoints))
		}
		for j, cp := range sc.Checkpoints {
			g := got[j]
			if !near(g.Pos[:], cp.Pos[:]) || !near(g.Rot[:], cp.Rot[:]) || !near(g.Vel[:], cp.Vel[:]) || !near(g.W[:], cp.W[:]) || !near([]float64{g.ABHeat}, []float64{cp.ABHeat}) || g.ABLock != cp.ABLock || g.Tick != cp.Tick ||
				g.Gear != cp.Gear || g.Ground != cp.Ground {
				t.Errorf("%s tick %d: got %+v, file %+v", sc.Name, cp.Tick, g, cp)
			}
		}
	}
	if len(f.Wind) != len(windSamples()) {
		t.Fatalf("file has %d wind samples, want %d (regenerate with -update)", len(f.Wind), len(windSamples()))
	}
	for _, s := range f.Wind {
		got := v3(WindAt(geom.V(s.Base[0], s.Base[1], s.Base[2]), s.Gust, s.Tick))
		if !near(got[:], s.W[:]) {
			t.Errorf("wind %+v: got %v", s, got)
		}
	}
}

func near(a, b []float64) bool {
	for i := range a {
		if !(math.Abs(a[i]-b[i]) <= vecTol) {
			return false
		}
	}
	return true
}
