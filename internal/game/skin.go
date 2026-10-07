package game

import (
	"playground/internal/rng"
	"playground/internal/sim"
)

// StandardSkin is the paint a player has without a (valid) choice: the
// team's grey, as before skins.
const StandardSkin = "standard"

// skinTable lists the paint schemes in the order bots draw from; kinds nil
// means every jet may wear it. Skins are cosmetic only: the client draws
// them (client/src/render/skins.ts, SKIN_KINDS, pinned by TestClientSkinsMatchServer).
var skinTable = [...]struct {
	id    string
	kinds []sim.Kind
}{
	{StandardSkin, nil},
	{"airsup", nil},
	{"desert", nil},
	{"winter", nil},
	{"naval", nil},
	{"splinter", nil},
	{"night", nil},
	{"flanker", []sim.Kind{sim.Su27, sim.Su30}},
	{"blackband", []sim.Kind{sim.F14, sim.F4}},
}

// Skins returns the paint schemes kind may wear, standard first.
func Skins(kind sim.Kind) []string {
	out := make([]string, 0, len(skinTable))
	for _, s := range skinTable {
		if s.kinds == nil || containsKind(s.kinds, kind) {
			out = append(out, s.id)
		}
	}
	return out
}

// SkinFor returns id if kind may wear it, else StandardSkin (an unknown or
// missing id from an older client).
func SkinFor(kind sim.Kind, id string) string {
	for _, s := range Skins(kind) {
		if s == id {
			return id
		}
	}
	return StandardSkin
}

// botSkin is a bot's paint, drawn from its kind's schemes by the room seed
// and the seat.
func botSkin(kind sim.Kind, seed int64, id sim.ID) string {
	ss := Skins(kind)
	return ss[int(rng.Mix(seed, uint64(id)+skinSalt)*float64(len(ss)))%len(ss)]
}

const skinSalt = 0x5c1 << 20 // keeps the skin draw apart from other uses of the seed

func containsKind(ks []sim.Kind, k sim.Kind) bool {
	for _, x := range ks {
		if x == k {
			return true
		}
	}
	return false
}

// SetSkin sets id's paint for the aircraft it picked (unknown or not
// allowed for it: standard). The paint is kept per kind: a jet still in the
// air keeps its own until the picked one spawns.
func (g *Game) SetSkin(id sim.ID, skin string) {
	p, ok := g.players[id]
	if !ok {
		return
	}
	if s := SkinFor(p.Kind, skin); s != p.paint(p.Kind) {
		p.paints[p.Kind] = s
		g.rosterVer++
	}
}

// paint is p's paint for kind: valid for it by construction (SetSkin), else standard.
func (p *Player) paint(kind sim.Kind) string {
	if s, ok := p.paints[kind]; ok {
		return s
	}
	return StandardSkin
}
