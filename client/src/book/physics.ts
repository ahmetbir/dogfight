// Numbers the manual computes by flying the client's flight model (a
// line-by-line port of internal/sim/flight.go, pinned by shared vectors), so
// they follow the sim instead of being typed in.
import { DT, stepFlight, type FlightState, type Spec } from "../sim/flight.ts";
import { len, qAxisAngle, v3 } from "../sim/vec.ts";

/** Bank of the sustained-turn scenario, rad (≈83°). */
export const TURN_BANK_RAD = 1.45;
/** Length of that turn, s. */
export const TURN_S = 5;

/** m/s lost in a full-pull, full-throttle turn held for `seconds` from corner speed (ab: afterburner on). */
export function turnBleed(s: Spec, ab: boolean, seconds = TURN_S): number {
  let fs: FlightState = { pos: v3(0, 2000, 0), rot: qAxisAngle(v3(0, 0, 1), -TURN_BANK_RAD), vel: v3(0, 0, -s.cornerSpeed), th: 1 };
  for (let i = 0; i < Math.round(seconds / DT); i++) fs = stepFlight(fs, { p: 1, r: 0, y: 0, th: 1, ab }, s, { turbo: false });
  return s.cornerSpeed - len(fs.vel);
}

