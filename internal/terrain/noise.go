package terrain

import "math"

type noise struct{ seed uint64 }

func (n noise) hash(x, z int64) float64 {
	h := uint64(x)*0x9E3779B97F4A7C15 ^ uint64(z)*0xC2B2AE3D27D4EB4F ^ n.seed
	h ^= h >> 31
	h *= 0xBF58476D1CE4E5B9
	h ^= h >> 29
	return float64(h>>11) / float64(1<<53) // [0,1)
}

func smooth(t float64) float64 { return t * t * (3 - 2*t) }

func (n noise) value(x, z float64) float64 {
	x0, z0 := math.Floor(x), math.Floor(z)
	tx, tz := smooth(x-x0), smooth(z-z0)
	ix, iz := int64(x0), int64(z0)
	a := n.hash(ix, iz) + (n.hash(ix+1, iz)-n.hash(ix, iz))*tx
	b := n.hash(ix, iz+1) + (n.hash(ix+1, iz+1)-n.hash(ix, iz+1))*tx
	return a + (b-a)*tz
}

// fbm returns fractal noise in [0,1].
func (n noise) fbm(x, z float64, octaves int) float64 {
	sum, amp, norm := 0.0, 1.0, 0.0
	for range octaves {
		sum += n.value(x, z) * amp
		norm += amp
		amp *= 0.5
		x, z = x*2.03, z*2.03
	}
	return sum / norm
}
