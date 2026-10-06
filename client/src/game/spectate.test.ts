import { test } from "node:test";
import assert from "node:assert/strict";
import { camMode, nextTarget, watchingLabel } from "./spectate.ts";

test("spectate cycling wraps over live planes", () => {
  assert.equal(nextTarget([3, 5, 9], null, 1), 3);
  assert.equal(nextTarget([3, 5, 9], 9, 1), 3);
  assert.equal(nextTarget([3, 5, 9], 3, -1), 9);
  assert.equal(nextTarget([], 3, 1), null);
});

test("camera mode", () => {
  const base = { alive: false, dead: false, killer: 0, deathAt: null, spectate: null, aliveIds: [4, 6] };
  assert.deepEqual(camMode({ ...base, alive: true }), { kind: "own" });
  assert.deepEqual(camMode({ ...base, dead: true, killer: 6 }), { kind: "follow", id: 6 });
  assert.deepEqual(camMode({ ...base, dead: true, killer: 2, deathAt: { x: 1, y: 2, z: 3 } }), { kind: "orbit", at: { x: 1, y: 2, z: 3 } });
  assert.deepEqual(camMode({ ...base }), { kind: "follow", id: 4 });
  assert.deepEqual(camMode({ ...base, spectate: 6 }), { kind: "follow", id: 6 });
  assert.deepEqual(camMode({ ...base, aliveIds: [] }), { kind: "overview" });
  assert.equal(watchingLabel("Viper"), "İzliyorsun: Viper");
});
