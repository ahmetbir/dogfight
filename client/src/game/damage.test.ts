import { test } from "node:test";
import assert from "node:assert/strict";
import { RULES } from "../book/rules.ts";
import type { Spec } from "../sim/flight.ts";
import { damagedSpec, unpackDamage } from "./damage.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };

test("the dm byte unpacks as sim.Damage.Pack packs it", () => {
  assert.deepEqual(unpackDamage(undefined), { engine: 0, controls: 0, avionics: 0 });
  assert.deepEqual(unpackDamage(2 | (1 << 2) | (2 << 4)), { engine: 2, controls: 1, avionics: 2 });
});

test("a damaged spec scales like sim.Damaged; intact is the same object", () => {
  assert.equal(damagedSpec(F16, unpackDamage(0)), F16);
  const s = damagedSpec(F16, { engine: 2, controls: 1, avionics: 2 });
  assert.equal(s.maxSpeed, 230 * RULES.dmgEngine2);
  assert.equal(s.maxSpeedAB, 290 * RULES.dmgEngine2);
  assert.equal(s.accel, 48 * RULES.dmgEngine2);
  assert.equal(s.rollRate, 4.2 * RULES.dmgControls1);
  assert.equal(s.pitchRate, 1.6 * RULES.dmgControls1);
  assert.equal(s.yawRate, 0.5 * RULES.dmgControls1);
  assert.equal(s.cornerSpeed, 170, "corner and rotate speeds stay");
  assert.equal(s.rotateSpeed, 78);
});
