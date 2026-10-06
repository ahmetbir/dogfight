import { test } from "node:test";
import assert from "node:assert/strict";
import { labelScale } from "./planes.ts";

test("name tags grow on short (phone) views, never shrink on desktops", () => {
  assert.equal(labelScale(800), 1);
  assert.equal(labelScale(600), 1);
  assert.ok(Math.abs(labelScale(390) - 600 / 390) < 1e-9); // landscape phone
  assert.equal(labelScale(200), 2);                        // capped
  assert.equal(labelScale(0), 1);                          // hidden canvas
});
