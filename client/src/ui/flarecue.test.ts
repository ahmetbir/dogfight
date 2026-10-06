import { test } from "node:test";
import assert from "node:assert/strict";
import { decoyNote, FLARE_COOLDOWN_TICKS, FLARE_CUE_M, flareCue } from "./flarecue.ts";

test("FLARE! only with a tracking missile inside 800 m and a flare ready", () => {
  assert.equal(flareCue(true, FLARE_CUE_M - 1, 3, 1000, -Infinity), true);
  assert.equal(flareCue(true, FLARE_CUE_M + 1, 3, 1000, -Infinity), false, "too far");
  assert.equal(flareCue(true, null, 3, 1000, -Infinity), false, "nothing tracking me");
  assert.equal(flareCue(true, 300, 0, 1000, -Infinity), false, "no flares left");
  assert.equal(flareCue(true, 300, 3, 1000, 1000 - FLARE_COOLDOWN_TICKS + 1), false, "cooling down");
  assert.equal(flareCue(true, 300, 3, 1000, 1000 - FLARE_COOLDOWN_TICKS), true, "ready again");
  assert.equal(flareCue(false, 300, 3, 1000, -Infinity), false, "dead");
});

test("decoy note: the toast for the target, the note for the shooter, nothing for others", () => {
  assert.deepEqual(decoyNote(true, false), { msg: "FÜZE ATLATILDI!", good: true });
  assert.deepEqual(decoyNote(false, true), { msg: "Füzen flare'e kandı", good: false });
  assert.equal(decoyNote(false, false), null);
});

test("cue numbers and key caps come from RULES and the bindings", async () => {
  const { RULES } = await import("../book/rules.ts");
  const { MOUSE_KEYS, KEYBOARD_KEYS, keyName } = await import("../input/bindings.ts");
  const { flareKey } = await import("./flarecue.ts");
  assert.equal(FLARE_CUE_M, RULES.flareWarn);
  assert.equal(FLARE_COOLDOWN_TICKS, RULES.flareCooldownS * 60);
  assert.equal(flareKey("mouse"), keyName(MOUSE_KEYS.flare[0]).toUpperCase());
  assert.equal(flareKey("keyboard"), keyName(KEYBOARD_KEYS.flare[0]).toUpperCase());
  assert.equal(flareKey("touch"), "");
});
