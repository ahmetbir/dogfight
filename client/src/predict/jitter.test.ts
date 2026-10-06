// Ground jitter (feedback #1 item 10): bursty input delivery makes the
// server's input queue starve (it repeats the last input: one extra step) and
// overflow (it drops the backlog: steps missing). Reconcile must not turn
// that timing noise into ±(speed × Dt) position corrections every snapshot.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Predictor, type FlightEnv } from "./predictor.ts";
import { stepFlight, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import { dist, v3 } from "../sim/vec.ts";
import { yawPitch } from "../sim/ground.ts";
import { SessionModel } from "./sessionmodel.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const RUNWAY: FlightEnv = { turbo: false, ground: () => ({ h: 0, surf: 1 }), wind: () => v3(0, 0, 0) };
type Run = { maxOffset: number; maxStepErr: number };

/**
 * Taxi at a steady speed for 600 ticks. Inputs reach the server in bursts of
 * `burst` (head-of-line blocking), snapshots every 2 ticks reach the client
 * 3 ticks later. Returns the largest visual correction (drawn − physics) and
 * the largest deviation of a drawn frame step from speed × Dt.
 */
function taxi(burst: number, inp: StickInput): Run {
  const s0: FlightState = { pos: v3(0, 2.5, 0), rot: yawPitch(0, 0), vel: v3(0, 0, -25), th: inp.th, gear: true, ground: true };
  const pr = new Predictor(F16);
  pr.reset(s0);
  const q = new SessionModel<StickInput>();
  let server = s0;
  const inFlight: { at: number; seq: number }[] = [];
  const snaps: { at: number; fs: FlightState; ack: number; tick: number }[] = [];
  let maxOffset = 0, maxStepErr = 0;
  let prev = s0.pos;
  for (let t = 1; t <= 600; t++) {
    pr.push(t, inp, pr.tickFor(t), RUNWAY); // client: one input per tick
    inFlight.push({ at: Math.ceil(t / burst) * burst + 2, seq: t });
    while (inFlight.length && inFlight[0].at <= t) q.push(inFlight.shift()!.seq, inp);
    const si = q.next().inp; // server tick t
    if (si) server = stepFlight(server, si, F16, { turbo: false, ground: { h: 0, surf: 1 } });
    if (t % 2 === 0) snaps.push({ at: t + 3, fs: server, ack: q.ack, tick: t });
    while (snaps.length && snaps[0].at <= t) {
      const s = snaps.shift()!;
      pr.reconcile(s.fs, s.ack, s.tick, RUNWAY);
    }
    const drawn = pr.render(1 / 60);
    if (t > 120) {
      maxOffset = Math.max(maxOffset, dist(drawn.pos, pr.state().pos));
      maxStepErr = Math.max(maxStepErr, Math.abs(dist(drawn.pos, prev) - Math.hypot(drawn.vel.x, drawn.vel.z) / 60));
    }
    prev = drawn.pos;
  }
  return { maxOffset, maxStepErr };
}

const steady: StickInput = { p: 0, r: 0, y: 0, th: 0.62, ab: false, g: true };

test("bursty input delivery does not shake a taxiing plane", () => {
  for (const burst of [3, 6, 8]) {
    const r = taxi(burst, steady);
    assert.ok(r.maxOffset < 0.02, `burst ${burst}: drawn ${r.maxOffset.toFixed(3)} m off the prediction`);
    assert.ok(r.maxStepErr < 0.02, `burst ${burst}: frame step off by ${r.maxStepErr.toFixed(3)} m`);
  }
});

test("braking under bursty delivery stays smooth", () => {
  const r = taxi(6, { ...steady, th: 0, br: true });
  assert.ok(r.maxOffset < 0.02, `drawn ${r.maxOffset.toFixed(3)} m off the prediction`);
});

test("even delivery keeps reconcile exact (no shift)", () => {
  const r = taxi(1, steady);
  assert.ok(r.maxOffset < 1e-9, `offset ${r.maxOffset}`);
});
