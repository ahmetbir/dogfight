package bot

import (
	"math"

	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/terrain"
)

// Env is what a bot knows of its room besides the snapshot.
type Env struct {
	Terrain *terrain.Map
	Map     *maps.Map // nil: no bases or buildings
	Mode    mode.Kind
	Wind    geom.Vec3 // the weather's base wind (no gusts); crabbed on final
}

type Difficulty uint8

const (
	Easy Difficulty = iota + 1
	Normal
	Hard
)

func ParseDifficulty(s string) (Difficulty, bool) {
	switch s {
	case "easy":
		return Easy, true
	case "normal":
		return Normal, true
	case "hard":
		return Hard, true
	}
	return 0, false
}

type params struct {
	reactTicks  int
	aimErr      float64 // rad
	flareChance float64
	fireAngle   float64 // rad
}

func paramsFor(d Difficulty) params {
	switch d {
	case Easy:
		return params{36, 0.07, 0.3, 0.07}
	case Hard:
		return params{7, 0.012, 0.95, 0.035}
	}
	return params{18, 0.035, 0.7, 0.05}
}

const decideEvery = 6 // ticks: 10 Hz thinking, spread over bots by ID

// botFlareGap is a bot's pace between flares, slower than the sim's
// FlareCooldown: the faster salvo is the human pilot's edge.
const botFlareGap = 60

// Brain is one bot pilot. It decides at 10 Hz and steers every tick toward
// the last decided direction.
type Brain struct {
	id  sim.ID
	d   Difficulty
	p   params
	rng *sim.RNG

	decided bool
	aim     geom.Vec3 // desired world direction
	steer   geom.Vec3 // aim raised clear of the terrain ahead (flown)

	avoidDir   geom.Vec3 // committed terrain escape (avoid.go)
	avoidUntil int       // tick until which avoidDir's heading is kept
	throttle   float64
	fire       bool
	missile    bool
	ab         bool
	flare      bool // one-shot, cleared once emitted
	bomb       bool // one-shot, cleared once emitted
	extend     bool // bombing run: flying out to come back on the target (bomber.go)
	runDrop    bool // a bomb left on the current run
	bombMisses int  // runs without a drop this sortie (reset by a rearm or a new life)

	target     sim.ID
	threat     sim.ID // missile being tracked
	detectedAt int
	flareReady bool // rolled at detection: this bot defends right (flares IR, beams radar) against this missile
	nextFlare  int  // earliest tick of the next drop (botFlareGap)

	// Runway phases (ground.go, land.go).
	life    int // Plane.Life the phase belongs to
	phase   phase
	route   []geom.Vec3 // taxi waypoints
	wp      int         // next waypoint
	from    geom.Vec3   // start of the current taxi leg
	side    int         // base in use
	dir     float64     // takeoff direction along the base axis: +1 / -1
	top     float64     // highest ground around the climbing plane (cached)
	topTick int         // tick of the next terrainTop sample

	// Return to base (land.go).
	outbound  bool    // on the outbound leg (joined)
	missed    bool    // went around: fly the outbound leg before final again
	outSide   float64 // +1 / -1: side of the outbound leg
	goArounds int     // go-arounds this life (reset by a rearm); past maxGoArounds no more returns
	holdStart int     // tick+1 the current wait for the runway began, 0 when not waiting
	park      bool    // the taxi route ends on the rearm spot, not the lineup
}

func New(id sim.ID, d Difficulty, seed int64) *Brain {
	return &Brain{id: id, d: d, p: paramsFor(d), rng: sim.NewRNG(seed)}
}

// Think returns this tick's input; call it every tick.
func (b *Brain) Think(s *sim.Snapshot, env *Env) sim.Input {
	self, ok := findPlane(s.Planes, b.id)
	if !ok || !self.Alive {
		b.decided, b.target, b.threat, b.phase = false, 0, 0, phAir
		return sim.Input{Throttle: 1}
	}
	if self.Life != b.life { // respawned, also by a round reset without a death
		b.life, b.phase, b.goArounds, b.holdStart = self.Life, phAir, 0, 0
		b.extend, b.runDrop, b.bombMisses = false, false, 0
	}
	if env.Map != nil && !self.Ground {
		switch {
		case b.phase == phAir && b.goArounds <= maxGoArounds && wantsRTB(self, s.Planes, isBomber(self, s.Planes, env.Mode)):
			b.startRTB(self, env)
		case (b.phase == phRTB || b.phase == phFinal) && enemyNear(self, s.Planes):
			b.phase = phAir // an enemy came close: fight
		}
	}
	if in, ok := b.ground(s, self, env); ok {
		return in
	}
	if !b.decided || (s.Tick+int(b.id))%decideEvery == 0 {
		b.decide(s, self, env)
		b.steer = safeAim(self, b.aim, env.Terrain)
		b.decided = true
	}
	pitch, roll, yaw := Steer(self.Rot, self.W, b.steer)
	in := sim.Input{Pitch: pitch, Roll: roll, Yaw: yaw, Throttle: b.throttle,
		AB: b.ab, Fire: b.fire, Missile: b.missile, Flare: b.flare, Bomb: b.bomb}
	b.flare, b.bomb = false, false
	return in
}

func findPlane(planes []sim.Plane, id sim.ID) (sim.Plane, bool) {
	for _, p := range planes {
		if p.ID == id {
			return p, true
		}
	}
	return sim.Plane{}, false
}

// decide runs the priority list: terrain, buildings and live targets,
// collision, bounds, evade, bombing run (base attack bombers), collect,
// attack, patrol.
func (b *Brain) decide(s *sim.Snapshot, self sim.Plane, env *Env) {
	b.fire, b.missile, b.ab, b.throttle = false, false, false, 1
	m, threatened := threat(self, s.Missiles)
	if threatened && m.ID != b.threat {
		b.threat, b.detectedAt = m.ID, s.Tick
		b.flareReady = b.rng.Float64() < b.p.flareChance
	}
	if !threatened {
		b.threat = 0
	}
	// Flares (IR only): once reacted, one per botFlareGap while the missile
	// keeps tracking inside FlareWarn; flareReady is the difficulty's roll.
	if threatened && m.Kind == sim.MissileIR && b.flareReady && s.Tick-b.detectedAt >= b.p.reactTicks &&
		m.Pos.Dist(self.Pos) < sim.FlareWarn && self.Flares > 0 && s.Tick >= self.FlareReadyTick && s.Tick >= b.nextFlare {
		b.flare, b.nextFlare = true, s.Tick+1+botFlareGap // the sim drops on the next tick
	}

	if dir, ok := avoidTerrain(self, env.Terrain); ok {
		if s.Tick < b.avoidUntil { // keep the committed escape heading, climb as steep as either asks
			h := flat(b.avoidDir)
			dir = geom.V(h.X, math.Max(dir.Y, b.avoidDir.Y)*math.Hypot(h.X, h.Z)/math.Max(1e-6, math.Hypot(dir.X, dir.Z)), h.Z).Norm()
			b.avoidUntil = s.Tick + avoidCommit
		} else if math.Abs(headingErr(self.Rot.Forward(), dir)) > 0.3 { // an escape turn: commit to it
			b.avoidDir, b.avoidUntil = dir, s.Tick+avoidCommit
		}
		b.aim, b.ab = dir, true
		return
	}
	if env.Map != nil {
		if dir, ok := avoidSolids(self, env.Map, s.Structures); ok {
			b.aim, b.ab = dir, true
			return
		}
	}
	if dir, ok := avoidCollision(self, s.Planes); ok {
		b.aim = dir
		return
	}
	if dir, ok := boundary(self, boundsLimit); ok {
		b.aim = turnBehind(self, dir)
		return
	}
	if threatened && s.Tick-b.detectedAt >= b.p.reactTicks {
		if m.Kind == sim.MissileRadar && b.flareReady && b.returnFire(self, m, s) {
			return
		}
		b.aim, b.ab = evadeDir(self, m), true
		if m.Kind == sim.MissileRadar && b.flareReady { // beam: across the line of sight, not away
			b.aim = beamDir(self, m)
		}
		return
	}
	if b.bomberRole(s, self, env) {
		return
	}
	if tg, ok := guiding(self, s); ok { // semi-active: keep the target in the nose
		b.target = tg.ID
		b.attack(self, tg)
		return
	}
	if dir, ok := collect(self, s.Powerups); ok {
		b.aim = dir
		return
	}
	if tg, ok := pickTarget(self, s.Planes, b.target); ok {
		b.target = tg.ID
		b.attack(self, tg)
		return
	}
	b.target = 0
	b.aim, b.throttle = turnBehind(self, patrolDir(self, env.Terrain)), 0.7
}

// attack points the nose at the gun lead point, perturbed by the difficulty's
// aim error, and fires when the nose is on it.
func (b *Brain) attack(self, tg sim.Plane) {
	lead := leadPoint(self, tg).Sub(self.Pos).Norm()
	b.aim = b.perturb(lead)
	dist := tg.Pos.Dist(self.Pos)
	fwd := self.Rot.Forward()
	b.fire = dist < gunRange && math.Acos(math.Max(-1, math.Min(1, fwd.Dot(b.aim)))) < b.p.fireAngle
	b.missile = self.Locked && self.LockTarget == tg.ID
	b.ab = dist > abRange && self.ABHeat < abSaveHeat // keep afterburner for escapes
}

// perturb rotates unit vector d by aimErr about a random axis perpendicular to it.
func (b *Brain) perturb(d geom.Vec3) geom.Vec3 {
	p1 := d.Cross(geom.V(0, 1, 0))
	if p1.Len() < 1e-6 {
		p1 = d.Cross(geom.V(1, 0, 0))
	}
	p1 = p1.Norm()
	p2 := d.Cross(p1)
	a := b.rng.Float64() * 2 * math.Pi
	axis := p1.Scale(math.Cos(a)).Add(p2.Scale(math.Sin(a)))
	return geom.AxisAngle(axis, b.p.aimErr).Rotate(d)
}
