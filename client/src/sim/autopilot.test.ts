import { test } from "node:test";
import assert from "node:assert/strict";
import { steer } from "./autopilot.ts";
import { stepFlight, type FlightState, type Spec } from "./flight.ts";
import { dot, norm, qForward, qIdentity, v3 } from "./vec.ts";

// F-16 (internal/sim/aircraft.go).
const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };

test("steer turns toward target (mirrors bot.TestSteerTurnsTowardTarget)", () => {
  const cases = [v3(1, 0, -1), v3(-1, 0.3, -1), v3(0, 1, 0), v3(0, -1, -0.2), v3(0, 0, 1)];
  for (const dir of cases) {
    let fs: FlightState = { pos: v3(0, 2000, 0), rot: qIdentity(), vel: v3(0, 0, -F16.cornerSpeed), th: 1 };
    const start = dot(qForward(fs.rot), norm(dir));
    for (let i = 0; i < 60 * 4; i++) {
      const { p, r, y } = steer(fs.rot, fs.w, dir);
      fs = stepFlight(fs, { p, r, y, th: 1, ab: false }, F16, { turbo: false });
    }
    const end = dot(qForward(fs.rot), norm(dir));
    assert.ok(end >= 0.97 && end >= start, `dir ${JSON.stringify(dir)}: alignment ${start} -> ${end}`);
  }
});
