import { test } from "node:test";
import assert from "node:assert/strict";
import { extrapolate, InterpBuffer, ServerClock, INTERP_DELAY_MS } from "./interp.ts";
import { qAxisAngle, qIdentity, v3 } from "../sim/vec.ts";
import type { FlightState } from "../sim/flight.ts";

const at = (x: number, angle = 0): FlightState =>
  ({ pos: v3(x, 0, 0), rot: angle ? qAxisAngle(v3(0, 1, 0), angle) : qIdentity(), vel: v3(x * 2, 0, 0), th: x / 10 });

test("sample lerps pos/vel and slerps rot between neighbours", () => {
  const b = new InterpBuffer();
  assert.equal(b.sample(0), null);
  b.push(0, at(0));
  b.push(100, at(10, Math.PI / 2));
  const s = b.sample(50)!;
  assert.ok(Math.abs(s.pos.x - 5) < 1e-9);
  assert.ok(Math.abs(s.vel.x - 10) < 1e-9);
  const half = qAxisAngle(v3(0, 1, 0), Math.PI / 4);
  for (const k of ["w", "x", "y", "z"] as const) assert.ok(Math.abs(s.rot[k] - half[k]) < 1e-9, k);
});

test("sample clamps at both ends", () => {
  const b = new InterpBuffer();
  b.push(0, at(0));
  b.push(100, at(10));
  assert.equal(b.sample(-50)!.pos.x, 0);
  assert.equal(b.sample(500)!.pos.x, 10);
});

test("out-of-order pushes are ignored and old entries trimmed", () => {
  const b = new InterpBuffer();
  b.push(100, at(10));
  b.push(50, at(99));
  assert.equal(b.sample(0)!.pos.x, 10);
  for (let i = 1; i <= 100; i++) b.push(100 + i * 33, at(i));
  assert.equal(b.sample(0)!.pos.x, 100 - b.size() + 1);
  assert.ok(b.size() <= 32);
});

test("server clock tracks the lowest delay and relaxes 5 ms every 5 s", () => {
  const c = new ServerClock();
  c.observe(60, 2000);          // serverMs 1000 → offset 1000
  c.observe(120, 3050);         // serverMs 2000 → 1050, keeps 1000
  assert.equal(c.renderTime(3100), 3100 - 1000 - INTERP_DELAY_MS);
  c.observe(180, 3990);         // serverMs 3000 → 990
  assert.equal(c.renderTime(4000), 4000 - 990 - INTERP_DELAY_MS);
  c.observe(480, 10000);        // serverMs 8000 → 2000, 5 s after first: relaxed to 995
  assert.equal(c.renderTime(10000), 10000 - 995 - INTERP_DELAY_MS);
});

test("extrapolate: interpolates inside, carries the newest velocity past the end (capped)", () => {
  const b = new InterpBuffer();
  b.push(0, { pos: v3(0, 0, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 });
  b.push(33, { pos: v3(6.6, 0, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 });
  assert.ok(Math.abs(extrapolate(b, 16.5)!.pos.x - 3.3) < 1e-9);
  assert.ok(Math.abs(extrapolate(b, 133)!.pos.x - 26.6) < 1e-9, "100 ms past the newest snapshot");
  assert.ok(Math.abs(extrapolate(b, 5000)!.pos.x - 106.6) < 1e-9, "at most 500 ms ahead");
  assert.equal(extrapolate(new InterpBuffer(), 0), null);
});
