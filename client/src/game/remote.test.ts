import { test } from "node:test";
import assert from "node:assert/strict";
import { InterpBuffer } from "../predict/interp.ts";
import type { FlightState } from "../sim/flight.ts";
import { GEAR_HEIGHT } from "../sim/ground.ts";
import { dot, qAxisAngle, qForward, qIdentity, v3, type Q } from "../sim/vec.ts";
import { BLEND_MS, CRASH_CLEARANCE, drawnAt, RemotePoses, rawPose, remoteG, TELEPORT_M } from "./remote.ts";

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

test("a carried plane is never drawn under the server's crash line or its wheels", () => {
  const diving = level(0, { pos: v3(0, 20, 0), vel: v3(100, -100, 0) });
  assert.equal(rawPose(bufOf([0, diving]), 400, () => 5)!.pos.y, 5 + CRASH_CLEARANCE, "gear up: crash clearance");
  assert.equal(rawPose(bufOf([0, { ...diving, gear: true }]), 400, () => 5)!.pos.y, 5 + GEAR_HEIGHT, "gear down: on its wheels");
  const skimming = level(0, { pos: v3(0, 5 + 2.2, 0) }); // gear up, 2.2 m over the ground: alive on the server
  assert.equal(rawPose(bufOf([0, skimming]), 0, () => 5)!.pos.y, 5 + 2.2, "not lifted inside the buffer");
});

test("a plane on its wheels holds; gear down in the air is carried on", () => {
  assert.equal(rawPose(bufOf([0, level(0, { ground: true })]), 200, FLAT)!.pos.x, 0);
  assert.ok(Math.abs(rawPose(bufOf([0, level(0, { gear: true })]), 200, FLAT)!.pos.x - 40) < 1e-9);
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

test("one pose per plane per frame; planeAt reads it", () => {
  const p = new RemotePoses(FLAT);
  const b = bufOf([0, level(0)], [33, level(6.6)]);
  const poses = p.frame(new Map([[2, b]]), () => true, 120, 0);
  assert.ok(Math.abs(poses.get(2)!.fs.pos.x - 24) < 1e-9, "carried past 33 ms");
  assert.deepEqual(drawnAt(poses, 2), { pos: poses.get(2)!.fs.pos, vel: poses.get(2)!.fs.vel });
  assert.equal(drawnAt(poses, 3), null);
});

test("a hard roll with angle of attack neither swerves nor shows G", () => {
  // nose -Z, path 25° below it, 250 m/s, rolling 8.4 rad/s only
  const aoa = 25 * Math.PI / 180;
  const vel = v3(0, -250 * Math.sin(aoa), -250 * Math.cos(aoa));
  const b = bufOf([0, { pos: v3(0, 1000, 0), rot: qIdentity(), vel, th: 1, w: v3(0, 0, 8.4) }]);
  for (const t of [133, 300, 500]) {
    const at = rawPose(b, t, FLAT)!;
    const straight = v3(vel.x * t / 1000, 1000 + vel.y * t / 1000, vel.z * t / 1000);
    assert.ok(Math.hypot(at.pos.x - straight.x, at.pos.y - straight.y, at.pos.z - straight.z) < 1e-6, `${t} ms: drifted`);
    assert.ok(Math.abs(remoteG(b, t, at, FLAT) - 1) < 1e-6, `${t} ms: phantom G`);
  }
});

test("a second snapshot during a blend starts from the drawn pose", () => {
  const p = new RemotePoses(FLAT);
  const b = bufOf([0, level(0)], [33, level(6.6)]);
  const bufs = new Map([[2, b]]);
  const alive = () => true;
  p.frame(bufs, alive, 150, 1000);
  b.push(140, level(25, { vel: v3(150, 0, 0) })); // still carried: rt 150 > 140
  const mid = p.frame(bufs, alive, 160, 1010).get(2)!.fs.pos.x; // blending
  b.push(150, level(26.5, { vel: v3(150, 0, 0) })); // second late snapshot, still carried
  const next = p.frame(bufs, alive, 161, 1011).get(2)!.fs.pos.x;
  assert.ok(Math.abs(next - mid) < 1, `continues from ${mid.toFixed(2)}, got ${next.toFixed(2)}`);
});

test("the pop threshold grows with speed", () => {
  const fast = (x: number) => level(x, { vel: v3(330, 0, 0) });
  const p = new RemotePoses(FLAT);
  const b = bufOf([0, fast(0)], [33, fast(10.9)]);
  const bufs = new Map([[2, b]]);
  p.frame(bufs, () => true, 400, 1000); // carried to 10.9 + 330·0.367 = 132
  b.push(400, fast(132 - 150)); // 150 m behind: over TELEPORT_M, under 330 m/s · 0.6 s
  assert.ok(150 > TELEPORT_M);
  const at = p.frame(bufs, () => true, 400, 1001).get(2)!.fs.pos.x;
  assert.ok(at > 100, `blended from the drawn pose, got ${at.toFixed(1)}`);
});
