package sim

type Kind uint8

const (
	F16 Kind = iota + 1
	F15
	MiG29
	Su27
	F22
	Su57
	F14
	MiG31
	A10
	Su25
	Rafale
	Typhoon
	MiG21
	FA18
	Su30
	F4
	MiG23
	lastKind = MiG23
)

type Team uint8

const (
	TeamNone Team = iota
	TeamNATO
	TeamSoviet
)

type Spec struct {
	Kind                         Kind
	Name                         string
	Team                         Team
	MaxHP                        float64
	MaxSpeed, MaxSpeedAB         float64 // m/s
	Accel                        float64 // m/s² thrust at full throttle
	RollRate, PitchRate, YawRate float64 // rad/s at corner speed
	CornerSpeed                  float64
	Missiles, Flares             int
	LockRange                    float64
	RotateSpeed                  float64 // m/s: lift-off speed with the nose up
	// The airframe as modelled (client/static/models/<kind>.glb, tools/blender),
	// in metres: overall length and span (tip stores included) and how far the
	// nose sits ahead of the origin. The client's render tests check them
	// against the committed models. Hit, ram and wall spheres and the muzzle
	// derive from them below, by one rule for every kind.
	Length, Span, Nose float64
	// ExtraBombs is added to a base attack sortie's bombs (World Config.Bombs):
	// the attack jets carry more.
	ExtraBombs int
	Role       Role
}

// Role is what a kind is for; the client shows it on the pick screen and in
// the manual (client/src/ui/roles.ts, pinned by internal/match/book_rules_test.go).
type Role string

const (
	RoleLight       Role = "light"       // light and agile, quick roll and pitch
	RoleMulti       Role = "multi"       // all-rounders, more missiles and armour
	RoleStealth     Role = "stealth"     // stealthy 5th gen: fast and agile, fewer missiles
	RoleInterceptor Role = "interceptor" // fastest, longest lock range, sluggish roll
	RoleAttack      Role = "attack"      // slow, very tough, flares and extra bombs for bases
	RoleCheap       Role = "cheap"       // cheap and fragile, quick but two missiles
	RoleHeavy       Role = "heavy"       // old fast heavies: speed, wide turns
)

// MuzzleLead is how far ahead of the nose a round leaves the gun.
const MuzzleLead = 0.4

// HitRadius is the bullet sphere: the airframe's farthest point from the
// origin (nose, tail or wingtip), so a round through any of them counts.
// Bigger jets are bigger targets.
func (s Spec) HitRadius() float64 { return max(s.Nose, s.Length-s.Nose, s.Span/2) }

// RamRadius is the plane-plane collision sphere, 1.2 × the hit sphere (the
// F-16's is about v1's 9 m). Two planes ram when their centres come closer
// than the sum of their radii.
func (s Spec) RamRadius() float64 { return 1.2 * s.HitRadius() }

// WallRadius is the sphere against buildings and hangar walls: half the span,
// so a wingtip touching a wall crashes, but at most MaxWallRadius. Every kind
// must still fit its hangar (TestWallRadiusFitsHangar).
func (s Spec) WallRadius() float64 { return min(s.Span/2, MaxWallRadius) }

// MaxWallRadius caps the wall sphere below the hangar roof (8.5 m above the
// wheels): a sphere is as tall as it is wide, so the two widest jets (F-14 at
// its mid sweep, A-10) would hit the roof with their whole span. Their tips
// may graze a wall by up to 0.8 m.
const MaxWallRadius = 8.4

// Muzzle is the distance ahead of the origin where a round leaves the gun.
func (s Spec) Muzzle() float64 { return s.Nose + MuzzleLead }

const (
	StallSpeed = 90.0
	Gravity    = 14.0
	Ceiling    = 3000.0
	Slip       = 3.0
	Dt         = 1.0 / 60
)

// Each row carries its Role (above); a role's kinds share a character, the
// numbers make each its own.
//
// Balance: TestBalance -balance (internal/game) flies a bot round-robin over
// every pair of kinds; the numbers below are tuned so every kind's win rate is
// near the mean.
var specs = [...]Spec{
	//        kind, name, team, HP, speed, AB, accel, roll, pitch, yaw, corner, missiles, flares, lock, rotate, length, span, nose, extra bombs, role
	F16:     {F16, "F-16", TeamNATO, 90, 230, 290, 48, 4.2, 1.6, 0.5, 170, 5, 8, 995, 78, 15.22, 9.75, 7.62, 0, RoleLight},
	F15:     {F15, "F-15", TeamNATO, 100, 240, 310, 44, 3.0, 1.36, 0.45, 185, 6, 8, 1000, 82, 19.47, 13.04, 9.72, 0, RoleMulti},
	MiG29:   {MiG29, "MiG-29", TeamSoviet, 115, 225, 285, 46, 3.4, 1.75, 0.5, 150, 4, 10, 980, 75, 17.21, 11.36, 8.66, 0, RoleLight},
	Su27:    {Su27, "Su-27", TeamSoviet, 105, 245, 315, 45, 3.1, 1.4, 0.45, 175, 5, 8, 1000, 85, 21.9, 14.57, 10.95, 0, RoleMulti},
	F22:     {F22, "F-22", TeamNATO, 100, 250, 320, 50, 4.0, 1.7, 0.55, 165, 4, 8, 985, 80, 19.22, 13.56, 9.62, 0, RoleStealth},
	Su57:    {Su57, "Su-57", TeamSoviet, 100, 250, 320, 49, 3.8, 1.75, 0.55, 160, 4, 8, 985, 82, 20.6, 14.1, 10.3, 0, RoleStealth},
	F14:     {F14, "F-14", TeamNATO, 90, 255, 330, 46, 2.6, 1.35, 0.45, 190, 6, 8, 1025, 85, 19.55, 18.3, 9.8, 0, RoleInterceptor},
	MiG31:   {MiG31, "MiG-31", TeamSoviet, 105, 260, 340, 47, 2.3, 1.2, 0.4, 200, 6, 6, 1050, 90, 22.8, 13.46, 11.8, 0, RoleInterceptor},
	A10:     {A10, "A-10", TeamNATO, 175, 200, 245, 34, 2.8, 1.4, 0.5, 155, 4, 12, 940, 65, 16.95, 17.52, 8.85, 2, RoleAttack},
	Su25:    {Su25, "Su-25", TeamSoviet, 180, 205, 250, 36, 3.0, 1.45, 0.5, 158, 4, 12, 925, 68, 16.65, 14.72, 8.8, 2, RoleAttack},
	Rafale:  {Rafale, "Rafale", TeamNATO, 105, 235, 295, 48, 4.4, 1.7, 0.55, 160, 6, 8, 950, 76, 15.55, 11.26, 8.1, 0, RoleLight},
	Typhoon: {Typhoon, "Typhoon", TeamNATO, 105, 240, 305, 50, 4.2, 1.65, 0.55, 165, 6, 8, 950, 78, 16.45, 11.24, 8.55, 0, RoleLight},
	MiG21:   {MiG21, "MiG-21", TeamSoviet, 70, 235, 300, 47, 4.0, 1.6, 0.5, 165, 2, 6, 1000, 80, 15.4, 7.14, 8.1, 0, RoleCheap},
	FA18:    {FA18, "F/A-18", TeamNATO, 115, 225, 280, 44, 3.6, 1.7, 0.55, 155, 6, 8, 970, 74, 17.35, 11.82, 8.85, 0, RoleMulti},
	Su30:    {Su30, "Su-30", TeamSoviet, 120, 240, 310, 44, 3.2, 1.5, 0.5, 170, 6, 8, 985, 85, 21.9, 14.57, 10.95, 0, RoleMulti},
	F4:      {F4, "F-4", TeamNATO, 90, 235, 300, 46, 2.8, 1.3, 0.45, 185, 6, 8, 1000, 85, 19.45, 11.7, 9.85, 0, RoleHeavy},
	MiG23:   {MiG23, "MiG-23", TeamSoviet, 95, 245, 315, 48, 3.0, 1.35, 0.45, 185, 4, 8, 1000, 85, 17.4, 12.6, 9.1, 0, RoleHeavy},
}

var kindKeys = [...]string{
	F16: "f16", F15: "f15", MiG29: "mig29", Su27: "su27", F22: "f22", Su57: "su57", F14: "f14", MiG31: "mig31",
	A10: "a10", Su25: "su25", Rafale: "rafale", Typhoon: "typhoon", MiG21: "mig21", FA18: "f18", Su30: "su30",
	F4: "f4", MiG23: "mig23",
}

// SpecOf panics on an unknown kind (programming error).
func SpecOf(k Kind) Spec {
	if k < F16 || k > lastKind {
		panic("sim: unknown aircraft kind")
	}
	return specs[k]
}

// Kinds lists every aircraft in Kind order (the welcome's table order).
func Kinds() []Kind {
	out := make([]Kind, 0, lastKind)
	for k := F16; k <= lastKind; k++ {
		out = append(out, k)
	}
	return out
}

func ParseKind(s string) (Kind, bool) {
	for _, k := range Kinds() {
		if kindKeys[k] == s {
			return k, true
		}
	}
	return 0, false
}

func (k Kind) String() string {
	if k < F16 || k > lastKind {
		return "unknown"
	}
	return kindKeys[k]
}
