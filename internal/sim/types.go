package sim

import (
	"math"

	"playground/internal/geom"
)

type ID uint32

type Input struct {
	Pitch, Roll, Yaw         float64 // [-1,1]
	Throttle                 float64 // [0,1]
	AB, Fire, Missile, Flare bool
	Gear, Brake              bool // desired gear-down state; wheel brakes (held)
	Bomb                     bool // drop one bomb (one-shot)
}

// Clamp bounds the axes; non-finite values (NaN, ±Inf) become 0.
func (in Input) Clamp() Input {
	in.Pitch = clampFinite(in.Pitch, -1, 1)
	in.Roll = clampFinite(in.Roll, -1, 1)
	in.Yaw = clampFinite(in.Yaw, -1, 1)
	in.Throttle = clampFinite(in.Throttle, 0, 1)
	return in
}

func clampFinite(v, lo, hi float64) float64 {
	if math.IsNaN(v) || math.IsInf(v, 0) {
		return 0
	}
	return max(lo, min(hi, v))
}

type Plane struct {
	ID                               ID
	Kind, NextKind                   Kind
	Team                             Team
	FlightState                      // Pos, Rot, Vel, Throttle (see flight.go)
	HP                               float64
	Alive                            bool
	AB                               bool // afterburner input this tick (render only)
	RespawnTick                      int
	Heat                             float64
	OverheatUntil, GunReadyTick      int
	Missiles, Flares                 int
	MissileReadyTick, FlareReadyTick int
	LockTarget                       ID
	LockTime                         float64
	Locked                           bool
	TurboUntil, ProtectUntil         int
	OutOfBounds                      float64
	MissileRegenAt, FlareRegenAt     int         // tick of the next +1; 0 while full
	Life                             int         // increments per spawn; Reseat keeps it
	RunwayStart                      bool        // this life began parked in a hangar
	Parked                           bool        // parking brake: held until the pilot first asks for thrust
	ParkedTick                       int         // tick the parking brake was set
	GroundProtect                    bool        // protection renews while on the ground
	RearmTicks                       int         // ticks stopped on an own base toward a rearm
	Bombs, BombReadyTick             int         // bombs left this sortie (base attack); next drop tick
	WheelsTicks                      int         // consecutive ticks on the wheels (missiles drop a target after MissileGroundLoseTicks)
	Loadout, NextLoadout             Loadout     // this sortie's missile loadout; the one the next spawn takes
	Radars                           int         // radar missiles left (Missiles counts the IR ones)
	RadarRegenAt                     int         // tick of the next +1 radar missile; 0 while at the regen cap
	LockKind                         MissileKind // the kind the current lock is for (fired by the missile key)
}

type Bullet struct {
	Owner      ID // 0 for AA shells
	Team       Team
	Pos, Vel   geom.Vec3
	ExpireTick int
	Dmg        float64
	Weapon     Weapon
}

type Missile struct {
	ID, Owner, Target ID
	Decoy             ID // flare chased after a successful decoy roll (Target is 0 then)
	Team              Team
	Pos, Vel          geom.Vec3
	ExpireTick        int
	Kind              MissileKind
	BeamTicks         int // radar: consecutive ticks the target has been beaming it
}

type PowerupKind uint8

const (
	PUMissiles PowerupKind = iota + 1
	PURepair
	PUShield // removed from the game (FB-A 7): kept for the wire, never spawned
	PUTurbo
)

type Powerup struct {
	Spot        int
	Kind        PowerupKind
	Pos         geom.Vec3
	Active      bool
	RespawnTick int
}

type Weapon uint8

const (
	WCannon Weapon = iota + 1
	WMissile
	WCrash
	WRam
	WBounds
	WAA
	WBomb
)

type EventKind uint8

const (
	EvFire EventKind = iota + 1
	EvHit
	EvKill
	EvLock
	EvSpawn
	EvPickup
	EvFlare
	EvMissileLaunch
	EvMissileGone
	EvRearm
	EvStructHit  // Plane: structure, Other: attacker, Value: damage, Weapon
	EvStructDown // Plane: structure, Other: attacker
	EvBombDrop   // Plane: bomb, By: owner, Pos, Vel
	EvBombHit    // Plane: bomb, By: owner, Pos
	EvDecoy      // Plane: missile, Other: its target (the flare's dropper), By: shooter, Pos: the flare
)

type Event struct {
	Kind     EventKind
	Plane    ID // subject: shooter, victim, locker, spawned plane...
	Other    ID // attacker / target, 0 if none
	Pos, Vel geom.Vec3
	Value    float64 // damage, etc.
	Weapon   Weapon
	Item     PowerupKind
	By       ID          // owner (missile launch, bombs)
	Missile  MissileKind // EvLock, EvMissileLaunch: the missile's kind
}

type Snapshot struct {
	Tick       int
	Planes     []Plane
	Missiles   []Missile
	Powerups   []Powerup
	Structures []Structure // nil unless Config.Structures
	Bombs      []Bomb
	Flares     []Flare // burning flares, drop order
}
