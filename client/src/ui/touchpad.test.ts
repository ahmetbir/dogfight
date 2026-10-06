import { test } from "node:test";
import assert from "node:assert/strict";
import { Pointers, replayButton } from "./touchpad.ts";

test("replay button: replay when ready, skip while playing, hidden otherwise", () => {
  assert.equal(replayButton(true, false), "replay");
  assert.equal(replayButton(false, true), "skip");
  assert.equal(replayButton(true, true), "skip");
  assert.equal(replayButton(false, false), null);
});

test("pointers: stick and fire held together, released independently", () => {
  const p = new Pointers();
  p.down(1, "stick");
  p.down(2, "fire");
  assert.ok(p.held("stick") && p.held("fire"));
  assert.equal(p.up(1), "stick");
  assert.ok(!p.held("stick") && p.held("fire"));
  p.down(3, "fire");
  assert.equal(p.up(2), "fire");
  assert.ok(p.held("fire"), "another finger still holds fire");
  assert.equal(p.up(9), undefined);
  p.clear();
  assert.ok(!p.held("fire"));
});
