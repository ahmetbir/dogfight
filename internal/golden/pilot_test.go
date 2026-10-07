package golden

import (
	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/protocol"
	"playground/internal/sim"
	"playground/internal/weather"
)

// autoPilot flies a human seat with a bot brain fed only from the snapshots
// that seat receives, so the scenarios carry real human play (takeoff,
// fights, missiles, flares, deaths) through the human input path.
type autoPilot struct {
	id    sim.ID
	brain *bot.Brain
	env   *bot.Env
	life  map[sim.ID]int // spawns seen per plane (the brain resets per life)
	alive map[sim.ID]bool
}

func newPilot(id sim.ID, s game.Settings, seed int64) *autoPilot {
	mk, wx := s.Map, s.Weather
	if mk == 0 {
		mk = maps.Ada
	}
	if wx == 0 {
		wx = weather.Clear
	}
	m := maps.Build(mk, s.Seed)
	return &autoPilot{
		id:    id,
		brain: bot.New(id, bot.Hard, seed),
		env:   &bot.Env{Terrain: m.Terrain, Map: m, Mode: s.Mode, Wind: weather.Wind(wx, s.Seed)},
		life:  map[sim.ID]int{},
		alive: map[sim.ID]bool{},
	}
}

// input is the brain's input for the latest snapshot, as an "in" message.
// Unlike a bot, the human fires at whatever its lock holds.
func (p *autoPilot) input(snap protocol.Snap, seq uint32) protocol.ClientMsg {
	in := p.brain.Think(p.world(snap), p.env)
	for _, j := range snap.Planes {
		if j.ID == p.id && j.Locked {
			in.Missile = true
		}
	}
	return protocol.ClientMsg{T: protocol.TIn, Seq: seq, P: in.Pitch, R: in.Roll, Y: in.Yaw, Th: in.Throttle,
		AB: in.AB, F: in.Fire, M: in.Missile, FL: in.Flare, G: in.Gear, BR: in.Brake, BO: in.Bomb, Sel: uint8(in.Pick)}
}

// world rebuilds the part of the sim snapshot a brain reads from the wire.
func (p *autoPilot) world(s protocol.Snap) *sim.Snapshot {
	out := &sim.Snapshot{Tick: s.Tick}
	for _, j := range s.Planes {
		if j.Alive && !p.alive[j.ID] {
			p.life[j.ID]++
		}
		p.alive[j.ID] = j.Alive
		k, _ := sim.ParseKind(j.Kind)
		tm, _ := protocol.ParseTeam(j.Team)
		pl := sim.Plane{ID: j.ID, Kind: k, Team: tm, HP: j.HP, Alive: j.Alive, Heat: j.Heat,
			Missiles: j.Missiles, Flares: j.Flares, LockTarget: j.Lock, Locked: j.Locked, Life: p.life[j.ID],
			Bombs: j.Bombs, Loadout: sim.Loadout(j.Loadout), Radars: j.Radars, LockKind: sim.MissileKind(j.LockKind)}
		pl.Pos, pl.Vel = vec(j.Pos), vec(j.Vel)
		pl.Rot = geom.Quat{W: j.Rot[0], X: j.Rot[1], Y: j.Rot[2], Z: j.Rot[3]}
		pl.Throttle, pl.Gear, pl.Ground, pl.ABHeat, pl.ABLock = j.Th, j.Gear, j.Ground, j.ABHeat, j.ABLock
		if j.W != nil {
			pl.W = vec(*j.W)
		}
		out.Planes = append(out.Planes, pl)
	}
	for _, m := range s.Missiles {
		out.Missiles = append(out.Missiles, sim.Missile{ID: m.ID, Target: m.Target, Pos: vec(m.Pos), Vel: vec(m.Vel),
			Kind: sim.MissileKind(m.Kind)})
	}
	return out
}

func vec(a [3]float64) geom.Vec3 { return geom.V(a[0], a[1], a[2]) }
