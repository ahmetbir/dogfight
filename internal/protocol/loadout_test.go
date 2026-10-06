package protocol

import (
	"encoding/json"
	"strings"
	"testing"

	"playground/internal/geom"
	"playground/internal/sim"
	"playground/internal/terrain"
)

func TestPickLoadoutWhitelisted(t *testing.T) {
	for _, lo := range []string{"ir", "radar", "mixed"} {
		m, err := DecodeClient([]byte(`{"t":"pick","kind":"f16","lo":"` + lo + `"}`))
		if err != nil || m.Lo != lo {
			t.Fatalf("%s: %v %+v", lo, err, m)
		}
	}
	if _, err := DecodeClient([]byte(`{"t":"pick","kind":"f16"}`)); err != nil {
		t.Fatalf("a pick without a loadout keeps the current one: %v", err)
	}
	for _, bad := range []string{"IR", "nuke", " radar", "mixed\u0000"} {
		raw, _ := json.Marshal(map[string]string{"t": "pick", "kind": "f16", "lo": bad})
		if _, err := DecodeClient(raw); err != ErrBadLoadout {
			t.Fatalf("lo %q: %v, want ErrBadLoadout", bad, err)
		}
	}
}

// loadoutSnap is a 12-plane world in the given loadout (half radar, half
// mixed when mixed is set) with one radar and one IR missile in flight.
func loadoutSnap(mixed bool) sim.Snapshot {
	w := sim.NewWorld(sim.Config{Seed: 3, Terrain: terrain.Generate(1)})
	for i := range 12 {
		lo := sim.LoadIR
		if mixed {
			lo = []sim.Loadout{sim.LoadRadar, sim.LoadMixed}[i%2]
		}
		w.AddPlaneLoadout(sim.ID(i+1), sim.Team(1+i%2), sim.Kinds()[i%len(sim.Kinds())], lo)
	}
	for range 60 {
		w.Step(nil)
	}
	return w.Snapshot()
}

func TestSnapLoadoutWire(t *testing.T) {
	s := loadoutSnap(true)
	s.Missiles = []sim.Missile{
		{ID: 1 << 24, Owner: 1, Target: 2, Kind: sim.MissileRadar, Pos: geom.V(1, 2, 3)},
		{ID: 1<<24 + 1, Owner: 2, Target: 1, Kind: sim.MissileIR},
	}
	s.Planes[0].LockKind = sim.MissileRadar
	s.Planes[0].LockTime = sim.RadarLockSeconds / 2
	snap := NewSnap(s, NewEvents([]sim.Event{{Kind: sim.EvMissileLaunch, Plane: 1 << 24, By: 1, Missile: sim.MissileRadar}}, 5), 5)
	p0, p1 := snap.Planes[0], snap.Planes[1]
	if p0.Loadout != uint8(sim.LoadRadar) || p0.Missiles != 0 || p0.Radars != 2 || p0.LockKind != 1 || p0.LockP != 0.5 {
		t.Fatalf("radar plane %+v", p0)
	}
	if p1.Loadout != uint8(sim.LoadMixed) || p1.Missiles != 3 || p1.Radars != 1 {
		t.Fatalf("mixed plane %+v", p1)
	}
	if snap.Missiles[0].Kind != 1 || snap.Missiles[1].Kind != 0 || snap.Events[0].MK != 1 {
		t.Fatalf("missile kinds %+v / %+v", snap.Missiles, snap.Events)
	}
	ir, _ := json.Marshal(NewSnap(loadoutSnap(false), nil, 1))
	if strings.Contains(string(ir), `"lo"`) || strings.Contains(string(ir), `"rm"`) || strings.Contains(string(ir), `"lkk"`) {
		t.Fatal("an all-IR snapshot must not carry loadout fields")
	}
	mixed, _ := json.Marshal(NewSnap(loadoutSnap(true), nil, 1))
	t.Logf("12 planes: IR %d bytes, radar/mixed %d bytes (+%d)", len(ir), len(mixed), len(mixed)-len(ir))
	if len(mixed)-len(ir) > 12*len(`,"lo":2,"rm":2,"lkk":1`) {
		t.Fatalf("loadout fields grew the snapshot by %d bytes", len(mixed)-len(ir))
	}
}
