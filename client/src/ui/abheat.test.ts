import { test } from "node:test";
import assert from "node:assert/strict";
import { abHeat } from "./abheat.ts";
import { toFlight } from "../game/state.ts";
import type { PlaneJSON } from "../net/protocol.ts";

const wire = (extra: Partial<PlaneJSON>): PlaneJSON => ({
  id: 1, k: "f16", tm: "nato", p: [0, 1000, 0], q: [1, 0, 0, 0], v: [0, 0, -200], th: 1, hp: 90, a: true,
  ht: 0, oh: false, ms: 4, fl: 10, ...extra,
});

test("AB heat bar from snapshot fixtures", () => {
  const cold = toFlight(wire({})); // abh omitted at 0 (omitempty)
  assert.deepEqual(abHeat(cold.abh, cold.abl), { pct: 0, locked: false, warm: false });
  const hot = toFlight(wire({ abh: 0.8 }));
  assert.deepEqual(abHeat(hot.abh, hot.abl), { pct: 80, locked: false, warm: true });
  const out = toFlight(wire({ abh: 0.62, abl: true })); // cooling, still locked out
  assert.deepEqual(abHeat(out.abh, out.abl), { pct: 62, locked: true, warm: false });
  assert.deepEqual(abHeat(undefined, undefined), { pct: 0, locked: false, warm: false }, "older server: no field");
  assert.equal(abHeat(1.7, true).pct, 100);
});
