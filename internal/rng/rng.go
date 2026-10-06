// Package rng is seeded splitmix64 for deterministic map and weather generation.
// The simulation keeps its own v1 RNG; its sequence is pinned by the vectors.
package rng

const golden = 0x9E3779B97F4A7C15

func mix(z uint64) uint64 {
	z = (z ^ (z >> 30)) * 0xBF58476D1CE4E5B9
	z = (z ^ (z >> 27)) * 0x94D049BB133111EB
	return z ^ (z >> 31)
}

func unit(z uint64) float64 { return float64(z>>11) / float64(1<<53) }

// Mix is the i-th value in [0,1) of seed's sequence, without state.
func Mix(seed int64, i uint64) float64 { return unit(mix(uint64(seed) + (i+1)*golden)) }

// Stream is a stateful splitmix64 sequence.
type Stream struct{ s uint64 }

// New starts the stream for seed; salt separates independent uses of one seed.
func New(seed int64, salt uint64) *Stream { return &Stream{s: uint64(seed) ^ salt} }

// Float returns the next value in [0,1).
func (r *Stream) Float() float64 {
	r.s += golden
	return unit(mix(r.s))
}
