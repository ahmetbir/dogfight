import { test } from "node:test";
import assert from "node:assert/strict";
import { ChatMenu, chatText } from "./chat.ts";

test("chat menu: six presets; a choice sends once and closes", () => {
  const sent: number[] = [];
  const m = new ChatMenu((id) => sent.push(id));
  assert.deepEqual(m.options().map(([id]) => id), [1, 2, 3, 4, 5, 6]);
  assert.equal(m.options()[0][1], chatText(1));
  assert.equal(m.choose(2), false, "closed: nothing sent");
  m.toggle();
  assert.ok(m.isOpen());
  assert.equal(m.choose(7), false, "unknown preset");
  assert.equal(m.choose(0), false);
  assert.ok(m.isOpen());
  assert.equal(m.choose(3), true);
  assert.ok(!m.isOpen());
  assert.deepEqual(sent, [3]);
  m.toggle();
  m.toggle();
  assert.ok(!m.isOpen(), "SOHBET again closes it");
});
