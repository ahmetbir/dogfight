import { test } from "node:test";
import assert from "node:assert/strict";
import { ReplayBuffer, ReplayPlayer, type RFrame } from "./replay.ts";

const frame = (t: number, x: number): RFrame => ({ t, planes: [{ id: 1, k: "f16", tm: "nato", a: true, pos: { x, y: 0, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 } }], missiles: [] });

test("buffer keeps the last 10 s", () => {
  const b = new ReplayBuffer(10000);
  for (let t = 0; t <= 20000; t += 100) b.push(frame(t, t));
  const f = b.frames();
  assert.equal(f[0].t, 10000);
  assert.equal(f.at(-1)!.t, 20000);
});

test("player interpolates and ends", () => {
  const p = new ReplayPlayer([frame(1000, 0), frame(1100, 10), frame(1200, 30)]);
  assert.equal(p.duration(), 200);
  assert.equal(p.sample(50)!.planes[0].pos.x, 5);
  assert.equal(p.sample(150)!.planes[0].pos.x, 20);
  assert.ok(!p.done(199) && p.done(200));
  assert.equal(new ReplayPlayer([]).sample(0), null);
});

test("a plane missing from the next frame or respawning is not smeared", () => {
  const a = frame(0, 0);
  const b: RFrame = { t: 100, planes: [{ ...a.planes[0], a: false, pos: { x: 500, y: 0, z: 0 } }], missiles: [{ id: 3, pos: { x: 0, y: 0, z: 0 } }] };
  const p = new ReplayPlayer([a, b, { t: 200, planes: [], missiles: [{ id: 3, pos: { x: 10, y: 0, z: 0 } }] }]);
  assert.equal(p.sample(50)!.planes[0].pos.x, 0);
  assert.equal(p.sample(150)!.planes[0].pos.x, 500); // gone in the next frame: held, not lerped toward nothing
  assert.equal(p.sample(150)!.planes[0].a, false);
  assert.equal(p.sample(150)!.missiles[0].pos.x, 5);
});
