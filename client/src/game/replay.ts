// Replay of the last seconds: a ring buffer of snapshot frames and a player
// that interpolates between them. Client only; the server is not involved.
import type { Controls } from "../render/glb.ts";
import { lerp, qSlerp, type Q, type V3 } from "../sim/vec.ts";

export const REPLAY_MS = 10000;

/** gr/ab (gear down, afterburner), msl (missiles on the rails), ctl (control surfaces) and skin (its paint then) are optional extras for drawing. */
export type RPlane = { id: number; k: string; tm: string; a: boolean; pos: V3; rot: Q; gr?: boolean; ab?: boolean; msl?: number; ctl?: Controls; skin?: string };
export type RMissile = { id: number; pos: V3; vel?: V3 };
export type RFrame = { t: number; planes: RPlane[]; missiles: RMissile[] }; // t = server ms

export class ReplayBuffer {
  private readonly spanMs: number;
  private buf: RFrame[] = [];

  constructor(spanMs = REPLAY_MS) {
    this.spanMs = spanMs;
  }

  /** Appends f (out-of-order or repeated times are ignored) and drops frames older than spanMs before it. */
  push(f: RFrame): void {
    const last = this.buf.at(-1);
    if (last && f.t <= last.t) return;
    this.buf.push(f);
    let drop = 0;
    while (drop < this.buf.length && this.buf[drop].t < f.t - this.spanMs) drop++;
    if (drop > 0) this.buf.splice(0, drop);
  }

  /** A copy of the frames, oldest first. */
  frames(): RFrame[] {
    return this.buf.slice();
  }

  clear(): void {
    this.buf = [];
  }
}

export class ReplayPlayer {
  private readonly f: RFrame[];

  constructor(frames: RFrame[]) {
    this.f = frames;
  }

  /** Recorded length in ms. */
  duration(): number {
    return this.f.length > 1 ? this.f[this.f.length - 1].t - this.f[0].t : 0;
  }

  done(elapsedMs: number): boolean {
    return elapsedMs >= this.duration();
  }

  /**
   * The scene elapsedMs into the recording: positions lerped and rotations
   * slerped between the two frames around it. A plane shows only where the
   * earlier frame has it, held still when the next frame lacks it or its
   * life changed (no streak from a wreck to a spawn).
   */
  sample(elapsedMs: number): RFrame | null {
    const f = this.f;
    if (f.length === 0) return null;
    const t = f[0].t + Math.max(0, elapsedMs);
    if (t >= f[f.length - 1].t) return f[f.length - 1];
    let lo = 0, hi = f.length - 1; // f[lo].t <= t < f[hi].t
    while (hi - lo > 1) {
      const mid = (lo + hi) >> 1;
      if (f[mid].t <= t) lo = mid;
      else hi = mid;
    }
    const a = f[lo], b = f[hi];
    const u = (t - a.t) / (b.t - a.t);
    const next = new Map(b.planes.map((p) => [p.id, p]));
    const nextM = new Map(b.missiles.map((m) => [m.id, m]));
    return {
      t,
      planes: a.planes.map((p) => {
        const q = next.get(p.id);
        return q && q.a === p.a ? { ...p, pos: lerp(p.pos, q.pos, u), rot: qSlerp(p.rot, q.rot, u) } : p;
      }),
      missiles: a.missiles.map((m) => {
        const n = nextM.get(m.id);
        return n ? { ...m, pos: lerp(m.pos, n.pos, u), vel: m.vel && n.vel ? lerp(m.vel, n.vel, u) : m.vel } : m;
      }),
    };
  }
}
