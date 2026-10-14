// Interpolation of remote planes: the core buffer over FlightState.
import { InterpBuffer as Core, ServerClock as CoreClock, extrapolate as coreExtrapolate } from "roomkit/predict/interp";
import type { FlightState } from "../sim/flight.ts";
import { add, len, lerp, qAxisAngle, qConj, qMul, qNorm, qRotate, qSlerp, scale, v3, type V3 } from "../sim/vec.ts";

export const INTERP_DELAY_MS = 100;
const TICK_MS = 1000 / 60;

const mix = (a: FlightState, b: FlightState, u: number): FlightState => ({
  pos: lerp(a.pos, b.pos, u),
  rot: qSlerp(a.rot, b.rot, u),
  vel: lerp(a.vel, b.vel, u),
  th: a.th + (b.th - a.th) * u,
});

export class InterpBuffer extends Core<FlightState> {
  constructor() {
    super(mix);
  }
}

/**
 * s carried sec seconds on: the attitude turns at its body rate w (body
 * frame). The velocity follows the nose, as in the sim (flight.ts slips the
 * path toward the nose), so it turns only with the nose's swing, w without
 * its roll part: a hard roll with angle of attack does not swerve the path.
 * The position follows the arc (midpoint velocity). Without w, or with a
 * non-finite one, it flies straight on.
 */
export function carry(s: FlightState, sec: number): FlightState {
  const straight = { ...s, pos: add(s.pos, scale(s.vel, sec)) };
  const w: V3 | undefined = s.w;
  const rate = w ? len(w) : 0;
  if (!w || !Number.isFinite(rate) || rate < 1e-9 || !(sec > 0)) return straight;
  const rot = qNorm(qMul(s.rot, qAxisAngle(w, rate * sec)));
  const swing = v3(w.x, w.y, 0); // pitch and yaw move the nose; roll turns about it
  const sr = len(swing);
  if (sr < 1e-9) return { ...straight, rot };
  const turn = (t: number) => qMul(qMul(s.rot, qAxisAngle(swing, sr * t)), qConj(s.rot)); // world frame
  return { ...s, rot, vel: qRotate(turn(sec), s.vel), pos: add(s.pos, scale(qRotate(turn(sec / 2), s.vel), sec)) };
}

export function extrapolate(buf: InterpBuffer, serverTimeMs: number): FlightState | null {
  return coreExtrapolate(buf, serverTimeMs, carry);
}

export class ServerClock extends CoreClock {
  constructor() {
    super(TICK_MS, INTERP_DELAY_MS);
  }
  /** Server time (ms) for a tick (static, as call sites use it). */
  static serverMs(tick: number): number {
    return tick * TICK_MS;
  }
}
