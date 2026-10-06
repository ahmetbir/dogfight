// Interpolation of remote planes: the core buffer over FlightState.
import { InterpBuffer as Core, ServerClock as CoreClock, extrapolate as coreExtrapolate } from "roomkit/predict/interp";
import type { FlightState } from "../sim/flight.ts";
import { add, lerp, qSlerp, scale } from "../sim/vec.ts";

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

const ahead = (s: FlightState, sec: number): FlightState => ({ ...s, pos: add(s.pos, scale(s.vel, sec)) });

export function extrapolate(buf: InterpBuffer, serverTimeMs: number): FlightState | null {
  return coreExtrapolate(buf, serverTimeMs, ahead);
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
