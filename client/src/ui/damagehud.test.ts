import { test } from "node:test";
import assert from "node:assert/strict";

test("zone hits: my damaged part, my crit on someone; nothing for others", async () => {
  const { zoneNotice } = await import("./hud.ts");
  assert.equal(zoneNotice("engine", true, false), "MOTOR HASAR ALDI");
  assert.equal(zoneNotice("crit", true, false), null, "my own crit: the death text says it");
  assert.equal(zoneNotice("crit", false, true), "KRİTİK İSABET!");
  assert.equal(zoneNotice("engine", false, true), null);
  assert.equal(zoneNotice("controls", false, false), null);
  const { damageLevels } = await import("./hudtext.ts");
  assert.deepEqual(damageLevels({ engine: 1, controls: 0, avionics: 2 }), [1, 0, 2]);
});
