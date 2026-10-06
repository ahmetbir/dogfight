import { test } from "node:test";
import assert from "node:assert/strict";
import { coachLine, groundHint, tookOff, type CoachView } from "./coach.ts";

test("ground hint names the brake, gear, throttle and rotate speed per scheme", () => {
  assert.equal(groundHint("mouse", false, 78), "B: Fren · L: Teker · W/Shift: Gaz · 281 km/h'de burnu kaldır (fare yukarı)");
  assert.equal(groundHint("keyboard", false, 78), "B: Fren · L: Teker · R/X: Gaz · 281 km/h'de burnu kaldır (S)");
  assert.match(groundHint("keyboard", true, 78), /\(W\)$/);
  assert.match(groundHint("mouse", true, 78), /\(fare aşağı\)$/);
});

test("takeoff coach: throttle, then nose up at rotate speed, then gear; done when the gear is up", () => {
  const at = (v: Partial<CoachView>): CoachView => ({ alive: true, onGround: true, speed: 0, gear: true, ...v });
  const seq = [at({}), at({ speed: 40 }), at({ speed: 76 }), at({ onGround: false, speed: 85 }), at({ onGround: false, speed: 120, gear: false })];
  assert.deepEqual(seq.map((v) => coachLine(v, 78, "mouse", false)),
    ["Gazı aç (W/Shift)", "Gazı aç (W/Shift)", "Burnu kaldır (fare yukarı)", "Tekeri topla (L)", ""]);
  assert.deepEqual(seq.map(tookOff), [false, false, false, false, true]);
  assert.equal(coachLine(at({ alive: false }), 78, "keyboard", false), "");
  assert.equal(coachLine(at({}), 78, "keyboard", false), "Gazı aç (R/X)");
});

test("touch: the hint and coach name the on-screen controls", () => {
  assert.equal(groundHint("touch", false, 78), "FREN basılı tut · TEKER aç/kapa · Soldaki GAZ'ı yukarı çek · 281 km/h'de burnu kaldır (çubuk yukarı)");
  const at = (v: Partial<CoachView>): CoachView => ({ alive: true, onGround: true, speed: 0, gear: true, ...v });
  assert.equal(coachLine(at({}), 78, "touch", false), "Gazı aç (GAZ)");
  assert.equal(coachLine(at({ speed: 77 }), 78, "touch", true), "Burnu kaldır (çubuk aşağı)");
  assert.equal(coachLine(at({ onGround: false, speed: 90 }), 78, "touch", false), "Tekeri topla (TEKER)");
});
