// Lock readouts: effective lock range, the range bar under the lock box,
// "MENZİL DIŞI" and the distance of a missile tracking me.
import type { MissileJSON } from "../net/protocol.ts";
import { dist, dot, len, norm, sub, v3, type V3 } from "../sim/vec.ts";

/** Half angle of the lock cone (internal/sim lock geometry). */
export const LOCK_HALF_ANGLE = (10 * Math.PI) / 180;
const FAR_MUL = 3; // an in-cone enemy beyond this many ranges is not worth a hint

/** True when p is within maxRad of the direction fwd from me (re-exported by reticle.ts). */
export function inCone(me: V3, fwd: V3, p: V3, maxRad: number): boolean {
  const d = sub(p, me);
  const l = len(d);
  return l > 1e-6 && dot(norm(d), fwd) >= Math.cos(maxRad);
}

/** The aircraft's lock range scaled by the weather. */
export function effectiveRange(lockRange: number, lockMul: number): number {
  return lockRange * lockMul;
}

/** dist / range clamped to 0..1 (1 when range is 0). */
export function rangeFill(dist: number, range: number): number {
  if (range <= 0) return 1;
  return Math.max(0, Math.min(1, dist / range));
}

/** The nearest enemy inside the lock cone is beyond range (but within 3× range). */
export function outOfRange(me: V3, fwd: V3, enemies: V3[], range: number): boolean {
  let best = Infinity;
  for (const p of enemies) {
    if (!inCone(me, fwd, p, LOCK_HALF_ANGLE)) continue;
    best = Math.min(best, dist(me, p));
  }
  return best > range && best <= FAR_MUL * range;
}

/** Distance to the nearest missile tracking plane `you`; null when none. */
export function incomingDistance(me: V3, missiles: MissileJSON[], you: number): number | null {
  let best: number | null = null;
  for (const m of missiles) {
    if (m.tg !== you) continue;
    const d = dist(me, v3(m.p[0], m.p[1], m.p[2]));
    if (best === null || d < best) best = d;
  }
  return best;
}
