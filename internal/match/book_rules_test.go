package match

import (
	"bufio"
	"math"
	"os"
	"regexp"
	"strconv"
	"strings"
	"testing"

	"playground/internal/bot"
	"playground/internal/game"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/stats"
	"playground/internal/terrain"
	"playground/internal/weather"
)

// rulesFile is the pilot's manual constants module (client/src/book/rules.ts).
const rulesFile = "../../client/src/book/rules.ts"

var ruleLine = regexp.MustCompile(`^\s*([A-Za-z][A-Za-z0-9]*):\s*(-?[0-9]+(?:\.[0-9]+)?),\s*(?://.*)?$`)

// readRules parses the RULES object: one `name: number,` per line; comments
// and blank lines are skipped, anything else fails (no expressions).
func readRules(t *testing.T) map[string]float64 {
	t.Helper()
	f, err := os.Open(rulesFile)
	if err != nil {
		t.Fatal(err)
	}
	defer f.Close()
	out := map[string]float64{}
	in := false
	sc := bufio.NewScanner(f)
	for sc.Scan() {
		line := sc.Text()
		trim := strings.TrimSpace(line)
		switch {
		case !in:
			in = strings.HasPrefix(trim, "export const RULES = {")
		case strings.HasPrefix(trim, "}"):
			return out
		case trim == "" || strings.HasPrefix(trim, "//"):
		default:
			m := ruleLine.FindStringSubmatch(line)
			if m == nil {
				t.Fatalf("rules.ts: not a `name: number,` line: %q", line)
			}
			v, err := strconv.ParseFloat(m[2], 64)
			if err != nil {
				t.Fatal(err)
			}
			if _, dup := out[m[1]]; dup {
				t.Fatalf("rules.ts: %s twice", m[1])
			}
			out[m[1]] = v
		}
	}
	t.Fatal("rules.ts: RULES block not found or not closed")
	return nil
}

var aircraftLine = regexp.MustCompile(`^\s*([a-z0-9]+): \["([^"]+)", "(nato|soviet)"\],$`)

// readAircraft parses the AIRCRAFT block: kind → "Name team".
func readAircraft(t *testing.T) map[string]string {
	t.Helper()
	b, err := os.ReadFile(rulesFile)
	if err != nil {
		t.Fatal(err)
	}
	out := map[string]string{}
	in := false
	for _, line := range strings.Split(string(b), "\n") {
		trim := strings.TrimSpace(line)
		switch {
		case !in:
			in = strings.HasPrefix(trim, "export const AIRCRAFT = {")
		case strings.HasPrefix(trim, "}"):
			return out
		default:
			m := aircraftLine.FindStringSubmatch(line)
			if m == nil {
				t.Fatalf("rules.ts AIRCRAFT: not a `kind: [\"Name\", \"team\"],` line: %q", line)
			}
			out[m[1]] = m[2] + " " + m[3]
		}
	}
	t.Fatal("rules.ts: AIRCRAFT block not found or not closed")
	return nil
}

const ticks = float64(tickRate)

func deg(rad float64) float64 { return rad * 180 / math.Pi }

// goRules is the Go side of every RULES entry.
func goRules(t *testing.T) map[string]float64 {
	t.Helper()
	r := map[string]float64{
		"stallSpeed": sim.StallSpeed, "ceiling": sim.Ceiling, "abBurnS": 1 / sim.ABHeatRise, "abCoolS": 1 / sim.ABHeatCool,
		"abUnlock": sim.ABUnlock, "pushRatio": sim.PushRatio, "gearMaxDeploy": sim.GearMaxDeploy, "gearMaxSpeed": sim.GearMaxSpeed,

		"taxiGovernor": sim.TaxiGovernor, "taxiMaxSpeed": sim.TaxiMaxSpeed, "grassMaxSpeed": sim.GrassMaxSpeed,
		"grassMaxSlopeDeg": deg(sim.GrassMaxSlope), "maxSinkRate": sim.MaxSinkRate, "maxTouchBankDeg": deg(sim.MaxTouchBank),
		"parkGraceS": sim.ParkGraceTicks / ticks, "rearmS": sim.RearmTicks / ticks, "rearmMaxSpeed": sim.RearmMaxSpeed,

		"airProtectS": sim.ProtectTicks / ticks, "liftoffProtectS": sim.LiftoffProtectTicks / ticks,
		"fireProtectS": sim.FireProtectTicks / ticks, "respawnS": sim.RespawnTicks / ticks,

		"gunRate": ticks / sim.GunInterval, "bulletSpeed": sim.BulletSpeed, "gunRange": sim.BulletSpeed * sim.BulletLife / ticks,
		"bulletDmg": sim.BulletDmg, "gunShotsToOverheat": 1 / sim.HeatPerShot, "gunCoolS": 1 / sim.HeatCool,
		"overheatS": sim.OverheatTicks / ticks,

		"lockConeDeg": deg(sim.LockHalfAngle), "lockS": sim.LockSeconds, "missileSpeed": sim.MissileSpeed,
		"missileDmg": sim.MissileDmg, "missileLifeS": sim.MissileLife / ticks, "missileCooldownS": sim.MissileCooldown / ticks,
		"missileGroundLoseS": sim.MissileGroundLoseTicks / ticks, "missileRegenS": sim.MissileRegenTicks / ticks,
		"flareRegenS": sim.FlareRegenTicks / ticks, "flareCooldownS": sim.FlareCooldown / ticks,
		"flareBurnS": sim.FlareLife / ticks, "flareRange": sim.FlareRange, "flareChance": sim.FlareChance, "flareWarn": sim.FlareWarn,
		"radarRangeMul": sim.RadarRangeMul, "radarLockS": sim.RadarLockSeconds, "radarLeashDeg": deg(sim.RadarLeash),
		"radarBeamSpeed": sim.RadarBeamSpeed, "radarBeamS": sim.RadarBeamTicks / ticks, "radarDmg": sim.RadarDmg, "radarMinRange": sim.RadarMinRange,

		"dmgEngine1": sim.EngineFactor[1], "dmgEngine2": sim.EngineFactor[2], "dmgControls1": sim.ControlsFactor[1],
		"dmgControls2": sim.ControlsFactor[2], "dmgAvionics1": sim.AvionicsLockMul[1], "dmgAvionics2": sim.AvionicsLockMul[2],
		"missileCrit": sim.MissileZoneOdds[sim.ZoneCrit], "missileEngine": sim.MissileZoneOdds[sim.ZoneEngine],
		"missileControls": sim.MissileZoneOdds[sim.ZoneControls], "missileAvionics": sim.MissileZoneOdds[sim.ZoneAvionics],
		"bulletCrit": sim.BulletZoneOdds[sim.ZoneCrit], "bulletEngine": sim.BulletZoneOdds[sim.ZoneEngine],
		"bulletControls": sim.BulletZoneOdds[sim.ZoneControls], "bulletAvionics": sim.BulletZoneOdds[sim.ZoneAvionics],

		"bombRadius": sim.BombRadius, "bombStructDmg": sim.BombStructDmg, "bombPlaneDmg": sim.BombPlaneDmg,
		"structCannonMul": sim.StructCannonMul, "aaRange": sim.AARange, "aaDmg": sim.AADmg, "aaShotsPerS": ticks / sim.AAInterval,
		"hangars": maps.HangarCount,

		"teamKills": float64(mode.NewRules(mode.Team, 2).KillLimit()), "ffaKills": float64(mode.NewRules(mode.FFA, 2).KillLimit()),
		"roundMin":     float64(mode.NewRules(mode.Team, 2).DurationTicks()) / ticks / 60,
		"baseRoundMin": float64(mode.NewRules(mode.Base, 2).DurationTicks()) / ticks / 60,
		"roundEndS":    game.EndedTicks / ticks, "teamMaxPerSide": float64(mode.NewRules(mode.Team, 99).Slots() / 2),
		"teamMinPerSide": float64(mode.NewRules(mode.Team, 0).Slots() / 2),
		"ffaMin":         float64(mode.NewRules(mode.FFA, 0).Slots()), "ffaMax": float64(mode.NewRules(mode.FFA, 99).Slots()),
		"matchS": MatchTicks / ticks, "playHalf": terrain.PlayHalf,
		"newPilotFlightS": stats.MinFlightTicks / ticks, "pickTimeoutS": game.PickTimeoutTicks / ticks,
		"switchCooldownS": game.SwitchCooldownTicks / ticks, "switchCloseS": game.SwitchCloseTicks / ticks,
		"hurtS": game.HurtTicks / ticks,
	}
	if math.Abs(float64(mode.NewRules(mode.FFA, 2).DurationTicks())/ticks/60-r["roundMin"]) > 1e-9 {
		t.Fatal("team and FFA rounds differ in length: the manual quotes one roundMin")
	}
	weathers := map[string]weather.Kind{
		"Acik": weather.Clear, "Bulutlu": weather.Cloudy, "Sisli": weather.Fog, "Yagmurlu": weather.Rain,
		"Firtina": weather.Storm, "Gece": weather.Night,
	}
	for name, k := range weathers {
		s := k.Spec()
		r["lockMul"+name], r["wind"+name], r["gust"+name] = s.LockMul, s.WindSpeed, s.Gust
	}
	for _, k := range sim.Kinds() {
		s, n := sim.SpecOf(k), k.String()
		for f, v := range map[string]float64{
			"MaxHP": s.MaxHP, "MaxSpeed": s.MaxSpeed, "MaxSpeedAB": s.MaxSpeedAB, "Accel": s.Accel, "RollRate": s.RollRate,
			"PitchRate": s.PitchRate, "YawRate": s.YawRate, "CornerSpeed": s.CornerSpeed, "Missiles": float64(s.Missiles),
			"Flares": float64(s.Flares), "LockRange": s.LockRange, "RotateSpeed": s.RotateSpeed,
		} {
			r[n+f] = v
		}
	}
	structureRules(t, r)
	return r
}

// structureRules adds the base attack numbers read off a built map, a base
// game's loadout and a scoreboard.
func structureRules(t *testing.T, r map[string]float64) {
	t.Helper()
	hp, count := map[maps.StructKind]float64{}, map[maps.StructKind]float64{}
	var side0, total float64
	for _, d := range maps.Build(maps.Ada, 1).Structures {
		if d.Side != 0 {
			continue
		}
		if prev, ok := hp[d.Kind]; ok && prev != d.MaxHP {
			t.Fatalf("%v targets differ in HP: %v vs %v", d.Kind, prev, d.MaxHP)
		}
		hp[d.Kind] = d.MaxHP
		count[d.Kind]++
		side0++
		total += d.MaxHP
	}
	r["targetsPerBase"], r["baseHP"] = side0, total
	r["hangarHP"], r["fuelHP"], r["radarHP"], r["aaHP"] = hp[maps.StructHangar], hp[maps.StructFuel], hp[maps.StructRadar], hp[maps.StructAA]
	r["hangarTargets"], r["fuelTargets"], r["radarTargets"], r["aaTargets"] = count[maps.StructHangar], count[maps.StructFuel], count[maps.StructRadar], count[maps.StructAA]

	g := game.New(game.Settings{Mode: mode.Base, Size: 1, Difficulty: bot.Easy, Seed: 2})
	planes := g.Snapshot().Planes
	if len(planes) == 0 {
		t.Fatal("base game without planes")
	}
	r["bombs"] = float64(planes[0].Bombs)
	for _, p := range planes {
		if float64(p.Bombs) != r["bombs"] {
			t.Fatalf("bomb loadouts differ: %d vs %v", p.Bombs, r["bombs"])
		}
	}

	b := mode.NewScoreboard()
	b.Apply(sim.Event{Kind: sim.EvStructDown, Plane: sim.StructID(1, 0), Other: 7}, func(sim.ID) sim.Team { return sim.TeamNATO })
	for _, l := range b.Lines() {
		if l.ID == 7 {
			r["structPoints"] = float64(l.Score)
		}
	}
}

// The pilot's manual quotes these numbers; drift between rules.ts and the
// server fails here.
func TestBookRulesMatchServer(t *testing.T) {
	ts, gov := readRules(t), goRules(t)
	for k, want := range gov {
		got, ok := ts[k]
		switch {
		case !ok:
			t.Errorf("rules.ts lacks %s (Go %v)", k, want)
		case math.Abs(got-want) > 1e-9*math.Max(1, math.Abs(want)):
			t.Errorf("rules.ts %s = %v, Go %v", k, got, want)
		}
	}
	for k := range ts {
		if _, ok := gov[k]; !ok {
			t.Errorf("rules.ts %s has no Go counterpart in this test", k)
		}
	}
}

// The manual's built-in aircraft names and teams match the server's table.
func TestBookAircraftMatchServer(t *testing.T) {
	got := readAircraft(t)
	teams := map[sim.Team]string{sim.TeamNATO: "nato", sim.TeamSoviet: "soviet"}
	if len(got) != len(sim.Kinds()) {
		t.Fatalf("rules.ts AIRCRAFT has %d kinds, Go %d", len(got), len(sim.Kinds()))
	}
	for _, k := range sim.Kinds() {
		s := sim.SpecOf(k)
		if want := s.Name + " " + teams[s.Team]; got[k.String()] != want {
			t.Errorf("rules.ts AIRCRAFT %s = %q, Go %q", k, got[k.String()], want)
		}
	}
}
