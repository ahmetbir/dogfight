// Client-side prediction of the local plane with server reconciliation.
import { stepFlight, type FlightMods, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import type { GroundSample } from "../sim/ground.ts";
import { add, len, qConj, qIdentity, qMul, qNorm, qSlerp, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";

const SMOOTH_S = 0.1;  // visual correction time constant
const TELEPORT_M = 50; // larger corrections snap instead of smoothing
const MAX_PENDING = 120; // 2 s of inputs; older ones are dropped if acks stall
const MAX_LAG = 8;       // server steps behind the acked inputs absorbed as timing noise
const BASE_WINDOW = 30;  // snapshots (~1 s) whose median offset is the baseline

type Pending = { seq: number; inp: StickInput };

/** What the world adds to a flight step: turbo, the ground under a point, the wind at a world tick. */
export type FlightEnv = { turbo: boolean; ground(x: number, z: number): GroundSample; wind(tick: number): V3 };

/** p's flight modifiers for the step that ends at tick (sampled at the start, like sim.World.mods). */
function mods(env: FlightEnv, fs: FlightState, tick: number): FlightMods {
  return { turbo: env.turbo, wind: env.wind(tick), ground: env.ground(fs.pos.x, fs.pos.z) };
}

export class Predictor {
  private spec: Spec;
  private pending: Pending[] = [];
  private phys: FlightState = { pos: v3(0, 0, 0), rot: qIdentity(), vel: v3(0, 0, 0), th: 0 };
  private offset: V3 = v3(0, 0, 0);  // render pos − physics pos
  private rotOffset: Q = qIdentity(); // drawn rot = rotOffset * physics rot
  // Server step count vs acked inputs. The server repeats the last input
  // when its queue starves (one step more) and drops a backlog (steps
  // fewer), so d = snapTick − ack wanders by a tick or two under jitter.
  // base follows the median of d over the last ~1 s (it stays while inside
  // the middle half of those values); shift = d − base is that
  // short noise only. The server state is then the client's own history
  // `shift` steps later in time, not a different place: replay skips (or
  // repeats) that many steps. A lasting change of d (latency step, tab
  // hidden) moves the median once it leaves the middle half (~0.75 s for a
  // clean step) and is corrected once.
  private base = NaN;
  private recent: number[] = []; // last BASE_WINDOW values of d
  private shift = 0;
  private snapTick = 0;
  private ack = 0;
  private lastAcked: StickInput | null = null;
  private lastSeq = 0;

  constructor(spec: Spec) {
    this.spec = spec;
  }

  /** Aircraft changed (respawn). */
  setSpec(spec: Spec): void {
    this.spec = spec;
  }

  /** World tick the step of input seq ends on, by the latest snapshot (the wind's clock). */
  tickFor(seq: number): number {
    return this.snapTick + seq - this.ack - this.shift;
  }

  /** Records a sent input and advances the predicted state by one tick (the step to world tick `tick`). */
  push(seq: number, inp: StickInput, tick: number, env: FlightEnv): void {
    this.pending.push({ seq, inp });
    this.lastSeq = seq;
    if (this.pending.length > MAX_PENDING) this.pending.shift();
    this.phys = stepFlight(this.phys, inp, this.spec, mods(env, this.phys, tick));
  }

  /**
   * Rebases prediction on the server state of world tick snapTick, on which
   * the server applied seq ack: replays the inputs after ack, seq n as the
   * step to tickFor(n) (by seq, so inputs dropped past the cap do not shift
   * the wind ticks). Steps the server took beyond its acked inputs (shift)
   * are skipped from the replay, steps it dropped are replayed with the last
   * acked input, so queue timing noise does not move the drawn plane.
   */
  reconcile(server: FlightState, ack: number, snapTick: number, env: FlightEnv): void {
    for (const p of this.pending) if (p.seq <= ack) this.lastAcked = p.inp;
    this.pending = this.pending.filter((p) => p.seq > ack);
    const d = snapTick - ack;
    this.recent.push(d);
    if (this.recent.length > BASE_WINDOW) this.recent.shift();
    const q = quartiles(this.recent);
    // Follow lasting changes only: inside the middle half of recent d the base stays.
    if (Number.isNaN(this.base) || this.base < q[0] || this.base > q[2]) this.base = q[1];
    let shift = d - this.base;
    // Beyond what the replay can absorb the change is real: re-anchor on it
    // and take the whole correction now.
    if (shift > this.pending.length || shift < -MAX_LAG) {
      this.recent = [d];
      this.base = d;
      shift = 0;
    }
    this.snapTick = snapTick;
    this.ack = ack;
    this.shift = shift;
    let corrected = server;
    // Steps the server dropped: replayed with the last acked input (the first
    // pending one right after a spawn, before anything was acked).
    const repeat = this.lastAcked ?? this.pending[0]?.inp ?? null;
    for (let j = 1; j <= -shift && repeat; j++) {
      corrected = stepFlight(corrected, repeat, this.spec, mods(env, corrected, snapTick + j));
    }
    for (const p of this.pending) {
      if (p.seq <= ack + shift) continue;
      corrected = stepFlight(corrected, p.inp, this.spec, mods(env, corrected, this.tickFor(p.seq)));
    }
    this.offset = add(this.offset, sub(this.phys.pos, corrected.pos));
    // Keep drawing the old attitude: drawn = rotOffset' * corrected.rot.
    this.rotOffset = qNorm(qMul(qMul(this.rotOffset, this.phys.rot), qConj(corrected.rot)));
    if (len(this.offset) > TELEPORT_M) {
      this.offset = v3(0, 0, 0);
      this.rotOffset = qIdentity();
    }
    this.phys = corrected;
  }

  /** World ticks the predicted state runs ahead of the latest snapshot's. */
  ahead(): number {
    return Math.max(0, this.lastSeq - this.ack - this.shift);
  }

  /** Unacknowledged inputs kept for replay. */
  pendingCount(): number {
    return this.pending.length;
  }

  /** Predicted physics state. */
  state(): FlightState {
    return this.phys;
  }

  /** Physics state plus the decaying visual correction; dtS = frame time. */
  render(dtS: number): FlightState {
    const k = Math.exp(-dtS / SMOOTH_S);
    this.offset = scale(this.offset, k);
    this.rotOffset = qSlerp(qIdentity(), this.rotOffset, k);
    return { ...this.phys, pos: add(this.phys.pos, this.offset), rot: qNorm(qMul(this.rotOffset, this.phys.rot)) };
  }

  /** Hard reset on spawn / death; snapTick and ack are the spawn snapshot's (baseline of the shift). */
  reset(fs: FlightState, snapTick?: number, ack?: number): void {
    this.pending = [];
    this.recent = snapTick !== undefined && ack !== undefined ? [snapTick - ack] : [];
    this.base = this.recent.length ? this.recent[0] : NaN;
    this.shift = 0;
    this.snapTick = snapTick ?? 0;
    this.ack = ack ?? 0;
    this.lastAcked = null;
    this.lastSeq = this.ack;
    this.phys = fs;
    this.offset = v3(0, 0, 0);
    this.rotOffset = qIdentity();
  }
}

/** Lower quartile, lower median and upper quartile of a non-empty list. */
function quartiles(xs: number[]): [number, number, number] {
  const s = [...xs].sort((a, b) => a - b);
  const at = (f: number) => s[Math.floor((s.length - 1) * f)];
  return [at(0.25), at(0.5), s[Math.ceil((s.length - 1) * 0.75)]];
}
