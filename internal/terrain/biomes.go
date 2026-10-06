package terrain

import (
	"math"

	"playground/internal/rng"
)

// grid fills a Res×Res raw height grid from f(x, z) at the node coordinates.
func grid(f func(x, z float64) float64) []float64 {
	raw := make([]float64, Res*Res)
	for zi := range Res {
		for xi := range Res {
			raw[zi*Res+xi] = f(NodeCoord(xi), NodeCoord(zi))
		}
	}
	return raw
}

// CityRaw is the coastal city (spec §4.1 sehir): plain, northern hills, southern sea.
func CityRaw(seed int64) []float64 {
	n := noise{seed: uint64(seed)*0x9E3779B97F4A7C15 + 2}
	return grid(func(x, z float64) float64 {
		plain := 12 + 18*n.fbm(x/2500, z/2500, 3)
		hills := math.Pow(n.fbm(x/1200+11, z/1200-5, 4), 2.2) * 700 * Smoothstep(-2000, -3800, z)
		coast := Smoothstep(2600, 3600, z)
		return (plain+hills)*(1-coast) - 40*coast
	})
}

// DesertRaw is the desert (spec §4.1 col): dunes, mesas, canyons and one oasis.
func DesertRaw(seed int64) []float64 {
	n := noise{seed: uint64(seed)*0x9E3779B97F4A7C15 + 3}
	ox, oz := (rng.Mix(seed, 0)-0.5)*1500, (rng.Mix(seed, 1)-0.5)*1500
	return grid(func(x, z float64) float64 {
		dunes := 25 * (0.5 + 0.5*math.Sin((0.8*x+0.6*z)/180+3*n.fbm(x/900, z/900, 2)))
		mesa := Smoothstep(0.58, 0.62, n.fbm(x/1600+7, z/1600-3, 4)) * (220 + 120*n.fbm(x/500, z/500, 2))
		c := math.Abs(2*n.fbm(x/1100-9, z/1100+4, 3) - 1)
		canyon := (1 - Smoothstep(0, 0.06, c)) * 90
		h := math.Max(6, 40+dunes+mesa-canyon)
		o := math.Hypot(x-ox, z-oz)
		return math.Min(h, -6+(h+6)*Smoothstep(120, 260, o))
	})
}

// MountainRaw is the range (spec §4.1 dag): ridged peaks cut by three valleys.
func MountainRaw(seed int64) []float64 {
	n := noise{seed: uint64(seed)*0x9E3779B97F4A7C15 + 4}
	return grid(func(x, z float64) float64 {
		ridge := 1 - math.Abs(2*n.fbm(x/1300+3, z/1300-8, 5)-1)
		mount := math.Pow(ridge, 2.2)*2000 + n.fbm(x/600, z/600, 3)*250
		vW := 1 - Smoothstep(250, 900, math.Abs(x+2600))
		vE := 1 - Smoothstep(250, 900, math.Abs(x-2600))
		vC := 0.6 * (1 - Smoothstep(250, 900, math.Abs(z)))
		v := math.Max(vW, math.Max(vE, vC))
		return 60 + mount*(1-0.9*v)
	})
}
