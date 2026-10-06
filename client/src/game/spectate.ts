// Which view the main camera takes: my own chase camera, the killcam on my
// killer, an orbit around where I fell, or a spectated live plane.
import type { V3 } from "../sim/vec.ts";

export type CamMode = { kind: "own" } | { kind: "follow"; id: number } | { kind: "orbit"; at: V3 } | { kind: "overview" };

/** The next (step 1) or previous (step -1) id after current in sorted ids, wrapping; the first/last when current is not there. */
export function nextTarget(alive: number[], current: number | null, step: 1 | -1): number | null {
  if (alive.length === 0) return null;
  const i = current === null ? -1 : alive.indexOf(current);
  if (i < 0) return step === 1 ? alive[0] : alive[alive.length - 1];
  return alive[(i + step + alive.length) % alive.length];
}

/**
 * alive/dead: my plane is alive / exists but is down (neither: joined, no
 * plane yet). killer: who downed me (0: nobody); deathAt: where I fell;
 * spectate: the plane picked to watch; aliveIds: other live planes, sorted.
 */
export function camMode(s: {
  alive: boolean; dead: boolean; killer: number; deathAt: V3 | null; spectate: number | null; aliveIds: number[];
}): CamMode {
  if (s.alive) return { kind: "own" };
  if (s.dead) {
    if (s.killer && s.aliveIds.includes(s.killer)) return { kind: "follow", id: s.killer };
    return s.deathAt ? { kind: "orbit", at: s.deathAt } : { kind: "own" };
  }
  const id = s.spectate !== null && s.aliveIds.includes(s.spectate) ? s.spectate : s.aliveIds[0];
  return id === undefined ? { kind: "overview" } : { kind: "follow", id };
}

/** Ids of the live planes other than mine, sorted. */
export function othersAlive(planes: Iterable<{ id: number; a: boolean }>, you: number): number[] {
  const out: number[] = [];
  for (const p of planes) if (p.a && p.id !== you) out.push(p.id);
  return out.sort((a, b) => a - b);
}

export function watchingLabel(name: string): string {
  return `İzliyorsun: ${name}`;
}
