import { test } from "node:test";
import assert from "node:assert/strict";
import { BLACK_G, G_CLEAR, gStep, RED_G, type GState } from "./gfx.ts";

const run = (s: GState, g: number, seconds: number) => {
  for (let t = 0; t < seconds * 60; t++) s = gStep(s, g, 1 / 60);
  return s;
};

test("thresholds sit at the top of the FB-A model's sustained turns and strong pushes", () => {
  assert.equal(BLACK_G, 15);
  assert.equal(RED_G, -8);
});

test("blackout: only after 1.5 s above BLACK_G, then darker, then fades", () => {
  assert.equal(run(G_CLEAR, 13, 10).black, 0, "a typical sustained turn (p50 13 G) never blacks out");
  assert.equal(run(G_CLEAR, BLACK_G + 2, 1.4).black, 0, "short pull: nothing");
  const dark = run(G_CLEAR, BLACK_G + 2, 4);
  assert.ok(dark.black > 0.4, `${dark.black}`);
  assert.ok(run(dark, BLACK_G + 2, 3).black > dark.black, "keeps darkening");
  assert.ok(run(dark, 1, 3).black === 0, "fades back to clear");
});

test("strong negative G tints red and fades", () => {
  assert.equal(run(G_CLEAR, -5, 3).red, 0, "a light push stays clear");
  const red = run(G_CLEAR, RED_G - 1, 1);
  assert.ok(red.red > 0.2, `${red.red}`);
  assert.equal(red.black, 0);
  assert.equal(run(red, 1, 2).red, 0);
});
