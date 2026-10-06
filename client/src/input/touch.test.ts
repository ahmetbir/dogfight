import { test } from "node:test";
import assert from "node:assert/strict";
import { qAxisAngle, qIdentity, v3 } from "../sim/vec.ts";
import { DEFAULT_SETTINGS, makeScheme } from "./schemes.ts";
import { newTouchState, stickVector, touchStick } from "./touch.ts";

test("stick vector: unit disk, deadzone, screen y down", () => {
  assert.deepEqual(stickVector(5, 5, 100), { x: 0, y: 0 });
  const v = stickVector(0, -200, 100);
  assert.ok(Math.abs(v.x) < 1e-9 && Math.abs(v.y - 1) < 1e-9, "dragging up past the rim = full up");
  const d = stickVector(60, 80, 100);
  assert.ok(Math.abs(Math.hypot(d.x, d.y) - 1) < 1e-9 && d.y < 0);
});

test("released stick levels the wings", () => {
  const banked = qAxisAngle(v3(0, 0, -1), 0.8); // rolled right
  const out = touchStick(null, banked, false);
  assert.ok(out.r < 0, `assist rolls left, got ${out.r}`);
  const held = touchStick({ x: 0, y: 1 }, qIdentity(), false);
  assert.equal(held.p, 1);
  assert.equal(touchStick({ x: 0, y: 1 }, qIdentity(), true).p, -1);
});

test("touch scheme: toggles persist, taps are one-shot", () => {
  const sc = makeScheme({ ...DEFAULT_SETTINGS, scheme: "touch" });
  assert.equal(sc.kind, "touch");
  const touch = newTouchState();
  const st = { keys: new Set<string>(), buttons: 0, consumeMouse: () => ({ dx: 0, dy: 0 }), takePress: () => false, touch };
  const plane = { rot: qIdentity(), th: 0, gear: true };
  touch.throttle = 0.7;
  touch.taps.add("ab").add("missile").add("gear");
  touch.fire = true;
  let f = sc.frame(st, plane, 1 / 60);
  assert.deepEqual([f.stick.th, f.stick.ab, f.missile, f.fire, f.stick.g], [0.7, true, true, true, false]);
  f = sc.frame(st, plane, 1 / 60);
  assert.deepEqual([f.stick.ab, f.missile, f.stick.g], [true, false, false], "AB and gear stay toggled; missile was one tap");
});

test("touch scheme: a runway respawn puts the slider at idle; held stick beats tilt", () => {
  const sc = makeScheme({ ...DEFAULT_SETTINGS, scheme: "touch" });
  const touch = newTouchState();
  const st = { keys: new Set<string>(), buttons: 0, consumeMouse: () => ({ dx: 0, dy: 0 }), takePress: () => false, touch };
  touch.throttle = 0.9;
  sc.reset();
  const f = sc.frame(st, { rot: qIdentity(), th: 1, ground: true }, 1 / 60);
  assert.equal(f.stick.th, 0);
  assert.equal(touch.throttle, 0, "the slider follows");
  touch.tilt = { x: 0, y: -1 };
  assert.equal(sc.frame(st, { rot: qIdentity(), th: 0 }, 1 / 60).stick.p, -1, "tilt flies while the stick is free");
  touch.stick = { x: 0, y: 1 };
  assert.equal(sc.frame(st, { rot: qIdentity(), th: 0 }, 1 / 60).stick.p, 1);
});
