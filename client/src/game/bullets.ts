// Client-side cannon tracers. Own rounds draw at once; other planes' rounds
// (from "fire" events) are held until the interpolated render time reaches
// their tick, so they leave the guns of the plane as it is drawn.
import { add, scale, type V3 } from "../sim/vec.ts";

export const BULLET_LIFE_S = 1.2; // sim.BulletLife (72 ticks)
export const AA_LIFE_S = 4;       // sim.AAShellLife (240 ticks)
const AA_COLOR = "#ff9a3c";
const TICK_S = 1 / 60;
const MAX_QUEUED = 512;

export type TracerSink = { tracer(from: V3, vel: V3, lifeS: number, mine: boolean, color?: string): void };

type Round = { pos: V3; vel: V3; tick: number; mine: boolean; aa: boolean };

export class Bullets {
  private queue: Round[] = [];
  private readonly renderTick: () => number;

  /** renderTick: the (fractional) server tick remote planes are drawn at. */
  constructor(renderTick: () => number) {
    this.renderTick = renderTick;
  }

  /** aa: an anti-aircraft shell (orange, longer life). */
  spawn(pos: V3, vel: V3, tick: number, mine: boolean, aa = false): void {
    if (this.queue.length >= MAX_QUEUED) this.queue.shift();
    this.queue.push({ pos, vel, tick, mine, aa });
  }

  update(_dtS: number, fx: TracerSink): void {
    const rt = this.renderTick();
    const keep: Round[] = [];
    for (const r of this.queue) {
      if (r.mine) {
        fx.tracer(r.pos, r.vel, BULLET_LIFE_S, true);
        continue;
      }
      if (r.tick > rt) {
        keep.push(r);
        continue;
      }
      const age = (rt - r.tick) * TICK_S;
      const life = r.aa ? AA_LIFE_S : BULLET_LIFE_S;
      if (age < life) fx.tracer(add(r.pos, scale(r.vel, age)), r.vel, life - age, false, r.aa ? AA_COLOR : undefined);
    }
    this.queue = keep;
  }

  queued(): number {
    return this.queue.length;
  }

  reset(): void {
    this.queue = [];
  }
}
