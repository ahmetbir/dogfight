package sim

import (
	"math"

	"playground/internal/geom"
)

// WindAt is the wind at tick: the base wind plus a deterministic gust along
// and across it (spec §3.8). client/src/sim/wind.ts mirrors it.
func WindAt(base geom.Vec3, gust float64, tick int) geom.Vec3 {
	if gust == 0 {
		return base
	}
	t := float64(tick) * Dt
	along := gust * (0.6*math.Sin(2*math.Pi*t/7.3) + 0.4*math.Sin(2*math.Pi*t/2.9+1.3))
	cross := 0.5 * gust * math.Sin(2*math.Pi*t/5.1+0.7)
	d := base.Norm()
	side := geom.V(-d.Z, 0, d.X)
	return base.Add(d.Scale(along)).Add(side.Scale(cross))
}
