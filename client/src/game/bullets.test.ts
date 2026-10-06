import { test } from "node:test";
import assert from "node:assert/strict";
import { AA_LIFE_S, Bullets, BULLET_LIFE_S } from "./bullets.ts";
import type { V3 } from "../sim/vec.ts";

function fakeFx() {
  const calls: { from: V3; vel: V3; life: number; mine: boolean }[] = [];
  return { calls, tracer: (from: V3, vel: V3, life: number, mine: boolean) => void calls.push({ from, vel, life, mine }) };
}

test("own rounds are drawn on the next update with full life", () => {
  let rt = 0;
  const b = new Bullets(() => rt);
  const fx = fakeFx();
  b.spawn({ x: 1, y: 2, z: 3 }, { x: 0, y: 0, z: -900 }, 100, true);
  b.update(1 / 60, fx);
  assert.deepEqual(fx.calls, [{ from: { x: 1, y: 2, z: 3 }, vel: { x: 0, y: 0, z: -900 }, life: BULLET_LIFE_S, mine: true }]);
  b.update(1 / 60, fx);
  assert.equal(fx.calls.length, 1);
});

test("remote rounds wait until the interpolated render tick reaches them", () => {
  let rt = 98;
  const b = new Bullets(() => rt);
  const fx = fakeFx();
  b.spawn({ x: 0, y: 0, z: 0 }, { x: 600, y: 0, z: 0 }, 100, false);
  b.update(1 / 60, fx);
  assert.equal(fx.calls.length, 0);
  rt = 103; // 3 ticks late: advanced by 3/60 s
  b.update(1 / 60, fx);
  assert.equal(fx.calls.length, 1);
  assert.ok(Math.abs(fx.calls[0].from.x - 30) < 1e-9);
  assert.ok(Math.abs(fx.calls[0].life - (BULLET_LIFE_S - 0.05)) < 1e-9);
  assert.equal(fx.calls[0].mine, false);
});

test("expired rounds are skipped, reset clears the queue, the queue is bounded", () => {
  let rt = 0;
  const b = new Bullets(() => rt);
  const fx = fakeFx();
  b.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 0, false);
  rt = 200;
  b.update(0, fx);
  assert.equal(fx.calls.length, 0);
  rt = 0;
  for (let i = 0; i < 5000; i++) b.spawn({ x: 0, y: 0, z: 0 }, { x: 1, y: 0, z: 0 }, 10, false);
  assert.ok(b.queued() <= 512);
  b.reset();
  assert.equal(b.queued(), 0);
});

test("AA rounds are drawn orange for the AA shell life", () => {
  const calls: { mine: boolean; color?: string; life: number }[] = [];
  const fx = { tracer: (_f: V3, _v: V3, life: number, mine: boolean, color?: string) => void calls.push({ mine, color, life }) };
  const b = new Bullets(() => 100);
  b.spawn({ x: 0, y: 0, z: 0 }, { x: 450, y: 0, z: 0 }, 100, false, true);
  b.spawn({ x: 0, y: 0, z: 0 }, { x: 900, y: 0, z: 0 }, 100, false);
  b.update(1 / 60, fx);
  assert.deepEqual(calls, [{ mine: false, color: "#ff9a3c", life: AA_LIFE_S }, { mine: false, color: undefined, life: BULLET_LIFE_S }]);
});
