// Prediction must stay on the server's trajectory: the client's predicted
// state for input k must match the server's state right after it applies k.
// Short queue noise may cost at most one tick; lasting timing changes
// (latency step, tab hidden and back) must be corrected within 1.5 s.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Predictor, type FlightEnv } from "./predictor.ts";
import { SessionModel } from "./sessionmodel.ts";
import { stepFlight, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import { dist, v3, type V3 } from "../sim/vec.ts";
import { yawPitch } from "../sim/ground.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const RUNWAY: FlightEnv = { turbo: false, ground: () => ({ h: 0, surf: 1 }), wind: () => v3(0, 0, 0) };
const INP: StickInput = { p: 0, r: 0, y: 0, th: 0.62, ab: false, g: true };
const DOWNLINK = 3; // ticks
const SPEED = 25;   // m/s, about steady at this throttle
const TICK_M = SPEED / 60;

type Opts = { ticks: number; uplink(t: number): number; stalled?(t: number): boolean };

/** Per sent seq: the tick it was sent and |predicted − server| after the server applied it. */
function run(o: Opts): { sentAt: number[]; err: number[] } {
  const s0: FlightState = { pos: v3(0, 2.5, 0), rot: yawPitch(0, 0), vel: v3(0, 0, -SPEED), th: INP.th, gear: true, ground: true };
  const pr = new Predictor(F16);
  const q = new SessionModel<StickInput>();
  let server = s0;
  pr.reset(s0, 0, 0);
  let seq = 0, lastArrival = 0;
  const inFlight: { at: number; seq: number }[] = [];
  const snaps: { at: number; fs: FlightState; ack: number; tick: number }[] = [];
  const predicted = new Map<number, V3>(), truth = new Map<number, V3>(), sentAt: number[] = [];
  for (let t = 1; t <= o.ticks; t++) {
    if (!o.stalled?.(t)) {
      seq++;
      pr.push(seq, INP, pr.tickFor(seq), RUNWAY);
      predicted.set(seq, pr.state().pos);
      sentAt[seq] = t;
      lastArrival = Math.max(lastArrival, t + o.uplink(t)); // TCP: in order
      inFlight.push({ at: lastArrival, seq });
    }
    while (inFlight.length && inFlight[0].at <= t) q.push(inFlight.shift()!.seq, INP);
    const n = q.next(); // server tick t
    if (n.inp) server = stepFlight(server, n.inp, F16, { turbo: false, ground: { h: 0, surf: 1 } });
    if (n.fresh) truth.set(q.ack, server.pos);
    if (t % 2 === 0) snaps.push({ at: t + DOWNLINK, fs: server, ack: q.ack, tick: t });
    while (snaps.length && snaps[0].at <= t) {
      const s = snaps.shift()!;
      pr.reconcile(s.fs, s.ack, s.tick, RUNWAY);
    }
    if (!o.stalled?.(t)) pr.render(1 / 60);
  }
  const err: number[] = [];
  for (const [k, p] of predicted) {
    const tr = truth.get(k);
    if (tr) err[k] = dist(p, tr);
  }
  return { sentAt, err };
}

/** Largest error over seqs sent in [from, to). */
function worst(r: { sentAt: number[]; err: number[] }, from: number, to = Infinity): number {
  let w = 0;
  r.err.forEach((e, k) => { if (r.sentAt[k] >= from && r.sentAt[k] < to) w = Math.max(w, e); });
  return w;
}

test("steady latency: prediction is exact", () => {
  const r = run({ ticks: 600, uplink: () => 3 });
  assert.ok(worst(r, 60) < 1e-9, `${worst(r, 60)}`); // after the first second (the model has no pre-spawn history)
});

test("uplink delay step 3 → 9 ticks: back on the server within 1.5 s", () => {
  const r = run({ ticks: 900, uplink: (t) => (t < 300 ? 3 : 9) });
  const after = worst(r, 300 + 90);
  assert.ok(after < 0.01, `${after.toFixed(3)} m off the server 1.5 s after the step`);
});

test("uplink delay step 9 → 3 ticks: back on the server within 1.5 s", () => {
  const r = run({ ticks: 900, uplink: (t) => (t < 300 ? 9 : 3) });
  const after = worst(r, 300 + 90);
  assert.ok(after < 0.01, `${after.toFixed(3)} m off the server 1.5 s after the step`);
});

test("2 s send stall (tab hidden) then resume: back on the server within 1.5 s", () => {
  const r = run({ ticks: 900, uplink: () => 3, stalled: (t) => t >= 300 && t < 420 });
  const after = worst(r, 420 + 90);
  assert.ok(after < 0.01, `${after.toFixed(3)} m off the server 1.5 s after resuming`);
});

test("bursty delivery: at most one tick of travel off the server", () => {
  for (const burst of [3, 6, 8]) {
    const r = run({ ticks: 900, uplink: (t) => Math.ceil(t / burst) * burst + 2 - t });
    const w = worst(r, 120);
    assert.ok(w <= TICK_M * 1.05, `burst ${burst}: ${w.toFixed(3)} m (one tick = ${TICK_M.toFixed(3)} m)`);
  }
});
