import { test } from "node:test";
import assert from "node:assert/strict";
import { escapeAction } from "./keys.ts";

test("Esc: skips a replay before anything else opens, never right after a lock-loss menu", () => {
  const s = { sinceLockMenuMs: 10_000, blocked: false, replaying: false };
  assert.equal(escapeAction(s), "menu");
  assert.equal(escapeAction({ ...s, replaying: true }), "skip");
  assert.equal(escapeAction({ ...s, blocked: true }), "close");
  assert.equal(escapeAction({ ...s, blocked: true, replaying: true }), "close"); // a menu over the replay closes first
  assert.equal(escapeAction({ ...s, sinceLockMenuMs: 100, replaying: true }), "none"); // that Esc already opened the menu
});
