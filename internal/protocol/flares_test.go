package protocol

import (
	"encoding/json"
	"strings"
	"testing"

	"playground/internal/geom"
	"playground/internal/sim"
	"playground/internal/terrain"
)

// flareSnap is a 12-plane world after `dropping` planes released one flare
// each on every second for `seconds` s.
func flareSnap(dropping, seconds int) sim.Snapshot {
	w := sim.NewWorld(sim.Config{Seed: 3, Terrain: terrain.Generate(1)})
	for i := range 12 {
		w.AddPlane(sim.ID(i+1), sim.Team(1+i%2), sim.Kinds()[i%len(sim.Kinds())])
	}
	for i := 1; i <= seconds*60; i++ {
		in := map[sim.ID]sim.Input{}
		for id := range dropping {
			in[sim.ID(id+1)] = sim.Input{Throttle: 0.6, Flare: i%60 == 1}
		}
		w.Step(in)
	}
	return w.Snapshot()
}

func TestSnapFlaresWire(t *testing.T) {
	base, _ := json.Marshal(NewSnap(flareSnap(0, 2), nil, 1))
	if strings.Contains(string(base), `"fx"`) {
		t.Fatal("no flares: fx must be omitted")
	}
	t.Logf("12 planes, 0 flares: %d bytes", len(base))
	for _, dropping := range []int{1, 4, 12} {
		s := flareSnap(dropping, 2)
		b, err := json.Marshal(NewSnap(s, nil, 1))
		if err != nil {
			t.Fatal(err)
		}
		var back Snap
		if err := json.Unmarshal(b, &back); err != nil || len(back.Flares) != len(s.Flares) || len(s.Flares) != 2*dropping {
			t.Fatalf("round trip: %v, %d wire / %d sim flares", err, len(back.Flares), len(s.Flares))
		}
		f, j := s.Flares[0], back.Flares[0]
		if j.ID != f.ID || geom.V(j.Pos[0], j.Pos[1], j.Pos[2]).Dist(f.Pos) > 0.1 {
			t.Fatalf("flare %+v on the wire as %+v", f, j)
		}
		per := float64(len(b)-len(base)) / float64(len(s.Flares))
		t.Logf("12 planes, %2d flares: %d bytes (+%d, %.1f B/flare)", len(s.Flares), len(b), len(b)-len(base), per)
		if per > 50 {
			t.Fatalf("%.1f bytes per flare", per)
		}
		t.Logf("room cap, %d flares: ~%.0f bytes more", sim.MaxRoomFlares, per*sim.MaxRoomFlares)
	}
}

func TestDecoyEventWire(t *testing.T) {
	evs := NewEvents([]sim.Event{{Kind: sim.EvDecoy, Plane: 1<<24 + 3, Other: 5, By: 7, Pos: geom.V(1, 2, 3)}}, 10)
	if len(evs) != 1 || evs[0].K != "decoy" || evs[0].A != 1<<24+3 || evs[0].B != 5 || evs[0].O != 7 || evs[0].Pos == nil {
		t.Fatalf("decoy event on the wire: %+v", evs)
	}
}

// bp carries a radar missile's beam progress toward a broken track; at 0 it is omitted.
func TestMissileBeamProgressWire(t *testing.T) {
	s := sim.Snapshot{Missiles: []sim.Missile{
		{ID: 1, Target: 2, Kind: sim.MissileRadar, BeamTicks: sim.RadarBeamTicks / 2},
		{ID: 2, Target: 2, Kind: sim.MissileRadar},
	}}
	b, err := json.Marshal(NewSnap(s, nil, 1))
	if err != nil {
		t.Fatal(err)
	}
	var back Snap
	if err := json.Unmarshal(b, &back); err != nil || back.Missiles[0].Beam != 0.5 || back.Missiles[1].Beam != 0 {
		t.Fatalf("beam progress on the wire: %v %+v", err, back.Missiles)
	}
	if strings.Count(string(b), `"bp"`) != 1 {
		t.Fatalf("bp must be omitted at 0: %s", b)
	}
}
