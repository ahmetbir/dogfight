// Client-side prediction of the local plane: the core reconciler with the
// flight model and a position + attitude smoother.
import { Reconciler, type Smoother } from "roomkit/predict/reconcile";
import { stepFlight, type FlightMods, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import type { GroundSample } from "../sim/ground.ts";
import { add, len, qConj, qIdentity, qMul, qNorm, qSlerp, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";

// A correction is drawn over a time that grows with its size: a small one
// settles fast, a large one (after a stall) glides instead of jumping.
const SMOOTH_MIN_S = 0.15; // time constant for corrections up to SMALL_M
const SMOOTH_MAX_S = 0.6;  // time constant for corrections from LARGE_M up
const SMALL_M = 1;
const LARGE_M = 40;
const POS_RATE = 150;                   // m/s: a position correction never moves the drawn plane faster than this
const ROT_SMOOTH_S = 0.15;              // attitude correction time constant...
const ROT_RATE = (120 * Math.PI) / 180; // ...but never faster than this (rad/s): the nose does not whip
const TELEPORT_M = 300; // a position correction this large snaps (2 s of glide; respawn and kind change reset anyway)

/** Time constant (s) of a position correction of m metres. */
export function smoothTime(m: number): number {
  const f = Math.min(Math.max((m - SMALL_M) / (LARGE_M - SMALL_M), 0), 1);
  return SMOOTH_MIN_S + f * (SMOOTH_MAX_S - SMOOTH_MIN_S);
}

/** What the world adds to a flight step: turbo, the ground under a point, the wind at a world tick. */
export type FlightEnv = { turbo: boolean; ground(x: number, z: number): GroundSample; wind(tick: number): V3 };

/** p's flight modifiers for the step that ends at tick (sampled at the start, like sim.World.mods). */
function mods(env: FlightEnv, fs: FlightState, tick: number): FlightMods {
  return { turbo: env.turbo, wind: env.wind(tick), ground: env.ground(fs.pos.x, fs.pos.z) };
}

/**
 * Render pos − physics pos and drawn rot = rotOffset * physics rot, fading
 * with a size-scaled time constant (position) and a rate-limited one (attitude).
 */
export class FlightSmoother implements Smoother<FlightState> {
  private offset: V3 = v3(0, 0, 0);
  private rotOffset: Q = qIdentity();

  rebase(prev: FlightState, corrected: FlightState): void {
    this.offset = add(this.offset, sub(prev.pos, corrected.pos));
    // Keep drawing the old attitude: drawn = rotOffset' * corrected.rot.
    this.rotOffset = qNorm(qMul(qMul(this.rotOffset, prev.rot), qConj(corrected.rot)));
    if (len(this.offset) > TELEPORT_M) this.offset = v3(0, 0, 0); // snap the position; the attitude still turns at ROT_RATE
  }

  draw(s: FlightState, dtS: number): FlightState {
    const m = len(this.offset);
    if (m > 0) {
      const left = Math.max(m * Math.exp(-dtS / smoothTime(m)), m - POS_RATE * dtS);
      this.offset = scale(this.offset, left / m);
    }
    const a = qAngle(this.rotOffset);
    if (a > 1e-9) {
      const left = Math.max(a * Math.exp(-dtS / ROT_SMOOTH_S), a - ROT_RATE * dtS);
      this.rotOffset = qSlerp(qIdentity(), this.rotOffset, left / a);
    }
    return { ...s, pos: add(s.pos, this.offset), rot: qNorm(qMul(this.rotOffset, s.rot)) };
  }

  reset(): void {
    this.offset = v3(0, 0, 0);
    this.rotOffset = qIdentity();
  }
}

/** Rotation angle of a unit quaternion (radians, shortest arc). */
function qAngle(q: Q): number {
  return 2 * Math.acos(Math.min(1, Math.abs(q.w)));
}

export class Predictor {
  private spec: Spec;
  private readonly r: Reconciler<FlightState, StickInput, FlightEnv>;

  constructor(spec: Spec) {
    this.spec = spec;
    const model = { step: (s: FlightState, i: StickInput, env: FlightEnv, tick: number) => stepFlight(s, i, this.spec, mods(env, s, tick)) };
    this.r = new Reconciler(model, new FlightSmoother(), { pos: v3(0, 0, 0), rot: qIdentity(), vel: v3(0, 0, 0), th: 0 });
  }

  /** Aircraft changed (respawn). */
  setSpec(spec: Spec): void { this.spec = spec; }
  /** World tick the step of input seq ends on, by the latest snapshot (the wind's clock). */
  tickFor(seq: number): number { return this.r.tickFor(seq); }
  /** Records a sent input and advances the predicted state by one tick (the step to world tick `tick`). */
  push(seq: number, inp: StickInput, tick: number, env: FlightEnv): void { this.r.push(seq, inp, tick, env); }
  /** Rebases prediction on the server state of world tick snapTick, on which the server applied seq ack. */
  reconcile(server: FlightState, ack: number, snapTick: number, env: FlightEnv): void { this.r.reconcile(server, ack, snapTick, env); }
  /** World ticks the predicted state runs ahead of the latest snapshot's. */
  ahead(): number { return this.r.ahead(); }
  /** Unacknowledged inputs kept for replay. */
  pendingCount(): number { return this.r.pendingCount(); }
  /** Predicted physics state. */
  state(): FlightState { return this.r.state(); }
  /** Physics state plus the decaying visual correction; dtS = frame time. */
  render(dtS: number): FlightState { return this.r.render(dtS); }
  /** Hard reset on spawn / death; snapTick and ack are the spawn snapshot's (baseline of the shift). */
  reset(fs: FlightState, snapTick?: number, ack?: number): void { this.r.reset(fs, snapTick, ack); }
}
