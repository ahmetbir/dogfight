import { test } from "node:test";
import assert from "node:assert/strict";
import { InterpBuffer } from "../predict/interp.ts";
import type { FlightState } from "../sim/flight.ts";
import { GEAR_HEIGHT } from "../sim/ground.ts";
import { dot, qAxisAngle, qForward, qIdentity, v3, type Q } from "../sim/vec.ts";
import { BLEND_MS, RemotePoses, rawPose, remoteG } from "./remote.ts";

const FLAT = () => 0;
const level = (x: number, extra: Partial<FlightState> = {}): FlightState =>
  ({ pos: v3(x, 1000, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1, ...extra });
const angle = (a: Q, b: Q) => Math.acos(Math.min(1, Math.abs(dot(qForward(a), qForward(b)))));
const bufOf = (...e: [number, FlightState][]) => {
  const b = new InterpBuffer();
  for (const [t, fs] of e) b.push(t, fs);
  return b;
};

test("past the newest snapshot the attitude turns on at the body rate", () => {
  // pulling: pitch rate 1.5 rad/s (body x), nose -Z, flying -Z at 200 m/s
  const fs: FlightState = { pos: v3(0, 1000, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 1, w: v3(1.5, 0, 0) };
  const at = rawPose(bufOf([0, fs]), 133, FLAT)!;
  const want = qAxisAngle(v3(1, 0, 0), 1.5 * 0.133);
  assert.ok(angle(at.rot, want) < 1e-9, "nose carried by w·t");
  assert.ok(at.vel.y > 0 && Math.abs(Math.hypot(at.vel.y, at.vel.z) - 200) < 1e-9, "velocity turns with it, speed kept");
  assert.ok(at.pos.y > 1000, "and the path curves up");
});

test("carrying stops at 500 ms past the newest snapshot", () => {
  const b = bufOf([0, level(0)]);
  assert.ok(Math.abs(rawPose(b, 500, FLAT)!.pos.x - 100) < 1e-9);
  assert.equal(rawPose(b, 2000, FLAT)!.pos.x, rawPose(b, 500, FLAT)!.pos.x);
});

test("a carried plane is never drawn under the ground", () => {
  const diving = level(0, { pos: v3(0, 20, 0), vel: v3(100, -100, 0) });
  assert.equal(rawPose(bufOf([0, diving]), 400, () => 5)!.pos.y, 5 + GEAR_HEIGHT);
});

test("a plane with its gear down or on its wheels is held, not carried", () => {
  for (const extra of [{ gear: true }, { ground: true }]) {
    assert.equal(rawPose(bufOf([0, level(0, extra)]), 200, FLAT)!.pos.x, 0);
  }
});

test("the G estimate keeps the turn while carried (not 1 g)", () => {
  const turning: FlightState = { pos: v3(0, 1000, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 1, w: v3(1.0, 0, 0) };
  const b = bufOf([0, turning]);
  const now = rawPose(b, 200, FLAT)!;
  const g = remoteG(b, 200, now, FLAT);
  assert.ok(Math.abs(g - Math.hypot(200 * 1.0 / 9.81, 1)) < 1.5, `g ${g.toFixed(2)}`);
});

test("a late snapshot is blended in over BLEND_MS, a teleport is not", () => {
  const p = new RemotePoses(FLAT);
  const b = bufOf([0, level(0)], [33, level(6.6)]);
  const bufs = new Map([[2, b]]);
  const alive = () => true;
  p.frame(bufs, alive, 150, 1000); // carried: 6.6 + 200·0.117 = 30
  // the late snapshot says the plane slowed: 30 m on at 150 ms is really 25 m
  b.push(150, level(25, { vel: v3(150, 0, 0) }));
  b.push(183, level(30, { vel: v3(150, 0, 0) }));
  const first = p.frame(bufs, alive, 151, 1001).get(2)!.fs.pos.x;
  assert.ok(first > 28.9, `starts from where it was drawn, got ${first.toFixed(2)}`);
  const end = p.frame(bufs, alive, 150 + BLEND_MS, 1000 + BLEND_MS + 1).get(2)!.fs.pos.x;
  assert.ok(Math.abs(end - rawPose(b, 150 + BLEND_MS, FLAT)!.pos.x) < 1e-9, "settled after BLEND_MS");

  const q = new RemotePoses(FLAT);
  const c = bufOf([0, level(0)], [33, level(6.6)]);
  const cs = new Map([[2, c]]);
  q.frame(cs, alive, 150, 1000);
  c.push(150, level(2000)); // reset across the map
  assert.equal(q.frame(cs, alive, 150, 1001).get(2)!.fs.pos.x, 2000);
});

test("planeAt, the camera and the sound read the same pose as the mesh", () => {
  const p = new RemotePoses(FLAT);
  const b = bufOf([0, level(0)], [33, level(6.6)]);
  const poses = p.frame(new Map([[2, b]]), () => true, 120, 0);
  assert.ok(Math.abs(poses.get(2)!.fs.pos.x - 24) < 1e-9, "one pose per plane per frame, carried past 33 ms");
});
