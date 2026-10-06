// The drawn own plane between physics ticks.
import { DT, type FlightState } from "../sim/flight.ts";
import { add, qIdentity, qMul, qNorm, qSlerp, scale, type Q } from "../sim/vec.ts";

/**
 * fs carried acc seconds past its tick: position along the velocity,
 * attitude by that fraction of the last tick's rotation step spin. On the
 * wheels the velocity is horizontal and the sim sets the height once per
 * tick, so the drawn height also follows the ground (height h) over the
 * extra distance; otherwise a frame cadence beating against the tick
 * cadence (0, 2, 0, 2 ticks per frame) makes a slope a staircase.
 */
export function drawAhead(fs: FlightState, spin: Q, acc: number, h: (x: number, z: number) => number): FlightState {
  const pos = add(fs.pos, scale(fs.vel, acc));
  if (fs.ground && acc > 0) pos.y += h(pos.x, pos.z) - h(fs.pos.x, fs.pos.z);
  return { ...fs, pos, rot: qNorm(qMul(qSlerp(qIdentity(), spin, acc / DT), fs.rot)) };
}
