// Pure data mirrored from server messages.
import type {
  AircraftInfo, BombJSON, EventJSON, LobbyMsg, MapInfo, MissileJSON, PlaneJSON, PlayerJSON, PowerupJSON, RoundMsg, ServerMsg,
  TerrainInfo, WeatherInfo,
} from "../net/protocol.ts";
import { InterpBuffer, ServerClock } from "../predict/interp.ts";
import { decodeHeights } from "../render/heightmap.ts";
import type { FlightState } from "../sim/flight.ts";
import { flareViews, type FlareView } from "./flares.ts";

export type ServerEvent = EventJSON;

/** Wire plane → flight state (wire quaternion is [w, x, y, z]). */
export function toFlight(p: PlaneJSON): FlightState {
  return {
    pos: { x: p.p[0], y: p.p[1], z: p.p[2] },
    rot: { w: p.q[0], x: p.q[1], y: p.q[2], z: p.q[3] },
    vel: { x: p.v[0], y: p.v[1], z: p.v[2] },
    th: p.th,
    gear: !!p.gr,
    ground: !!p.gd,
    w: p.w ? { x: p.w[0], y: p.w[1], z: p.w[2] } : undefined,
    abh: p.abh ?? 0,
    abl: !!p.abl,
  };
}

/** Someone has a hard lock on me or a missile is tracking me. */
export function threatened(s: GameState): boolean {
  if (s.missiles.some((m) => m.tg === s.you)) return true;
  for (const p of s.planes.values()) if (p.id !== s.you && p.a && p.lk === s.you && p.ld) return true;
  return false;
}

export class GameState {
  you = 0;
  code = "";
  mode = "";
  start = "";  // "hava" (air) or "pist" (runway) spawns
  aircraft = new Map<string, AircraftInfo>();
  terrain: TerrainInfo | null = null;
  map: MapInfo | null = null;
  heights: Uint16Array | null = null; // decoded terrain.heights (prediction ground)
  weather: WeatherInfo | null = null;  // null: calm
  players = new Map<number, PlayerJSON>();
  round: RoundMsg | null = null;
  lobby: LobbyMsg | null = null; // a created room's lobby state (null: quick play)
  planes = new Map<number, PlaneJSON>(); // latest snapshot
  interp = new Map<number, InterpBuffer>(); // remote planes
  missiles: MissileJSON[] = [];
  powerups: PowerupJSON[] = [];
  bombs: BombJSON[] = [];                   // base attack: falling bombs
  flares: FlareView[] = [];                 // burning flares
  myFlareTick = -Infinity;                  // game tick of my last flare drop
  structs = new Map<number, number>();      // base attack: structure id → HP (0: destroyed)
  clock = new ServerClock();
  tick = 0;   // game tick of the latest snapshot
  wt = 0;     // world tick of the latest snapshot (wind clock)
  ack = 0;    // last input seq the server applied to us
  snapAt = 0; // local ms the latest snapshot arrived

  /** The room waits in its pre-match lobby (no world, no clock). */
  inLobby(): boolean {
    return this.round?.phase === "lobby";
  }

  /** Applies m received at local time nowMs; returns the snapshot's events. */
  apply(m: ServerMsg, nowMs: number): ServerEvent[] {
    switch (m.t) {
      case "welcome":
        this.you = m.you;
        this.code = m.code;
        this.mode = m.mode;
        this.start = m.start ?? "";
        this.aircraft = new Map(m.aircraft.map((a) => [a.kind, a]));
        this.terrain = m.terrain;
        this.heights = decodeHeights(m.terrain.heights);
        this.map = m.map;
        this.weather = m.weather ?? null;
        this.players = new Map();
        this.round = null;
        this.lobby = null;
        this.planes = new Map();
        this.interp = new Map();
        this.missiles = [];
        this.powerups = [];
        this.bombs = [];
        this.flares = [];
        this.myFlareTick = -Infinity;
        this.structs = new Map();
        this.clock = new ServerClock();
        this.tick = m.tick;
        this.wt = 0;
        this.ack = 0;
        return [];
      case "snap":
        this.snap(m.tick, m.ack, m.planes, nowMs);
        this.flares = flareViews(this.flares, m.fx ?? [], (m.wt - this.wt) / 60, this.planes.values());
        for (const e of m.ev) if (e.k === "flare" && e.a === this.you) this.myFlareTick = e.tick;
        this.wt = m.wt;
        this.missiles = m.missiles;
        this.powerups = m.pu;
        this.bombs = m.bo ?? [];
        this.structs = new Map((m.st ?? []).map((s) => [s.id, s.hp]));
        return m.ev;
      case "players":
        this.players = new Map(m.list.map((p) => [p.id, p]));
        return [];
      case "round":
        this.round = m;
        return [];
      case "lobby":
        this.lobby = m;
        return [];
      default:
        return [];
    }
  }

  private snap(tick: number, ack: number, planes: PlaneJSON[], nowMs: number): void {
    this.clock.observe(tick, nowMs);
    const t = ServerClock.serverMs(tick);
    const next = new Map<number, PlaneJSON>();
    for (const p of planes) {
      next.set(p.id, p);
      if (p.id === this.you || !p.a) continue;
      let buf = this.interp.get(p.id);
      if (!buf || !this.planes.get(p.id)?.a) { // new or respawned: no streak from the wreck
        buf = new InterpBuffer();
        this.interp.set(p.id, buf);
      }
      buf.push(t, toFlight(p));
    }
    for (const id of this.interp.keys()) if (!next.has(id)) this.interp.delete(id);
    this.planes = next;
    this.tick = tick;
    this.ack = ack;
    this.snapAt = nowMs;
  }
}
