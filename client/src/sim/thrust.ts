// Port of thrustOf in internal/sim/flight.go; shared by the air and ground steps.
import type { Spec } from "./flight.ts";

/** Drag coefficient k (full throttle settles at maxSpeed) and engine thrust. */
export function thrustOf(s: Spec, th: number, ab: boolean, turbo: boolean): [number, number] {
  const k = s.accel / (s.maxSpeed * s.maxSpeed);
  let thrust = s.accel * th;
  if (ab) thrust = k * s.maxSpeedAB * s.maxSpeedAB;
  if (turbo) thrust *= 1.69; // equilibrium speed x1.3
  return [k, thrust];
}
