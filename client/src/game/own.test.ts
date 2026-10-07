import { test } from "node:test";
import assert from "node:assert/strict";
import { EASE_FROM_MS, OwnPlane, stallStick } from "./own.ts";
import { stepFlight } from "../sim/flight.ts";
import { AIR_ENV } from "./env.ts";
import type { FlightEnv } from "../predict/predictor.ts";
import type { AircraftInfo, ClientMsg, In, PlaneJSON } from "../net/protocol.ts";

const F16: AircraftInfo = { kind: "f16", name: "F-16", team: "nato", maxHP: 100, maxSpeed: 230, maxSpeedAB: 290, accel: 48,
  rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, lockRange: 1200, missiles: 4, flares: 6, rotateSpeed: 78 };
const aircraft = new Map([["f16", F16]]);
const plane = (a = true, z = 0): PlaneJSON => ({ id: 1, k: "f16", tm: "none", p: [0, 1500, z], q: [1, 0, 0, 0], v: [0, 0, -200],
  th: 0.6, hp: 100, a, ht: 0, oh: false, ms: 4, fl: 6 });
const stick = { p: 0, r: 0, y: 0, th: 1, ab: false };
function sink(open = true) {
  const sent: In[] = [];
  return { sent, send: (m: ClientMsg) => { if (open) sent.push(m as In); return open; } };
}

test("seq starts at 1, only advances on a written send, and restarts after reset", () => {
  const o = new OwnPlane(() => AIR_ENV);
  const closed = sink(false);
  o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, closed);
  const s = sink();
  o.tick({ stick, fire: false, missile: true, flare: false, bomb: false }, s);
  o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, s);
  assert.deepEqual(s.sent.map((m) => [m.seq, m.m]), [[1, true], [2, false]]);
  o.reset();
  o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, s);
  assert.equal(s.sent[2].seq, 1);
});

test("spawn starts prediction; later snapshots reconcile", () => {
  const o = new OwnPlane(() => AIR_ENV);
  assert.equal(o.state(), null);
  assert.equal(o.snap(plane(), 0, false, aircraft, 0), true);
  assert.equal(o.state()!.pos.y, 1500);
  const s = sink();
  o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, s);
  assert.ok(o.state()!.pos.z < 0, "predicted forward");
  assert.equal(o.snap(plane(true, -3.3), 1, false, aircraft, 1), false);
  assert.equal(o.state()!.pos.z, -3.3, "acked: server state, nothing to replay");
  assert.equal(o.snap(plane(false), 1, false, aircraft, 0), false);
  assert.equal(o.state(), null);
  assert.equal(o.snap(plane(), 1, false, aircraft, 0), true, "alive again → restart");
  assert.equal(o.snap(plane(), 1, true, aircraft, 0), true, "spawn event → restart");
});

test("the gun fires every 4 ticks while held, not when dead or overheated", () => {
  const o = new OwnPlane(() => AIR_ENV);
  const s = sink();
  assert.equal(o.tick({ stick, fire: true, missile: false, flare: false, bomb: false }, s), null, "dead");
  o.snap(plane(), 0, false, aircraft, 0);
  const shots = [];
  for (let i = 0; i < 8; i++) shots.push(o.tick({ stick, fire: true, missile: false, flare: false, bomb: false }, s));
  assert.equal(shots.filter(Boolean).length, 2);
  const shot = shots.find(Boolean)!;
  assert.ok(shot.vel.z < -1000 && shot.pos.z < -7);
  o.snap({ ...plane(), oh: true }, 0, false, aircraft, 0);
  for (let i = 0; i < 8; i++) assert.equal(o.tick({ stick, fire: true, missile: false, flare: false, bomb: false }, s), null);
});

test("neutral input keeps the throttle and clears everything else", () => {
  const o = new OwnPlane(() => AIR_ENV);
  const s = sink();
  o.tick({ stick: { p: 1, r: -1, y: 1, th: 0.7, ab: true, g: true, br: true }, fire: true, missile: true, flare: true, bomb: true }, s);
  o.neutral(s);
  assert.deepEqual(s.sent[1], { t: "in", seq: 2, p: 0, r: 0, y: 0, th: 0.7, ab: false, f: false, m: false, fl: false,
    g: true, br: false, bo: false }, "keeps the wanted gear: a hidden tab on final must not retract it");
});

test("level flight reads about 1 g", () => {
  const o = new OwnPlane(() => AIR_ENV);
  o.snap({ ...plane(), v: [0, 0, -230] }, 0, false, aircraft, 0);
  for (let i = 0; i < 120; i++) o.tick({ stick: { ...stick, th: 1 }, fire: false, missile: false, flare: false, bomb: false }, sink());
  assert.ok(Math.abs(o.gForce() - 1) < 0.1, `${o.gForce()}`);
});

test("spin is the last tick's rotation step (identity until it turns)", () => {
  const o = new OwnPlane(() => AIR_ENV);
  assert.deepEqual(o.spin(), { w: 1, x: 0, y: 0, z: 0 });
  o.snap(plane(), 0, false, aircraft, 0);
  const s = sink();
  o.tick({ stick: { ...stick, p: 1 }, fire: false, missile: false, flare: false, bomb: false }, s);
  const before = o.state()!.rot;
  o.tick({ stick: { ...stick, p: 1 }, fire: false, missile: false, flare: false, bomb: false }, s);
  const sp = o.spin();
  assert.ok(sp.w < 1 && Math.abs(sp.x) > 1e-4, "pull: rotation about the right axis");
  // spin applied to the previous attitude gives the current one
  const q = o.state()!.rot;
  const m = { w: sp.w * before.w - sp.x * before.x - sp.y * before.y - sp.z * before.z };
  assert.ok(Math.abs(m.w - q.w) < 1e-9);
  o.reset();
  assert.deepEqual(o.spin(), { w: 1, x: 0, y: 0, z: 0 });
});

test("a parked plane is predicted on the ground under it, not at sea level", () => {
  const env: FlightEnv = { turbo: false, ground: () => ({ h: 300, surf: 2 }), wind: () => ({ x: 0, y: 0, z: 0 }) };
  const o = new OwnPlane(() => env);
  const parked: PlaneJSON = { ...plane(), p: [0, 302.5, 0], v: [0, 0, 0], th: 0, gr: true, gd: true };
  assert.equal(o.snap(parked, 0, false, aircraft, 50), true);
  const s = sink();
  for (let i = 0; i < 30; i++) o.tick({ stick: { ...stick, th: 0.3, g: true }, fire: false, missile: false, flare: false, bomb: false }, s);
  const fs = o.state()!;
  assert.equal(fs.ground, true);
  assert.equal(fs.pos.y, 302.5);
  assert.ok(fs.pos.z < 0, "taxis forward");
  o.snap({ ...parked, p: [0, 302.5, -1] }, 10, false, aircraft, 60); // 20 inputs replayed on the same ground
  assert.equal(o.state()!.pos.y, 302.5);
});

test("tick sends gear, brake and bomb", () => {
  const o = new OwnPlane(() => AIR_ENV);
  const s = sink();
  o.tick({ stick: { ...stick, g: true, br: true }, fire: false, missile: false, flare: false, bomb: true }, s);
  o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, s);
  assert.deepEqual(s.sent.map((m) => [m.g, m.br, m.bo]), [[true, true, true], [false, false, false]]);
});

test("reset (welcome) forgets the wanted gear", () => {
  const o = new OwnPlane(() => AIR_ENV);
  const s = sink();
  o.tick({ stick: { ...stick, g: true }, fire: false, missile: false, flare: false, bomb: false }, s);
  o.reset();
  o.neutral(s);
  assert.equal(s.sent[1].g, false);
});

test("prediction samples the wind at the world tick each input will run on, even past the pending cap", () => {
  const asked: number[] = [];
  const env: FlightEnv = { ...AIR_ENV, wind: (t) => { asked.push(t); return { x: 0, y: 0, z: 0 }; } };
  const o = new OwnPlane(() => env);
  o.snap(plane(), 0, false, aircraft, 50); // world tick 50, nothing acked
  const s = sink();
  for (let i = 0; i < 200; i++) o.tick({ stick, fire: false, missile: false, flare: false, bomb: false }, s);
  assert.deepEqual(asked.slice(0, 3), [51, 52, 53]);
  assert.equal(asked.at(-1), 250, "acks stalled past the 120-input cap: seq 200 still runs on tick 250");
  asked.length = 0;
  o.snap(plane(), 10, false, aircraft, 60); // seq 10 applied on world tick 60; pending kept seq 81..200
  assert.equal(asked.length, 120);
  assert.deepEqual([asked[0], asked.at(-1)], [131, 250], "replay of seq 81..200 on ticks 131..250");
});

test("signed load factor: about +1 level, positive pulling, negative pushing", () => {
  const fly = (p: number) => {
    const o = new OwnPlane(() => AIR_ENV);
    o.snap({ ...plane(), v: [0, 0, -230] }, 0, false, aircraft, 0);
    for (let i = 0; i < 40; i++) o.tick({ stick: { ...stick, p }, fire: false, missile: false, flare: false, bomb: false }, sink());
    return o.gLoad();
  };
  assert.ok(Math.abs(fly(0) - 1) < 0.15, `level ${fly(0)}`);
  assert.ok(fly(1) > 7, `pull ${fly(1)}`);
  assert.ok(fly(-1) < -2, `push ${fly(-1)}`);
});

test("stallStick: my stick until 250 ms of silence, then eased to the held input over 250 ms", () => {
  const mine = { p: 1, r: -1, y: 0.5, th: 0.4, ab: false, g: true };
  const held = { p: 0.2, r: 0.2, y: 0, th: 1, ab: true, g: false };
  assert.deepEqual(stallStick(mine, held, 0), mine);
  assert.deepEqual(stallStick(mine, held, EASE_FROM_MS), mine);
  const half = stallStick(mine, held, EASE_FROM_MS + 125);
  assert.ok(Math.abs(half.p - 0.6) < 1e-12 && Math.abs(half.r + 0.4) < 1e-12 && Math.abs(half.y - 0.25) < 1e-12, JSON.stringify(half));
  assert.deepEqual([half.th, half.ab, half.g], [1, true, false], "throttle, afterburner and gear held while easing");
  assert.deepEqual(stallStick(mine, held, EASE_FROM_MS + 250), held);
  assert.deepEqual(stallStick(mine, held, 5000), held);
});

test("during a stall prediction flies the last input the server heard, but my inputs still go out", () => {
  const o = new OwnPlane(() => AIR_ENV);
  o.snap(plane(), 0, false, aircraft, 0);
  const s = sink();
  const turn = { p: 0.4, r: 0.3, y: 0, th: 1, ab: false };
  const pull = { p: 1, r: -1, y: 0, th: 0.2, ab: false };
  const ctl = (st: typeof stick) => ({ stick: st, fire: false, missile: false, flare: false, bomb: false });
  o.tick(ctl(turn), s, 20);
  const before = o.state()!;
  o.tick(ctl(pull), s, 600); // silent for 600 ms: fully eased
  assert.deepEqual(o.state(), stepFlight(before, turn, F16, { turbo: false, wind: { x: 0, y: 0, z: 0 }, ground: { h: 0, surf: 0 } }));
  assert.deepEqual([s.sent[1].p, s.sent[1].r, s.sent[1].th], [1, -1, 0.2], "the wire carries my stick");
});

test("after a stall, the queued snapshots are not reconciled until the server acks my latest input", () => {
  const o = new OwnPlane(() => AIR_ENV);
  o.snap(plane(), 0, false, aircraft, 0);
  const s = sink();
  const ctl = { stick, fire: false, missile: false, flare: false, bomb: false };
  for (let i = 0; i < 10; i++) o.tick(ctl, s, 0);
  for (let i = 0; i < 60; i++) o.tick(ctl, s, 300 + i * 17); // the server went silent
  const predicted = o.state()!;
  o.snap(plane(true, -500), 5, false, aircraft, 40); // a stale snapshot from the burst (ack 5 < seq 70)
  assert.deepEqual(o.state(), predicted, "stale: not reconciled");
  o.snap(plane(true, -500), 69, false, aircraft, 80);
  assert.deepEqual(o.state(), predicted, "still behind my latest input");
  o.snap(plane(true, -500), 70, false, aircraft, 82);
  assert.equal(o.state()!.pos.z, -500, "acked: reconciled on the server state");
});

test("the post-stall wait gives up after a second of my ticks", () => {
  const o = new OwnPlane(() => AIR_ENV);
  o.snap(plane(), 0, false, aircraft, 0);
  const s = sink();
  const ctl = { stick, fire: false, missile: false, flare: false, bomb: false };
  o.tick(ctl, s, 400);
  o.snap(plane(true, -500), 0, false, aircraft, 10);
  assert.notEqual(o.state()!.pos.z, -500);
  for (let i = 0; i < 60; i++) o.tick(ctl, s, 0);
  o.snap(plane(true, -500), 1, false, aircraft, 20);
  assert.ok(o.state()!.pos.z < -500, "reconciled: the server state plus the replayed inputs");
});
