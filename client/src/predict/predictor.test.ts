import { test } from "node:test";
import assert from "node:assert/strict";
import { Predictor, type FlightEnv } from "./predictor.ts";
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

test("a 10 m server correction fades below 1 m within 300 ms", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  pr.push(1, input(1), 1, AIR_ENV);
  const server = pr.state();
  pr.reconcile({ ...server, pos: add(server.pos, v3(10, 0, 0)) }, 1, 1, AIR_ENV);
  assert.ok(dist(pr.state().pos, add(server.pos, v3(10, 0, 0))) < 1e-9, "physics snaps to server");
  assert.ok(dist(pr.render(0).pos, server.pos) < 1e-9, "render starts at the old position");
  let off = Infinity;
  for (let t = 0; t < 18; t++) { // 18 frames x 1/60 s = 300 ms
    const r = pr.render(1 / 60);
    off = dist(r.pos, pr.state().pos);
  }
  assert.ok(off < 1, `offset after 300 ms = ${off}`);
});

test("corrections over 50 m teleport", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  const far = { ...start(), pos: v3(0, 1500, -60) };
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

test("a rotation correction starts at the old attitude and converges within 300 ms", () => {
  const pr = new Predictor(F16);
  pr.reset(start());
  pr.push(1, input(1), 1, AIR_ENV);
  const old = pr.state();
  const jumped = { ...old, rot: qMul(qAxisAngle(v3(0, 0, 1), 0.5), old.rot) };
  pr.reconcile(jumped, 1, 1, AIR_ENV);
  assert.ok(qAngle(pr.render(0).rot, old.rot) < 1e-9, "drawn rot starts at the old value");
  let err = Infinity;
  for (let t = 0; t < 18; t++) err = qAngle(pr.render(1 / 60).rot, pr.state().rot);
  assert.ok(err < 0.5 * 0.06, `residual ${err} rad after 300 ms`);
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
