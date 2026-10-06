// Interpolation of remote planes in server time.
import type { FlightState } from "../sim/flight.ts";
import { add, lerp, qSlerp, scale } from "../sim/vec.ts";

export const INTERP_DELAY_MS = 100;
const TICK_MS = 1000 / 60;
const RELAX_EVERY_MS = 5000;
const RELAX_MS = 5;
const MAX_ENTRIES = 32;

type Entry = { t: number; fs: FlightState };

export class InterpBuffer {
  private entries: Entry[] = [];

  /** Adds a snapshot state; out-of-order or duplicate times are ignored. */
  push(serverTimeMs: number, fs: FlightState): void {
    const last = this.entries.at(-1);
    if (last && serverTimeMs <= last.t) return;
    this.entries.push({ t: serverTimeMs, fs });
    if (this.entries.length > MAX_ENTRIES) this.entries.shift();
  }

  /** The latest entry (server time ms and state). */
  newest(): Entry | undefined {
    return this.entries.at(-1);
  }

  size(): number {
    return this.entries.length;
  }

  /** Lerps pos/vel/th and slerps rot at renderTimeMs; clamps at the ends. */
  sample(renderTimeMs: number): FlightState | null {
    const e = this.entries;
    if (e.length === 0) return null;
    if (renderTimeMs <= e[0].t) return e[0].fs;
    const last = e[e.length - 1];
    if (renderTimeMs >= last.t) return last.fs;
    let i = 1;
    while (e[i].t < renderTimeMs) i++;
    const a = e[i - 1], b = e[i];
    const u = (renderTimeMs - a.t) / (b.t - a.t);
    return {
      pos: lerp(a.fs.pos, b.fs.pos, u),
      rot: qSlerp(a.fs.rot, b.fs.rot, u),
      vel: lerp(a.fs.vel, b.fs.vel, u),
      th: a.fs.th + (b.fs.th - a.fs.th) * u,
    };
  }
}

const MAX_AHEAD_MS = 500; // extrapolation horizon past the newest snapshot

/**
 * The state at serverTimeMs: interpolated inside the buffer, carried along
 * the newest velocity past its end (at most MAX_AHEAD_MS), e.g. a target's
 * present position for the gunsight while the drawn plane lags behind.
 */
export function extrapolate(buf: InterpBuffer, serverTimeMs: number): FlightState | null {
  const last = buf.newest();
  if (!last || serverTimeMs <= last.t) return buf.sample(serverTimeMs);
  const s = Math.min(serverTimeMs - last.t, MAX_AHEAD_MS) / 1000;
  return { ...last.fs, pos: add(last.fs.pos, scale(last.fs.vel, s)) };
}

/**
 * ServerClock maps local time to server time. The offset tracks the lowest
 * observed delay (now − serverMs) and relaxes by 5 ms every 5 s so it can
 * follow a slowly rising delay.
 */
export class ServerClock {
  private offset = NaN;
  private relaxedAt = 0;

  /** Records a snapshot of tick received at local time nowMs. */
  observe(tick: number, nowMs: number): void {
    const d = nowMs - tick * TICK_MS;
    if (Number.isNaN(this.offset)) {
      this.offset = d;
      this.relaxedAt = nowMs;
      return;
    }
    while (nowMs - this.relaxedAt >= RELAX_EVERY_MS) {
      this.offset += RELAX_MS;
      this.relaxedAt += RELAX_EVERY_MS;
    }
    this.offset = Math.min(this.offset, d);
  }

  /** Server time (ms) for a tick. */
  static serverMs(tick: number): number {
    return tick * TICK_MS;
  }

  /** Server time to render remote planes at. */
  renderTime(nowMs: number): number {
    return nowMs - this.offset - INTERP_DELAY_MS;
  }
}
