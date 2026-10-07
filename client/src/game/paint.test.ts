import { test } from "node:test";
import assert from "node:assert/strict";
import { paintOf } from "./view.ts";

test("paintOf: the picked jet wears skin, a jet still flying until the next spawn its own fskin", () => {
  const pl = { id: 1, name: "a", team: "nato" as const, kind: "f15" as const, bot: false, skin: "airsup", fskin: "blackband" };
  assert.equal(paintOf(pl, "f15"), "airsup");
  assert.equal(paintOf(pl, "f14"), "blackband");
  assert.equal(paintOf({ ...pl, fskin: undefined }, "f14"), "airsup", "same paint: fskin omitted");
  assert.equal(paintOf(undefined, "f14"), undefined);
});
