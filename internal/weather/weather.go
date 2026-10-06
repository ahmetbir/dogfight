// Package weather is the room's weather table: lock-range scale and wind.
// Visuals live in the client (render/weather.ts).
package weather

import (
	"math"

	"playground/internal/geom"
	"playground/internal/rng"
)

type Kind uint8

const (
	Clear Kind = iota + 1
	Cloudy
	Fog
	Rain
	Storm
	Night
)

var names = [...]string{Clear: "acik", Cloudy: "bulutlu", Fog: "sisli", Rain: "yagmurlu", Storm: "firtina", Night: "gece"}

// Spec is a weather's server-side effect: lock-range scale, steady wind
// speed (m/s) and gust amplitude (m/s).
type Spec struct{ LockMul, WindSpeed, Gust float64 }

var specs = [...]Spec{Clear: {1, 0, 0}, Cloudy: {1, 3, 1}, Fog: {0.6, 0, 0}, Rain: {0.8, 6, 2}, Storm: {0.7, 10, 6}, Night: {1, 2, 0}}

// ParseKind maps a wire name (acik bulutlu sisli yagmurlu firtina gece) to its Kind.
func ParseKind(s string) (Kind, bool) {
	for k := Clear; k <= Night; k++ {
		if names[k] == s {
			return k, true
		}
	}
	return 0, false
}

// Valid reports whether k is one of the six kinds.
func (k Kind) Valid() bool { return k >= Clear && k <= Night }

func (k Kind) String() string {
	if !k.Valid() {
		return names[Clear]
	}
	return names[k]
}

// Spec is k's table row; unknown or zero kinds are Clear.
func (k Kind) Spec() Spec {
	if !k.Valid() {
		return specs[Clear]
	}
	return specs[k]
}

// Wind is the steady wind of k for a room seed: horizontal, seed-chosen direction.
func Wind(k Kind, seed int64) geom.Vec3 {
	a := 2 * math.Pi * rng.Mix(seed^0x57494E44, 0)
	return geom.V(math.Cos(a), 0, math.Sin(a)).Scale(k.Spec().WindSpeed)
}
