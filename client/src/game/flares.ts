// Burning flares from the server snapshot: positions with a velocity
// estimated between snapshots, extrapolated per frame like missiles.
import type { FlareJSON, PlaneJSON } from "../net/protocol.ts";
import { add, dist, scale, sub, v3, type V3 } from "../sim/vec.ts";

export type FlareView = { id: number; p: V3; v: V3 };

const SEED_M = 40;         // a new flare starts with the velocity of the plane it left (within this)
const MAX_AHEAD_S = 0.25;  // never extrapolate further than this past the snapshot

/** dtS: seconds of world time since the previous snapshot. */
export function flareViews(prev: readonly FlareView[], wire: readonly FlareJSON[], dtS: number, planes: Iterable<PlaneJSON>): FlareView[] {
  if (wire.length === 0) return [];
  const old = new Map(prev.map((f) => [f.id, f]));
  const live = [...planes].filter((p) => p.a);
  return wire.map((w) => {
    const p = v3(w.p[0], w.p[1], w.p[2]);
    const o = old.get(w.id);
    if (o) return { id: w.id, p, v: dtS > 0 ? scale(sub(p, o.p), 1 / dtS) : o.v };
    let v = v3(0, 0, 0);
    let best = SEED_M;
    for (const pl of live) {
      const d = dist(p, v3(pl.p[0], pl.p[1], pl.p[2]));
      if (d < best) [best, v] = [d, v3(pl.v[0], pl.v[1], pl.v[2])];
    }
    return { id: w.id, p, v };
  });
}

/** Where each flare is sinceS after its snapshot. */
export function flaresAt(fs: readonly FlareView[], sinceS: number): { id: number; pos: V3 }[] {
  const t = Math.max(0, Math.min(MAX_AHEAD_S, sinceS));
  return fs.map((f) => ({ id: f.id, pos: add(f.p, scale(f.v, t)) }));
}
