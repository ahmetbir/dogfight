import { test } from "node:test";
import assert from "node:assert/strict";
import { CAM_MAX_MS, MissileCam, chasePose, insetRect } from "./missilecam.ts";

test("inset is a bottom-center 16:9 quarter", () => {
  assert.deepEqual(insetRect(1280, 720), { x: 480, y: 16, w: 320, h: 180 });
});

test("chase pose sits behind and above the missile", () => {
  const p = chasePose({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: -400 });
  assert.deepEqual(p.eye, { x: 0, y: 104, z: 20 });
  assert.ok(p.look.z < 0);
});

test("missile cam lifetime", () => {
  const c = new MissileCam();
  c.follow(7, 0);
  assert.ok(c.active(1000));
  assert.ok(!c.active(CAM_MAX_MS + 1));
  c.follow(8, 10000);
  c.stop(11000);
  assert.ok(c.active(11400));
  assert.ok(!c.active(11600));
});

test("the inset pose can sit higher and farther back (over its own smoke)", () => {
  const p = chasePose({ x: 0, y: 100, z: 0 }, { x: 0, y: 0, z: -400 }, 30, 8);
  assert.deepEqual(p.eye, { x: 0, y: 108, z: 30 });
});
