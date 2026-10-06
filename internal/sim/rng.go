package sim

// RNG is a splitmix64 generator; the only source of randomness in the sim.
type RNG struct{ s uint64 }

func NewRNG(seed int64) *RNG { return &RNG{s: uint64(seed)} }

func (r *RNG) Uint64() uint64 {
	r.s += 0x9E3779B97F4A7C15
	z := r.s
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

func (r *RNG) Float64() float64 { return float64(r.Uint64()>>11) / float64(1<<53) }
