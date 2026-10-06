package sim

import "playground/internal/geom"

func (w *World) setFlight(id ID, fs FlightState) {
	w.planes[id].FlightState = fs
	w.planes[id].Parked = false // a placed plane is not on its parking brake
}
func (w *World) clearProtection() {
	for _, p := range w.planes {
		p.ProtectUntil = 0
	}
}

func (w *World) addMissileForTest(owner, target ID, pos, vel geom.Vec3) {
	w.nextMissile++
	w.missiles = append(w.missiles, &Missile{ID: w.nextMissile, Owner: owner, Target: target, Pos: pos, Vel: vel, ExpireTick: w.tick + MissileLife})
}
