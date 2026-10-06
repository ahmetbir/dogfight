package protocol

import (
	"encoding/base64"
	"encoding/binary"
	"encoding/json"
	"strconv"

	"playground/internal/game"
	"playground/internal/geom"
	"playground/internal/maps"
	"playground/internal/mode"
	"playground/internal/sim"
	"playground/internal/terrain"
	"playground/internal/weather"
)

type Welcome struct {
	T        string          `json:"t"` // "welcome"
	You      sim.ID          `json:"you"`
	Code     string          `json:"code"`
	Mode     string          `json:"mode"`
	Aircraft []AircraftInfo  `json:"aircraft"`
	Terrain  json.RawMessage `json:"terrain"` // TerrainInfo, marshalled once per room
	Map      json.RawMessage `json:"map"`     // MapInfo, marshalled once per room
	Weather  json.RawMessage `json:"weather"` // WeatherInfo, marshalled once per room
	Start    string          `json:"start"`   // pist|hava
	Tick     int             `json:"tick"`
	Tok      string          `json:"tok,omitempty"` // pilot token, only when just issued
}

type AircraftInfo struct {
	Kind        string  `json:"kind"`
	Name        string  `json:"name"`
	Team        string  `json:"team"`
	MaxHP       float64 `json:"maxHP"`
	MaxSpeed    float64 `json:"maxSpeed"`
	MaxSpeedAB  float64 `json:"maxSpeedAB"`
	Accel       float64 `json:"accel"`
	RollRate    float64 `json:"rollRate"`
	PitchRate   float64 `json:"pitchRate"`
	YawRate     float64 `json:"yawRate"`
	CornerSpeed float64 `json:"cornerSpeed"`
	LockRange   float64 `json:"lockRange"`
	Missiles    int     `json:"missiles"`
	Flares      int     `json:"flares"`
	RotateSpeed float64 `json:"rotateSpeed"` // m/s: lift-off speed with the nose up
}

type TerrainInfo struct {
	Size    float64      `json:"size"`
	Res     int          `json:"res"`
	Heights string       `json:"heights"` // base64 of little-endian uint16
	Spots   [][3]float64 `json:"spots"`   // powerup positions by spot index
	Seed    string       `json:"seed"`    // decimal; int64 exceeds JS integer precision
}

// WeatherInfo is the room's weather (spec §5): wind is the base wind, gust
// its amplitude, lockMul the scale on every lock range.
type WeatherInfo struct {
	Kind    string     `json:"kind"`
	Wind    [3]float64 `json:"wind"`
	Gust    float64    `json:"gust"`
	LockMul float64    `json:"lockMul"`
}

// MapInfo is the static map layout (spec §4.5).
type MapInfo struct {
	Kind    string       `json:"kind"`
	Bases   []BaseJSON   `json:"bases"`
	Bld     [][6]float64 `json:"bld"`               // min x,y,z, max x,y,z (0.1 m); city buildings only
	Structs []StructJSON `json:"structs,omitempty"` // base attack targets; base mode only
}

// StructJSON is one base attack target: kind hangar|fuel|radar|aa, owning
// team, box (min x,y,z, max x,y,z at 0.1 m) and full HP.
type StructJSON struct {
	ID  sim.ID     `json:"id"`
	K   string     `json:"k"`
	Tm  string     `json:"tm"`
	Box [6]float64 `json:"box"`
	HP  float64    `json:"hp"`
}

type BaseJSON struct {
	Side    string       `json:"side"` // nato|soviet
	C       [3]float64   `json:"c"`
	Axis    [2]float64   `json:"axis"` // x, z
	Inner   [2]float64   `json:"inner"`
	Areas   [][5]float64 `json:"areas"`   // minX, minZ, maxX, maxZ, surf
	Hangars [][4]float64 `json:"hangars"` // x, y, z, heading
}

// WelcomeSource is the slice of the game a welcome is built from.
type WelcomeSource interface {
	Terrain() *terrain.Map
	Map() *maps.Map
	Settings() game.Settings
	Tick() int
	PowerupSpots() []geom.Vec3
}

// Static is a room's never-changing welcome payload, encoded once per room
// (the ~45 KB heightmap, the map layout and the weather), not once per join.
type Static struct{ Terrain, Map, Weather json.RawMessage }

func NewStatic(g WelcomeSource) Static {
	return Static{Terrain: TerrainJSON(g), Map: MapJSON(g.Map(), g.Settings().Mode == mode.Base), Weather: WeatherJSON(g.Settings())}
}

// NewWelcome builds a welcome around the room's Static payload.
func NewWelcome(you sim.ID, code string, g WelcomeSource, st Static) Welcome {
	kinds := sim.Kinds()
	ac := make([]AircraftInfo, 0, len(kinds))
	for _, k := range kinds {
		s := sim.SpecOf(k)
		ac = append(ac, AircraftInfo{
			Kind: k.String(), Name: s.Name, Team: TeamName(s.Team),
			MaxHP: s.MaxHP, MaxSpeed: s.MaxSpeed, MaxSpeedAB: s.MaxSpeedAB, Accel: s.Accel,
			RollRate: s.RollRate, PitchRate: s.PitchRate, YawRate: s.YawRate,
			CornerSpeed: s.CornerSpeed, LockRange: s.LockRange,
			Missiles: s.Missiles, Flares: s.Flares, RotateSpeed: s.RotateSpeed,
		})
	}
	return Welcome{
		T: "welcome", You: you, Code: code, Mode: g.Settings().Mode.String(), Aircraft: ac, Tick: g.Tick(),
		Terrain: st.Terrain, Map: st.Map, Weather: st.Weather, Start: startName(g.Settings().Start),
	}
}

// startName is a start mode's wire name; zero (Go default) is the air start.
func startName(m sim.StartMode) string {
	if m == sim.StartRunway {
		return "pist"
	}
	return "hava"
}

// TerrainJSON encodes the game's TerrainInfo; it never changes for a room.
func TerrainJSON(g WelcomeSource) json.RawMessage {
	q := g.Terrain().Encode()
	raw := make([]byte, 2*len(q))
	for i, v := range q {
		binary.LittleEndian.PutUint16(raw[2*i:], v)
	}
	spots := g.PowerupSpots()
	sp := make([][3]float64, len(spots))
	for i, v := range spots {
		sp[i] = r3(v, 100)
	}
	b, err := json.Marshal(TerrainInfo{
		Size: terrain.Size, Res: terrain.Res,
		Heights: base64.StdEncoding.EncodeToString(raw),
		Spots:   sp,
		Seed:    strconv.FormatInt(g.Settings().Seed, 10),
	})
	if err != nil {
		panic(err) // plain numbers and strings always marshal
	}
	return b
}

// WeatherJSON encodes the room's WeatherInfo; wind to 1 mm/s (the sim keeps
// the unrounded wind, far below what reconcile notices).
func WeatherJSON(st game.Settings) json.RawMessage {
	k := st.Weather
	ws := k.Spec()
	b, err := json.Marshal(WeatherInfo{Kind: k.String(), Wind: r3(weather.Wind(k, st.Seed), 1000), Gust: ws.Gust, LockMul: ws.LockMul})
	if err != nil {
		panic(err) // plain numbers and strings always marshal
	}
	return b
}

// MapJSON encodes the static map layout; buildings to 0.1 m. withStructs
// adds the base attack targets.
func MapJSON(m *maps.Map, withStructs bool) json.RawMessage {
	info := MapInfo{Kind: m.Kind.String(), Bld: make([][6]float64, 0, len(m.Buildings))}
	for _, b := range m.Bases {
		info.Bases = append(info.Bases, baseJSON(b))
	}
	for _, b := range m.Buildings {
		info.Bld = append(info.Bld, box10(b))
	}
	if withStructs {
		for _, d := range m.Structures {
			info.Structs = append(info.Structs, StructJSON{ID: sim.StructID(d.Side, d.Index), K: d.Kind.String(),
				Tm: TeamName(sim.Team(d.Side + 1)), Box: box10(d.Box), HP: d.MaxHP})
		}
	}
	out, err := json.Marshal(info)
	if err != nil {
		panic(err) // plain numbers always marshal
	}
	return out
}

// box10 is a box as min x,y,z, max x,y,z at 0.1 m.
func box10(b maps.Box) [6]float64 {
	return [6]float64{round(b.Min.X, 10), round(b.Min.Y, 10), round(b.Min.Z, 10),
		round(b.Max.X, 10), round(b.Max.Y, 10), round(b.Max.Z, 10)}
}

// baseJSON converts a base; Side 0 is TeamNATO (1), 1 is TeamSoviet (2).
func baseJSON(b maps.Base) BaseJSON {
	j := BaseJSON{Side: TeamName(sim.Team(b.Side + 1)), C: r3(b.Center, 100),
		Axis: [2]float64{b.Axis.X, b.Axis.Z}, Inner: [2]float64{b.Inner.X, b.Inner.Z}}
	for _, a := range b.Areas {
		j.Areas = append(j.Areas, [5]float64{a.MinX, a.MinZ, a.MaxX, a.MaxZ, float64(a.Surf)})
	}
	for _, h := range b.Hangars {
		j.Hangars = append(j.Hangars, [4]float64{h.Spawn.X, h.Spawn.Y, h.Spawn.Z, round(h.Heading, 1e6)})
	}
	return j
}
