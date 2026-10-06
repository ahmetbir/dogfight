package sim

type Kind uint8

const (
	F16 Kind = iota + 1
	F15
	MiG29
	Su27
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
}

const (
	StallSpeed = 90.0
	Gravity    = 14.0
	Ceiling    = 3000.0
	Slip       = 3.0
	Dt         = 1.0 / 60
)

var specs = [...]Spec{
	F16:   {F16, "F-16", TeamNATO, 90, 230, 290, 48, 4.2, 1.6, 0.5, 170, 5, 8, 900, 78},
	F15:   {F15, "F-15", TeamNATO, 120, 240, 310, 44, 3.0, 1.36, 0.45, 185, 6, 8, 1075, 82},
	MiG29: {MiG29, "MiG-29", TeamSoviet, 100, 225, 285, 46, 3.4, 1.75, 0.5, 150, 4, 10, 950, 75},
	Su27:  {Su27, "Su-27", TeamSoviet, 110, 245, 315, 45, 3.1, 1.4, 0.45, 175, 5, 8, 1050, 85},
}

var kindKeys = [...]string{F16: "f16", F15: "f15", MiG29: "mig29", Su27: "su27"}

// SpecOf panics on an unknown kind (programming error).
func SpecOf(k Kind) Spec {
	if k < F16 || k > Su27 {
		panic("sim: unknown aircraft kind")
	}
	return specs[k]
}

func Kinds() []Kind { return []Kind{F16, F15, MiG29, Su27} }

func ParseKind(s string) (Kind, bool) {
	for _, k := range Kinds() {
		if kindKeys[k] == s {
			return k, true
		}
	}
	return 0, false
}

func (k Kind) String() string {
	if k < F16 || k > Su27 {
		return "unknown"
	}
	return kindKeys[k]
}
