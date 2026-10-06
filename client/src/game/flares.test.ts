import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaneJSON } from "../net/protocol.ts";
import { flaresAt, flareViews } from "./flares.ts";

const plane = (id: number, p: [number, number, number], v: [number, number, number]) =>
  ({ id, k: "f16", tm: "nato", p, q: [1, 0, 0, 0], v, th: 1, hp: 100, a: true, ht: 0, oh: false, ms: 2, fl: 6 }) as PlaneJSON;

test("a new flare takes the velocity of the plane it left, then moves with the snapshots", () => {
  const planes = [plane(1, [0, 1000, 0], [0, 0, -200]), plane(2, [500, 1000, 0], [100, 0, 0])];
  const a = flareViews([], [{ id: 7, p: [0, 1000, 2] }], 1 / 30, planes);
  assert.deepEqual(a[0].v, { x: 0, y: 0, z: -200 });
  const b = flareViews(a, [{ id: 7, p: [0, 999, -4] }], 1 / 30, planes);
  assert.ok(Math.abs(b[0].v.z - -180) < 1e-9 && Math.abs(b[0].v.y - -30) < 1e-9);
  const [at] = flaresAt(b, 0.1);
  assert.ok(Math.abs(at.pos.z - -22) < 1e-9);
  assert.equal(flaresAt(b, 5)[0].pos.z, -4 + -180 * 0.25, "extrapolation is capped");
});

test("burnt-out flares leave the list; a lone flare starts still", () => {
  assert.deepEqual(flareViews([{ id: 1, p: { x: 0, y: 0, z: 0 }, v: { x: 1, y: 0, z: 0 } }], [], 1 / 30, []), []);
  assert.deepEqual(flareViews([], [{ id: 2, p: [0, 0, 0] }], 1 / 30, [])[0].v, { x: 0, y: 0, z: 0 });
});
