import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../book/rules.ts";
import { airframe } from "./airframe.ts";

test("airframe: RULES numbers, muzzle ahead of the nose (sim.Spec.Muzzle), F-16 for an unknown kind", () => {
  const su = airframe("su27");
  assert.deepEqual(su, { length: RULES.su27Length, span: RULES.su27Span, nose: RULES.su27Nose, muzzle: RULES.su27Nose + RULES.muzzleLead });
  assert.ok(Math.abs(airframe("f16").muzzle - 8) < 0.05, "the F-16's rounds leave about where v1's did");
  assert.deepEqual(airframe("nope"), airframe("f16"));
  for (const k of ["f16", "f15", "mig29", "su27"]) assert.ok(airframe(k).length > 14 && airframe(k).span > 9, k);
});
