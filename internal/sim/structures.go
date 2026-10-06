package sim

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
)

const (
	StructIDBase    ID = 1 << 22 // below missiles (1<<24) and bombs (1<<25)
	StructCannonMul    = 0.25    // cannon damage scale against structures
)

// StructID is the ID of target index (0..5) of side (0 NATO, 1 Soviet).
func StructID(side, index int) ID { return StructIDBase + ID(side*8+index) }

// StructTeam is the team owning structure id; false for any other ID.
func StructTeam(id ID) (Team, bool) {
	if id < StructIDBase || id >= StructIDBase+16 {
		return TeamNone, false
	}
	return Team((id-StructIDBase)/8 + 1), true
}

// Structure is the live state of one base attack target (Map.Structures order).
type Structure struct {
	ID    ID
	Side  int
	Kind  maps.StructKind
	HP    float64
	Alive bool
}

func (w *World) initStructures() {
	if !w.cfg.Structures || w.cfg.Map == nil {
		return
	}
	w.structs = make([]Structure, len(w.cfg.Map.Structures))
	w.aaReady = make([]int, len(w.structs))
	w.resetStructures()
}

func (w *World) resetStructures() {
	for i, d := range w.cfg.Map.Structures {
		w.structs[i] = Structure{ID: StructID(d.Side, d.Index), Side: d.Side, Kind: d.Kind, HP: d.MaxHP, Alive: true}
	}
}

func structTeam(s Structure) Team { return Team(s.Side + 1) }

// damageStruct takes dmg off target i; EvStructHit with the HP actually
// taken (an overkill counts only what was left), and EvStructDown at 0 HP.
func (w *World) damageStruct(i int, by ID, dmg float64, weapon Weapon, at geom.Vec3, ev *[]Event) {
	s := &w.structs[i]
	if !s.Alive || !(dmg > 0) { // !(>) also rejects NaN
		return
	}
	taken := math.Min(dmg, s.HP)
	s.HP -= taken
	*ev = append(*ev, Event{Kind: EvStructHit, Plane: s.ID, Other: by, Value: taken, Pos: at, Weapon: weapon})
	if s.HP == 0 {
		s.Alive = false
		*ev = append(*ev, Event{Kind: EvStructDown, Plane: s.ID, Other: by, Pos: at})
	}
}

// structSweep is the first live structure (filtered by keep) the segment a→b
// enters, boxes grown by r: its entry parameter and index.
func (w *World) structSweep(a, b geom.Vec3, r float64, keep func(i int) bool) (float64, int, bool) {
	best, hit := math.Inf(1), -1
	g := geom.V(r, r, r)
	for i, s := range w.structs {
		if !s.Alive || !keep(i) {
			continue
		}
		bx := w.cfg.Map.Structures[i].Box
		if t, ok := maps.SegBox(a, b.Sub(a), bx.Min.Sub(g), bx.Max.Add(g)); ok && t < best {
			best, hit = t, i
		}
	}
	return best, hit, hit >= 0
}

// anyStruct keeps every live structure.
func anyStruct(int) bool { return true }

// solidStruct keeps the targets a plane can fly into (all but hangar targets).
func (w *World) solidStruct(i int) bool { return w.structs[i].Kind != maps.StructHangar }
