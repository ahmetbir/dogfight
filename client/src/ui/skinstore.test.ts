import { test } from "node:test";
import assert from "node:assert/strict";
import { SkinChoices } from "./skinstore.ts";

function memory(init: Record<string, string> = {}) {
  const m = new Map(Object.entries(init));
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => { m.set(k, v); }, m };
}

test("skin choices: stored per jet under dogfight.skins, defaults for the rest", () => {
  const s = memory();
  const c = new SkinChoices(s);
  assert.equal(c.get("f16"), "standard");
  assert.equal(c.get("su27"), "flanker", "the jet's default");
  assert.equal(c.set("f16", "desert"), "desert");
  assert.equal(c.set("su27", "night"), "night");
  assert.deepEqual(JSON.parse(s.m.get("dogfight.skins")!), { f16: "desert", su27: "night" });
  const again = new SkinChoices(s);
  assert.equal(again.get("f16"), "desert");
  assert.deepEqual(again.all(["f16", "su27", "mig29"]), { f16: "desert", su27: "night", mig29: "standard" });
});

test("skin choices: bad stored data and ids another jet owns fall back", () => {
  for (const raw of ["not json", "[1,2]", "null", '{"f16":5}']) {
    assert.equal(new SkinChoices(memory({ "dogfight.skins": raw })).get("f16"), "standard", raw);
  }
  const c = new SkinChoices(memory({ "dogfight.skins": '{"f16":"flanker","f14":"blackband","f15":"gold"}' }));
  assert.equal(c.get("f16"), "standard");
  assert.equal(c.get("f14"), "blackband");
  assert.equal(c.get("f15"), "airsup", "an unknown id: the jet's default");
  assert.equal(c.set("f16", "blackband"), "standard");
});

test("skin choices survive a store that throws", () => {
  const bad = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  const c = new SkinChoices(bad);
  assert.equal(c.set("f16", "winter"), "winter");
  assert.equal(c.get("f16"), "winter", "kept for the page");
});
