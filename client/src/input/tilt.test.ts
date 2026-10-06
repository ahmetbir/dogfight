import { test } from "node:test";
import assert from "node:assert/strict";
import { stableAngles, tiltToStick } from "./tilt.ts";

test("tilt maps ±25° around the reference to a full stick", () => {
  const ref = { beta: 10, gamma: -40 };
  assert.deepEqual(tiltToStick(10, -40, ref, 1), { x: 0, y: 0 });
  const s = tiltToStick(10 + 25, -40, ref, 1);
  assert.ok(Math.abs(s.x - 1) < 1e-9 && s.y === 0);
  assert.ok(Math.abs(tiltToStick(10 + 50, -40, ref, 1).x - 1) < 1e-9, "clamped");
  assert.ok(tiltToStick(10, -40 + 12.5, ref, -1).y < 0, "landscape side flips pitch");
});

test("tilt stays continuous when the phone passes vertical (gamma wrap, beta +180)", () => {
  const ref = { beta: 0, gamma: -60 };
  const before = tiltToStick(0, -89.5, ref, 1);
  // the same pose rotated 1° further: browsers report gamma +89.5 and beta 180
  const after = tiltToStick(180, 89.5, ref, 1);
  assert.ok(before.y < -0.99 && Math.abs(before.x) < 1e-6, `before ${JSON.stringify(before)}`);
  assert.ok(after.y < -0.99 && Math.abs(after.x) < 1e-6, `after flips to ${JSON.stringify(after)}`);
  // small tilts just past vertical stay proportional, not a full opposite stick
  const ref2 = { beta: 0, gamma: -85 };
  const s = tiltToStick(180, 88, ref2, 1);
  assert.ok(Math.abs(s.y + 7 / 25) < 1e-6 && Math.abs(s.x) < 1e-6, `past vertical ${JSON.stringify(s)}`);
});

test("stableAngles equals beta/gamma away from the singularity", () => {
  for (const [b, g] of [[10, -40], [-30, 20], [60, -80]]) {
    const a = stableAngles(b, g);
    assert.ok(Math.abs(a.bank - b) < 1e-9 && Math.abs(a.pitch - g) < 1e-9, `${b},${g} → ${JSON.stringify(a)}`);
  }
});
