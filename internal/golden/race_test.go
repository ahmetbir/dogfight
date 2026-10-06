//go:build race

package golden

// raceBuild: a race detector build is compiled differently, and a long
// chaotic scenario (room_round) was observed to reach other floats in it,
// deterministically; such a scenario keeps a golden file of its own.
const raceBuild = true
