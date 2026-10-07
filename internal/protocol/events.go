package protocol

import "playground/internal/sim"

type EventJSON struct {
	K    string      `json:"k"` // fire|hit|kill|lock|spawn|pickup|flare|mlaunch|mgone|rearm|bdrop|boom|shit|sdown|decoy
	Tick int         `json:"tick"`
	A    sim.ID      `json:"a"`
	B    sim.ID      `json:"b,omitempty"`
	Pos  *[3]float64 `json:"p,omitempty"`
	Vel  *[3]float64 `json:"v,omitempty"`
	Val  float64     `json:"val,omitempty"`
	W    string      `json:"w,omitempty"`    // cannon|missile|crash|ram|bounds|aa|bomb
	Item string      `json:"item,omitempty"` // missiles|repair|shield|turbo
	O    sim.ID      `json:"o,omitempty"`    // owner (mlaunch, bdrop, boom); shooter (decoy)
	MK   uint8       `json:"mk,omitempty"`   // lock, mlaunch: missile kind, 0 IR (omitted), 1 radar
	Z    string      `json:"z,omitempty"`    // hit: crit|engine|controls|avionics (a graze: omitted)
}

var eventNames = [...]string{
	sim.EvFire: "fire", sim.EvHit: "hit", sim.EvKill: "kill", sim.EvLock: "lock", sim.EvSpawn: "spawn",
	sim.EvPickup: "pickup", sim.EvFlare: "flare", sim.EvMissileLaunch: "mlaunch", sim.EvMissileGone: "mgone",
	sim.EvRearm: "rearm", sim.EvBombDrop: "bdrop", sim.EvBombHit: "boom", sim.EvStructHit: "shit",
	sim.EvStructDown: "sdown", sim.EvDecoy: "decoy",
}

var weaponNames = [...]string{
	sim.WCannon: "cannon", sim.WMissile: "missile", sim.WCrash: "crash", sim.WRam: "ram", sim.WBounds: "bounds",
	sim.WAA: "aa", sim.WBomb: "bomb",
}

var zoneNames = [...]string{sim.ZoneCrit: "crit", sim.ZoneEngine: "engine", sim.ZoneControls: "controls", sim.ZoneAvionics: "avionics"}

var itemNames = [...]string{
	sim.PUMissiles: "missiles", sim.PURepair: "repair", sim.PUShield: "shield", sim.PUTurbo: "turbo",
}

func itemName(k sim.PowerupKind) string {
	if int(k) < len(itemNames) {
		return itemNames[k]
	}
	return ""
}

// NewEvents converts the events of one game tick.
func NewEvents(evs []sim.Event, tick int) []EventJSON {
	out := make([]EventJSON, 0, len(evs))
	for _, e := range evs {
		if int(e.Kind) >= len(eventNames) || eventNames[e.Kind] == "" {
			continue
		}
		j := EventJSON{K: eventNames[e.Kind], Tick: tick, A: e.Plane, B: e.Other, Val: round(e.Value, 100), Item: itemName(e.Item), O: e.By,
			MK: uint8(e.Missile)}
		if int(e.Weapon) < len(weaponNames) {
			j.W = weaponNames[e.Weapon]
		}
		if e.Kind == sim.EvHit && int(e.Zone) < len(zoneNames) {
			j.Z = zoneNames[e.Zone]
		}
		if e.Kind != sim.EvLock {
			p := r3(e.Pos, 100)
			j.Pos = &p
		}
		if e.Kind == sim.EvFire || e.Kind == sim.EvSpawn || e.Kind == sim.EvBombDrop {
			v := r3(e.Vel, 100)
			j.Vel = &v
		}
		out = append(out, j)
	}
	return out
}
