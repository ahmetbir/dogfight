import { test } from "node:test";
import assert from "node:assert/strict";
import { drawAhead } from "./ahead.ts";
import { DT, stepFlight, type FlightState, type Spec } from "../sim/flight.ts";
import { qIdentity, v3 } from "../sim/vec.ts";
import { yawPitch } from "../sim/ground.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const slope = (_x: number, z: number) => 100 - 0.2 * z; // rises toward −Z (11°)

test("rolling up a slope, the drawn height follows the ground between ticks", () => {
  let fs: FlightState = { pos: v3(0, slope(0, 0) + 2.5, 0), rot: yawPitch(0, 0), vel: v3(0, 0, -30), th: 0.6, gear: true, ground: true };
  const step = () => { fs = stepFlight(fs, { p: 0, r: 0, y: 0, th: 0.6, ab: false, g: true }, F16, { turbo: false, ground: { h: slope(fs.pos.x, fs.pos.z), surf: 1 /* paved: no grass bumps (FB-A 5) */ } }); };
  // 60 Hz display beating against 60 Hz ticks: frames alternately run 0 and 2 ticks.
  let acc = 0;
  let prev: FlightState | null = null;
  let worst = 0;
  for (let f = 0; f < 60; f++) {
    acc += DT;
    const n = f % 2 === 0 ? 0 : 2;
    for (let i = 0; i < n; i++) { step(); acc -= DT; }
    const d = drawAhead(fs, qIdentity(), acc, (x, z) => slope(x, z));
    // After the first tick (the sim height lags one tick of travel from then on)
    // the height change of every frame matches the ground under its distance.
    if (prev && f > 2) worst = Math.max(worst, Math.abs((d.pos.y - prev.pos.y) - (slope(d.pos.x, d.pos.z) - slope(prev.pos.x, prev.pos.z))));
    prev = d;
  }
  assert.ok(worst < 0.01, `frame height step off the slope by ${worst.toFixed(3)} m`);
});

test("in the air the draw extrapolates along the velocity", () => {
  const fs: FlightState = { pos: v3(0, 500, 0), rot: qIdentity(), vel: v3(0, 10, -200), th: 1 };
  const d = drawAhead(fs, qIdentity(), DT / 2, () => 0);
  assert.deepEqual(d.pos, { x: 0, y: 500 + 10 * DT / 2, z: -200 * DT / 2 });
});
