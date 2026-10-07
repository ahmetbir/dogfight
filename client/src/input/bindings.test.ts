import { test } from "node:test";
import assert from "node:assert/strict";
import { KEYBOARD_KEYS, keyName, keyRows, keys, MOUSE_KEYS } from "./bindings.ts";
import { DEFAULT_SETTINGS, makeScheme, type Controls, type Frame } from "./schemes.ts";
import { qIdentity } from "../sim/vec.ts";

/** One frame of a fresh scheme with code held and pressed. */
function frameWith(scheme: "mouse" | "keyboard", code: string): Frame {
  const presses = new Set([code]);
  const c: Controls = {
    keys: new Set([code]), buttons: 0, consumeMouse: () => ({ dx: 0, dy: 0 }), takePress: (k) => presses.delete(k),
  };
  return makeScheme({ ...DEFAULT_SETTINGS, scheme }).frame(c, { rot: qIdentity(), th: 0.5, gear: false }, 0.5);
}

const effect: Record<string, (f: Frame) => boolean> = {
  throttleUp: (f) => f.stick.th > 0.5, throttleDown: (f) => f.stick.th < 0.5, ab: (f) => f.stick.ab,
  rollLeft: (f) => f.stick.r < 0, rollRight: (f) => f.stick.r > 0, pitchDown: (f) => f.stick.p < 0, pitchUp: (f) => f.stick.p > 0,
  yawLeft: (f) => f.stick.y < 0, yawRight: (f) => f.stick.y > 0, fire: (f) => f.fire, missile: (f) => f.missile,
  flare: (f) => f.flare, gear: (f) => f.stick.g === true, brake: (f) => f.stick.br === true, bomb: (f) => f.bomb,
  lookBack: (f) => f.lookBack, pick: (f) => f.pick === true,
};

test("every listed binding drives its action in the scheme", () => {
  for (const [scheme, table] of [["mouse", MOUSE_KEYS], ["keyboard", KEYBOARD_KEYS]] as const) {
    for (const [action, codes] of Object.entries(table)) {
      const check = effect[action];
      assert.ok(check, `${scheme}.${action} has no effect check`);
      for (const code of codes) assert.ok(check(frameWith(scheme, code)), `${scheme}.${action} via ${code}`);
    }
  }
});

test("key names and rows", () => {
  assert.equal(keyName("KeyW"), "W");
  assert.equal(keyName("Mouse2"), "Sağ tık");
  assert.equal(keys(MOUSE_KEYS.ab), "Shift");
  assert.equal(keys(MOUSE_KEYS.missile), "Sağ tık / E");
  const kb = keyRows("keyboard").map(([k]) => k);
  assert.ok(kb.includes("R / F") && kb.includes("W / S") && kb.includes("Q / E"));
  assert.ok(keyRows("keyboard").some(([k, what]) => k === "R" && what.includes("gaz")), "R names the throttle clash");
  assert.ok(!keyRows("mouse").some(([k, what]) => k === "R" && what.includes("gaz")));
});
