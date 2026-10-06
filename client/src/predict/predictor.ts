// Client-side prediction of the local plane: the core reconciler with the
// flight model and a position + attitude smoother.
import { Reconciler, type Smoother } from "../core/predict/reconcile.ts";
import { stepFlight, type FlightMods, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import type { GroundSample } from "../sim/ground.ts";
import { add, len, qConj, qIdentity, qMul, qNorm, qSlerp, scale, sub, v3, type Q, type V3 } from "../sim/vec.ts";

const SMOOTH_S = 0.1;  // visual correction time constant
const TELEPORT_M = 50; // larger corrections snap instead of smoothing

/** What the world adds to a flight step: turbo, the ground under a point, the wind at a world tick. */
export type FlightEnv = { turbo: boolean; ground(x: number, z: number): GroundSample; wind(tick: number): V3 };

/** p's flight modifiers for the step that ends at tick (sampled at the start, like sim.World.mods). */
function mods(env: FlightEnv, fs: FlightState, tick: number): FlightMods {
  return { turbo: env.turbo, wind: env.wind(tick), ground: env.ground(fs.pos.x, fs.pos.z) };
}

/** Render pos − physics pos and drawn rot = rotOffset * physics rot, fading with SMOOTH_S. */
class FlightSmoother implements Smoother<FlightState> {
  private offset: V3 = v3(0, 0, 0);
  private rotOffset: Q = qIdentity();

  rebase(prev: FlightState, corrected: FlightState): void {
    this.offset = add(this.offset, sub(prev.pos, corrected.pos));
    // Keep drawing the old attitude: drawn = rotOffset' * corrected.rot.
    this.rotOffset = qNorm(qMul(qMul(this.rotOffset, prev.rot), qConj(corrected.rot)));
    if (len(this.offset) > TELEPORT_M) this.reset();
  }

  draw(s: FlightState, dtS: number): FlightState {
    const k = Math.exp(-dtS / SMOOTH_S);
    this.offset = scale(this.offset, k);
    this.rotOffset = qSlerp(qIdentity(), this.rotOffset, k);
    return { ...s, pos: add(s.pos, this.offset), rot: qNorm(qMul(this.rotOffset, s.rot)) };
  }

  reset(): void {
    this.offset = v3(0, 0, 0);
    this.rotOffset = qIdentity();
  }
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
