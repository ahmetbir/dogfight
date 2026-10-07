import { test } from "node:test";
import assert from "node:assert/strict";
import { Predictor, smoothTime, type FlightEnv } from "./predictor.ts";
import { AIR_ENV } from "../game/env.ts";
import { stepFlight, type FlightState, type Spec, type StickInput } from "../sim/flight.ts";
import { add, dist, qAxisAngle, qIdentity, qMul, v3, type Q } from "../sim/vec.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const start = (): FlightState => ({ pos: v3(0, 1500, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 1 });
const input = (i: number): StickInput => ({ p: Math.sin(i / 7), r: Math.cos(i / 11), y: 0.2, th: (i % 5) / 4, ab: i % 3 === 0 });

test("reconcile replays unacked inputs onto the server state exactly", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  const serverStates: FlightState[] = [start()]; // serverStates[n] = after inputs 1..n
  const LAG = 6;
  for (let seq = 1; seq <= 120; seq++) {
    serverStates.push(stepFlight(serverStates[seq - 1], input(seq), F16, { turbo: false }));
    pr.push(seq, input(seq), seq, AIR_ENV);
    if (seq % 2 === 0 && seq > LAG) {
      const ack = seq - LAG;
      pr.reconcile(serverStates[ack], ack, ack, AIR_ENV);
      let want = serverStates[ack];
      for (let s = ack + 1; s <= seq; s++) want = stepFlight(want, input(s), F16, { turbo: false });
      assert.deepEqual(pr.state(), want, `seq ${seq}`);
      const r = pr.render(0);
      assert.deepEqual(r.pos, want.pos, `render offset is zero @${seq}`);
    }
  }
});

/** Drawn − physics distance per frame after a correction of off metres along x. */
function fade(off: number, frames: number): number[] {
  const pr = new Predictor(F16);
  pr.reset(start());
  pr.push(1, input(1), 1, AIR_ENV);
  const server = pr.state();
  pr.reconcile({ ...server, pos: add(server.pos, v3(off, 0, 0)) }, 1, 1, AIR_ENV);
  assert.ok(dist(pr.render(0).pos, server.pos) < 1e-9, "render starts at the old position");
  const out: number[] = [];
  for (let f = 0; f < frames; f++) out.push(dist(pr.render(1 / 60).pos, pr.state().pos));
  return out;
}

test("smoothing time grows with the correction: 0.15 s small, 0.6 s large", () => {
  assert.equal(smoothTime(0.5), 0.15);
  assert.equal(smoothTime(1), 0.15);
  assert.equal(smoothTime(40), 0.6);
  assert.equal(smoothTime(140), 0.6);
  assert.ok(smoothTime(10) > 0.15 && smoothTime(10) < smoothTime(20) && smoothTime(20) < 0.6);
});

test("a 0.8 m correction decays with a 0.15 s time constant", () => {
  const d = fade(0.8, 9); // 9 frames = 0.15 s
  assert.ok(Math.abs(d[8] - 0.8 / Math.E) < 1e-6, `${d[8]}`);
});

test("a 10 m correction fades below 1 m within 600 ms", () => {
  const d = fade(10, 36);
  assert.ok(d[35] < 1, `offset after 600 ms = ${d[35]}`);
});

test("a 100 m correction glides: no frame moves more than 100 m × dt / 0.6 s", () => {
  const d = fade(100, 180);
  let prev = 100;
  for (const x of d) {
    assert.ok(prev - x <= (100 / 60) / 0.6 + 1e-9, `step ${prev - x} m`);
    prev = x;
  }
  assert.ok(d[0] > 95, "not teleported");
  assert.ok(d[179] < 2, `offset after 3 s = ${d[179]}`);
});

test("a 250 m correction glides at no more than 150 m/s", () => {
  const d = fade(250, 240);
  let prev = 250;
  for (const x of d) {
    assert.ok(prev - x <= 150 / 60 + 1e-9, `step ${prev - x} m`);
    prev = x;
  }
  assert.ok(d[0] > 247, "not teleported");
  assert.ok(d[239] < 2, `offset after 4 s = ${d[239]}`);
});

test("corrections over 300 m teleport", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  const far = { ...start(), pos: v3(0, 1500, -310) };
  pr.reconcile(far, 0, 0, AIR_ENV);
  assert.deepEqual(pr.render(0).pos, far.pos);
});

test("acked inputs are dropped and setSpec changes the replay spec", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  for (let seq = 1; seq <= 3; seq++) pr.push(seq, input(seq), seq, AIR_ENV);
  const other: Spec = { ...F16, accel: 60 };
  pr.setSpec(other);
  pr.reconcile(start(), 2, 2, AIR_ENV);
  assert.deepEqual(pr.state(), stepFlight(start(), input(3), other, { turbo: false }));
  pr.reconcile(start(), 3, 3, AIR_ENV);
  assert.deepEqual(pr.state(), start());
});

// Angle between two unit quaternions (radians).
const qAngle = (a: Q, b: Q) => 2 * Math.acos(Math.min(1, Math.abs(a.w * b.w + a.x * b.x + a.y * b.y + a.z * b.z)));

test("without corrections the drawn rotation equals the predicted one", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  for (let seq = 1; seq <= 60; seq++) {
    pr.push(seq, { p: 1, r: 1, y: 0, th: 1, ab: false }, seq, AIR_ENV);
    const r = pr.render(1 / 60);
    const s = pr.state().rot;
    for (const k of ["w", "x", "y", "z"] as const) assert.ok(Math.abs(r.rot[k] - s[k]) < 1e-9, `frame ${seq} ${k}`);
  }
});

/** Drawn − physics attitude angle per frame after a correction of rad about the roll axis. */
function turnFade(rad: number, frames: number): number[] {
  const pr = new Predictor(F16);
  pr.reset(start());
  pr.push(1, input(1), 1, AIR_ENV);
  const old = pr.state();
  pr.reconcile({ ...old, rot: qMul(qAxisAngle(v3(0, 0, 1), rad), old.rot) }, 1, 1, AIR_ENV);
  assert.ok(qAngle(pr.render(0).rot, old.rot) < 1e-9, "drawn rot starts at the old value");
  const out: number[] = [];
  for (let f = 0; f < frames; f++) out.push(qAngle(pr.render(1 / 60).rot, pr.state().rot));
  return out;
}

test("a rotation correction converges within 600 ms", () => {
  const e = turnFade(0.5, 36);
  assert.ok(e[35] < 0.5 * 0.06, `residual ${e[35]} rad after 600 ms`);
});

test("attitude corrections are rate limited to 120°/s", () => {
  const limit = (120 * Math.PI) / 180 / 60 + 1e-9;
  for (const rad of [0.3, 1, 2.5]) {
    let prev = rad;
    for (const e of turnFade(rad, 150)) {
      assert.ok(prev - e <= limit, `${rad} rad: frame step ${prev - e} rad`);
      prev = e;
    }
    assert.ok(prev < 0.01, `${rad} rad: residual ${prev} after 2.5 s`);
  }
});

test("pending inputs are capped at 120 (no growth while acks stall)", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  for (let seq = 1; seq <= 1000; seq++) pr.push(seq, input(seq), seq, AIR_ENV);
  assert.equal(pr.pendingCount(), 120);
});

test("reconcile replays pending input i at snapTick+1+i (wind by world tick)", () => {
  const env: FlightEnv = { turbo: false, ground: () => ({ h: 0, surf: 0 }), wind: (t) => v3(t, 0, -t) };
  const pr = new Predictor(F16);
  pr.reset(start());
  for (let seq = 1; seq <= 3; seq++) pr.push(seq, input(seq), 10 + seq, env); // snapshot tick 10, nothing acked
  const before = pr.state();
  pr.reconcile(start(), 0, 10, env);
  assert.deepEqual(pr.state(), before, "same ticks, same wind: no correction");
  pr.reconcile(start(), 0, 11, env);
  assert.notDeepEqual(pr.state(), before, "a shifted tick base changes the replayed wind");
});

test("reconcile replays by seq: inputs dropped past the cap do not shift the wind ticks", () => {
  const env: FlightEnv = { turbo: false, ground: () => ({ h: 0, surf: 0 }), wind: (t) => v3(t, 0, -t) };
  const pr = new Predictor(F16);
  pr.reset(start());
  for (let seq = 1; seq <= 130; seq++) pr.push(seq, input(seq), 10 + seq, env); // seq 1..10 dropped
  pr.reconcile(start(), 5, 15, env); // the server applied seq 5 on tick 15; 6..10 are gone from pending
  let want = start();
  for (let seq = 11; seq <= 130; seq++) {
    want = stepFlight(want, input(seq), F16, { turbo: false, ground: { h: 0, surf: 0 }, wind: v3(10 + seq, 0, -10 - seq) });
  }
  assert.deepEqual(pr.state(), want);
});

test("ahead counts the predicted ticks past the latest snapshot", () => {
  const pr = new Predictor(F16);
  pr.reset(start(), 100, 40);
  assert.equal(pr.ahead(), 0);
  for (let seq = 41; seq <= 46; seq++) pr.push(seq, input(seq), pr.tickFor(seq), AIR_ENV);
  assert.equal(pr.ahead(), 6);
  pr.reconcile(start(), 43, 103, AIR_ENV);
  assert.equal(pr.ahead(), 3);
});
