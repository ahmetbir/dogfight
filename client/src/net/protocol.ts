// Wire messages; mirrors internal/protocol (JSON tags are authoritative).

export const VERSION = 2;

export type Team = "nato" | "soviet" | "none";
export type AircraftKind = "f16" | "f15" | "mig29" | "su27";
export type Mode = "team" | "ffa" | "base";
export type Difficulty = "easy" | "normal" | "hard";
export type Weapon = "cannon" | "missile" | "crash" | "ram" | "bounds" | "aa" | "bomb";
/** "shield" is kept for wire compatibility; the server never spawns it (FB-A 7). */
export type Item = "missiles" | "repair" | "shield" | "turbo";
export type EventKind =
  | "fire" | "hit" | "kill" | "lock" | "spawn" | "pickup" | "flare" | "mlaunch" | "mgone" | "rearm"
  | "bdrop" | "boom" | "shit" | "sdown" // base attack: bomb drop, bomb blast, structure hit, structure down
  | "decoy"; // a flare decoyed missile a (b: its target, o: shooter, p: the flare)

export type Vec3 = [number, number, number];
/** Quaternion on the wire: [w, x, y, z] (same order as testdata/vectors). */
export type WireQuat = [number, number, number, number];

/** Reorders a wire quaternion [w,x,y,z] to Three.js order [x,y,z,w]. */
export function toThreeQuat(q: WireQuat): [number, number, number, number] {
  return [q[1], q[2], q[3], q[0]];
}

// Client → server.

export type MapKind = "ada" | "sehir" | "col" | "dag";
export type WeatherKind = "acik" | "bulutlu" | "sisli" | "yagmurlu" | "firtina" | "gece";
export type StartKind = "pist" | "hava";
export type Visibility = "acik" | "ozel";

export type Hello = { t: "hello"; v: number; name: string; tok?: string };
/** Missing optional fields take the server defaults: ada, acik, hava, acik. */
export type Create = {
  t: "create"; mode: Mode; size: number; diff: Difficulty; seed?: number;
  map?: MapKind; wx?: WeatherKind; start?: StartKind; vis?: Visibility;
};
export type Join = { t: "join"; code: string };
export type Quick = { t: "quick" };
/** Quick chat preset 1..6. */
export type Chat = { t: "chat"; id: number };
/** Missile loadout of a sortie (pick screen); the wire number in snapshots is its index in LOADOUTS. */
export type Loadout = "ir" | "radar" | "mixed";
export const LOADOUTS: readonly Loadout[] = ["ir", "radar", "mixed"];
/** lo: the loadout from the next spawn (or at once with a respawning pick); missing keeps the current one. */
export type Pick = { t: "pick"; kind: AircraftKind; lo?: Loadout };
/** Team choice (team and base modes); "auto" lets the server balance. */
export type TeamChoice = "nato" | "soviet" | "auto";
export type TeamMsg = { t: "team"; team: TeamChoice };
export type In = {
  t: "in"; seq: number; // starts at 1
  p: number; r: number; y: number; th: number;
  ab: boolean; f: boolean; m: boolean; fl: boolean;
  g?: boolean;  // gear down wanted
  br?: boolean; // wheel brakes held
  bo?: boolean; // drop a bomb
};
export type Ping = { t: "ping"; ts: number };
export type ClientMsg = Hello | Create | Join | Quick | Pick | In | Ping | Chat | TeamMsg;

// Server → client.

export type AircraftInfo = {
  kind: AircraftKind; name: string; team: Team; maxHP: number;
  maxSpeed: number; maxSpeedAB: number; accel: number;
  rollRate: number; pitchRate: number; yawRate: number; cornerSpeed: number;
  lockRange: number; missiles: number; flares: number;
  rotateSpeed: number; // m/s: lift-off speed with the nose up
};

export type TerrainInfo = {
  size: number; res: number;
  heights: string; // base64 of little-endian uint16
  spots: Vec3[];   // powerup positions by spot index
  seed: string;    // decimal int64
};

/** Room weather: base wind (m/s), gust amplitude, lock-range scale. */
export type WeatherInfo = { kind: WeatherKind; wind: Vec3; gust: number; lockMul: number };

export type BaseInfo = {
  side: "nato" | "soviet"; c: Vec3; axis: [number, number]; inner: [number, number];
  areas: [number, number, number, number, number][]; // minX, minZ, maxX, maxZ, surf
  hangars: [number, number, number, number][];       // x, y, z, heading
};

/** A base attack target: box is min x,y,z, max x,y,z. */
export type StructInfo = {
  id: number; k: "hangar" | "fuel" | "radar" | "aa"; tm: "nato" | "soviet";
  box: [number, number, number, number, number, number]; hp: number;
};

export type MapInfo = {
  kind: MapKind; bases: BaseInfo[];
  bld: [number, number, number, number, number, number][]; // min x,y,z, max x,y,z
  structs?: StructInfo[]; // base attack only
};

export type Welcome = {
  t: "welcome"; you: number; code: string; mode: Mode;
  aircraft: AircraftInfo[]; terrain: TerrainInfo; map: MapInfo; weather: WeatherInfo; tick: number;
  start: StartKind;
  tok?: string; // set only when the server issued a new pilot token
};

export type PlaneJSON = {
  id: number; k: AircraftKind; tm: Team;
  p: Vec3; q: WireQuat; v: Vec3; th: number; hp: number;
  a: boolean;   // alive
  ht: number;   // cannon heat
  oh: boolean;  // overheated
  ms: number; fl: number;
  lk?: number;  // lock target id
  lp?: number;  // lock progress 0..1
  ld?: boolean; // locked
  sh?: boolean; // shield: no longer sent (FB-A 7), ignored if present
  tb?: boolean; pr?: boolean;
  oob?: number; // seconds out of bounds
  ab?: boolean; // afterburner (alive only)
  rs?: number;  // ticks until respawn (dead only)
  gr?: boolean; // landing gear down
  gd?: boolean; // on the wheels
  rr?: number;  // rearm progress 0..1
  bm?: number;  // bombs left
  w?: Vec3;     // body angular rate (rad/s), prediction state
  abh?: number; // afterburner heat 0..1
  abl?: boolean; // afterburner locked out until abh <= 0.3
  lo?: number;   // sortie loadout: index in LOADOUTS (missing: 0, IR)
  rm?: number;   // radar missiles left (ms counts the IR ones)
  lkk?: number;  // kind the lock is for: 1 radar (missing: IR)
};

/** mk: 1 radar (missing: IR). */
export type MissileJSON = { id: number; tg: number; p: Vec3; v: Vec3; mk?: number };
export type BombJSON = { id: number; p: Vec3; v: Vec3 };
/** A burning flare (position to 10 cm); gone from the snapshot once it burns out. */
export type FlareJSON = { id: number; p: Vec3 };
/** A base attack target's live HP; 0 means destroyed. */
export type StructHPJSON = { id: number; hp: number };
export type PowerupJSON = { s: number; k: Item; a: boolean };

export type EventJSON = {
  k: EventKind; tick: number; a: number; b?: number;
  p?: Vec3; v?: Vec3; val?: number; w?: Weapon; item?: Item;
  o?: number; // owner (mlaunch, bdrop, boom); shooter (decoy)
  mk?: number; // lock, mlaunch: 1 radar missile (missing: IR)
};

export type Snap = {
  t: "snap"; tick: number; ack: number;
  wt: number; // world tick (the wind's clock); tick is the game tick, which runs on between rounds
  planes: PlaneJSON[]; missiles: MissileJSON[]; pu: PowerupJSON[]; ev: EventJSON[];
  bo?: BombJSON[];     // base attack only
  st?: StructHPJSON[]; // base attack only
  fx?: FlareJSON[];    // burning flares (omitted when none)
};

export type LineJSON = { id: number; k: number; d: number; s: number };

export type RoundMsg = {
  t: "round"; phase: "playing" | "ended"; left: number; winner?: string;
  nato: number; soviet: number; board: LineJSON[];
  wt?: "nato" | "soviet";                // winning team
  wid?: number;                          // FFA winner's plane id
  obj?: { nato: number; soviet: number }; // base attack: remaining target HP per side
};

export type PlayerJSON = { id: number; name: string; team: Team; kind: AircraftKind; bot: boolean };
export type PlayersMsg = { t: "players"; list: PlayerJSON[] };
export type Pong = { t: "pong"; ts: number };
/** A fatal server error: code (net/codes.ts) picks the shown text, msg is the server's own text (fallback). */
export type ErrorMsg = { t: "error"; msg: string; code?: string };
/** Quick chat from plane `from`, preset `id`. */
export type ChatMsg = { t: "chat"; from: number; id: number };

/** A short, non-fatal HUD message (a refused team choice). */
export type NoticeMsg = { t: "notice"; msg: string; code?: string };

export type ServerMsg = Welcome | Snap | RoundMsg | PlayersMsg | Pong | ErrorMsg | ChatMsg | NoticeMsg;
