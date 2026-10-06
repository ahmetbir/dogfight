// Read-only HTTP API (/api/*): same-origin JSON with a timeout; every
// response is validated before the UI sees it.
import { normalizeCode } from "./code.ts";
import type { MapKind, Mode, WeatherKind } from "./protocol.ts";

const TIMEOUT_MS = 5000;
const MAX_ROOMS = 50;

export type RoomRow = {
  code: string; mode: Mode; map: MapKind; wx: WeatherKind;
  humans: number; seats: number; phase: "playing" | "ended"; left: number;
  teams?: [number, number]; // humans on NATO, Soviet (team and base modes)
};

const MODES: readonly string[] = ["team", "ffa", "base"] satisfies Mode[];
const MAPS: readonly string[] = ["ada", "sehir", "col", "dag"] satisfies MapKind[];
const WEATHERS: readonly string[] = ["acik", "bulutlu", "sisli", "yagmurlu", "firtina", "gece"] satisfies WeatherKind[];
const PHASES: readonly string[] = ["playing", "ended"];

type Obj = Record<string, unknown>;
const isObj = (v: unknown): v is Obj => typeof v === "object" && v !== null && !Array.isArray(v);
const count = (v: unknown, max = Number.MAX_SAFE_INTEGER): v is number => Number.isInteger(v) && (v as number) >= 0 && (v as number) <= max;
const oneOf = (v: unknown, set: readonly string[]): v is string => typeof v === "string" && set.includes(v);

export type Reply = { ok: boolean; status: number; body: unknown }; // body null when not JSON

/** GETs url; null on network errors and after timeoutMs. */
export async function request(url: string, headers: Record<string, string> = {}, timeoutMs = TIMEOUT_MS,
  fetchImpl: typeof fetch = (u, i) => fetch(u, i)): Promise<Reply | null> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), timeoutMs);
  try {
    const res = await fetchImpl(url, { headers, signal: ctl.signal, credentials: "same-origin", cache: "no-store" });
    let body: unknown = null;
    try {
      body = (await res.json()) as unknown;
    } catch {
      body = null;
    }
    return { ok: res.ok, status: res.status, body };
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}

/**
 * GETs url and parses the JSON body; null on network errors, non-2xx
 * statuses, bad JSON and after timeoutMs.
 */
export async function getJSON(url: string, headers: Record<string, string> = {}, timeoutMs = TIMEOUT_MS,
  fetchImpl?: typeof fetch): Promise<unknown | null> {
  const r = await request(url, headers, timeoutMs, fetchImpl);
  return r?.ok ? r.body : null;
}

/** Stats are switched off on this server (no data directory). */
export const STATS_OFF = "off";
export type Off = typeof STATS_OFF;

/** The server's 503 answer while stats are off (internal/server msgStatsOff). */
function statsOff(r: Reply | null): boolean {
  return r !== null && r.status === 503 && isObj(r.body) && r.body.error === "istatistik kapalı";
}

/** A stats endpoint: parsed body, STATS_OFF, or null on any other failure. */
async function getStats<T>(url: string, headers: Record<string, string>, parse: (v: unknown) => T | null, fetchImpl?: typeof fetch): Promise<T | Off | null> {
  const r = await request(url, headers, TIMEOUT_MS, fetchImpl);
  if (statsOff(r)) return STATS_OFF;
  return r?.ok ? parse(r.body) : null;
}

function roomRow(v: unknown): RoomRow | null {
  if (!isObj(v)) return null;
  const code = typeof v.code === "string" ? normalizeCode(v.code) : "";
  if (!code || code !== v.code) return null;
  if (!oneOf(v.mode, MODES) || !oneOf(v.map, MAPS) || !oneOf(v.wx, WEATHERS) || !oneOf(v.phase, PHASES)) return null;
  if (!count(v.humans, 99) || !count(v.seats, 99) || !count(v.left)) return null;
  const row: RoomRow = {
    code, mode: v.mode as Mode, map: v.map as MapKind, wx: v.wx as WeatherKind,
    humans: v.humans, seats: v.seats, phase: v.phase as RoomRow["phase"], left: v.left,
  };
  const t = v.teams;
  if (Array.isArray(t) && t.length === 2 && count(t[0], 99) && count(t[1], 99)) row.teams = [t[0], t[1]];
  return row;
}

/** The well-formed rows of an /api/rooms body (at most 50). */
export function parseRooms(v: unknown): RoomRow[] {
  if (!isObj(v) || !Array.isArray(v.rooms)) return [];
  const out: RoomRow[] = [];
  for (const r of v.rooms) {
    const row = roomRow(r);
    if (row) out.push(row);
    if (out.length === MAX_ROOMS) break;
  }
  return out;
}

export function fetchRooms(fetchImpl?: typeof fetch): Promise<RoomRow[] | null> {
  return getJSON("/api/rooms", {}, TIMEOUT_MS, fetchImpl).then((v) => (v === null ? null : parseRooms(v)));
}

export type Entry = { name: string; kills: number; deaths: number; wins: number; matches: number };
export type Board = { week: string; top: Entry[] };
export type Me = {
  name: string; kills: number; botKills: number; deaths: number; crashes: number; wins: number; matches: number;
  fired: number; hits: number; flight: number; favorite: string; weekKills: number;
};

const MAX_TOP = 20;
const NAME_MAX = 32;
const str = (v: unknown, max: number): v is string => typeof v === "string" && v.length <= max;

function entry(v: unknown): Entry | null {
  if (!isObj(v) || !str(v.name, NAME_MAX)) return null;
  if (!count(v.kills) || !count(v.deaths) || !count(v.wins) || !count(v.matches)) return null;
  return { name: v.name, kills: v.kills, deaths: v.deaths, wins: v.wins, matches: v.matches };
}

/** An /api/leaderboard body; malformed rows are dropped, a malformed body is null. */
export function parseLeaderboard(v: unknown): Board | null {
  if (!isObj(v) || !Array.isArray(v.top)) return null;
  const top: Entry[] = [];
  for (const r of v.top) {
    const e = entry(r);
    if (e) top.push(e);
    if (top.length === MAX_TOP) break;
  }
  return { week: str(v.week, 16) ? v.week : "", top };
}

/** An /api/me body, or null when any field is missing (botKills is optional). */
export function parseMe(v: unknown): Me | null {
  if (!isObj(v) || !str(v.name, NAME_MAX) || !str(v.favorite, 16)) return null;
  const nums = ["kills", "deaths", "crashes", "wins", "matches", "fired", "hits", "flight", "weekKills"] as const;
  if (!nums.every((k) => count(v[k]))) return null;
  const n = (k: (typeof nums)[number]) => v[k] as number;
  return {
    name: v.name, kills: n("kills"), botKills: count(v.botKills) ? v.botKills : 0, deaths: n("deaths"), crashes: n("crashes"),
    wins: n("wins"), matches: n("matches"), fired: n("fired"), hits: n("hits"), flight: n("flight"),
    favorite: v.favorite, weekKills: n("weekKills"),
  };
}

export function fetchLeaderboard(period: "week" | "all", fetchImpl?: typeof fetch): Promise<Board | Off | null> {
  return getStats(`/api/leaderboard?period=${period}`, {}, parseLeaderboard, fetchImpl);
}

/**
 * My pilot card; the token travels only in the X-Pilot-Token header. The
 * server answers {"pilot":{...}} or {"pilot":null} (no stats yet, or a bad
 * token: indistinguishable); null covers that and any failure.
 */
export function fetchMe(tok: string, fetchImpl?: typeof fetch): Promise<Me | Off | null> {
  return getStats("/api/me", { "X-Pilot-Token": tok }, (v) => (isObj(v) ? parseMe(v.pilot) : null), fetchImpl);
}
