// Where the threat to me comes from: the nearest missile tracking me (or,
// before any is fired, a plane locked on me), as a clock position, the turn
// that beams a radar missile, and the HUD arrow's angle around the reticle.
import type { MissileJSON, PlaneJSON } from "../net/protocol.ts";
import { cross, dist, dot, len, sub, v3, type V3 } from "../sim/vec.ts";
import { kindOf, type MissileKind } from "./loadout.ts";

/** Beaming wants the missile at my 3 or 9 o'clock; within this of either the turn is done. */
export const BEAM_HOLD = (15 * Math.PI) / 180;

export type Threat = { pos: V3; dist: number; kind: MissileKind | "lock" };

/** The nearest missile tracking me, else a plane holding a lock on me; null when nothing threatens me. */
export function threatSource(me: V3, you: number, missiles: readonly MissileJSON[], planes: Iterable<PlaneJSON>, only?: MissileKind): Threat | null {
  let best: Threat | null = null;
  for (const m of missiles) {
    if (m.tg !== you || (only && kindOf(m.mk) !== only)) continue;
    const pos = v3(m.p[0], m.p[1], m.p[2]);
    const d = dist(me, pos);
    if (!best || d < best.dist) best = { pos, dist: d, kind: kindOf(m.mk) };
  }
  if (best || only) return best;
  for (const p of planes) {
    if (p.id === you || !p.a || p.lk !== you || !p.ld) continue;
    const pos = v3(p.p[0], p.p[1], p.p[2]);
    const d = dist(me, pos);
    if (!best || d < best.dist) best = { pos, dist: d, kind: "lock" };
  }
  return best;
}

/** Horizontal bearing of `at` from my heading (rad): 0 ahead, + right, ±π behind. */
export function relBearing(me: V3, fwd: V3, at: V3): number {
  const h = Math.hypot(fwd.x, fwd.z) || 1;
  const f = { x: fwd.x / h, z: fwd.z / h };
  const d = sub(at, me);
  return Math.atan2(d.x * -f.z + d.z * f.x, d.x * f.x + d.z * f.z); // right = (−f.z, f.x)
}

/** Clock position of a relative bearing: 12 ahead, 3 right, 6 behind, 9 left. */
export function clockOf(rel: number): number {
  const n = Math.round((rel * 6) / Math.PI);
  return ((n % 12) + 12) % 12 || 12;
}

/**
 * The turn that puts a missile at bearing rel on my 3 or 9 o'clock (the
 * nearer one): turning right moves it anticlockwise round me. "hold" once
 * it is within BEAM_HOLD of either.
 */
export function beamTurn(rel: number): "left" | "right" | "hold" {
  const wrap = (a: number) => Math.atan2(Math.sin(a), Math.cos(a));
  const toRight = wrap(rel - Math.PI / 2);
  const toLeft = wrap(rel + Math.PI / 2);
  const off = Math.abs(toRight) <= Math.abs(toLeft) + 1e-9 ? toRight : toLeft; // dead astern: always the 3 o'clock side
  if (Math.abs(off) <= BEAM_HOLD) return "hold";
  return off > 0 ? "right" : "left";
}

/**
 * The arrow's angle around the reticle (rad, 0 up, clockwise) toward `at`
 * in my body frame; straight behind (no side or up component to speak of)
 * points down.
 */
export function arrowAngle(me: V3, fwd: V3, up: V3, at: V3): number {
  const d = sub(at, me);
  const right = cross(fwd, up);
  const x = dot(d, right), y = dot(d, up);
  if (Math.hypot(x, y) < 0.15 * len(d) && dot(d, fwd) < 0) return Math.PI;
  return Math.atan2(x, y);
}
