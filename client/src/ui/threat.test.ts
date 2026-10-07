import { test } from "node:test";
import assert from "node:assert/strict";
import type { MissileJSON, PlaneJSON } from "../net/protocol.ts";
import { v3 } from "../sim/vec.ts";
import { arrowAngle, beamTurn, clockOf, relBearing, threatSource } from "./threat.ts";

const me = v3(0, 1000, 0);
const north = v3(0, 0, -1); // my nose: −Z
const up = v3(0, 1, 0);
const deg = (d: number) => (d * Math.PI) / 180;
const near = (a: number, b: number) => Math.abs(a - b) < 1e-9;

test("clock positions around my heading", () => {
  const at = (x: number, z: number) => clockOf(relBearing(me, north, v3(x, 1000, z)));
  assert.equal(at(0, -500), 12);
  assert.equal(at(500, 0), 3);
  assert.equal(at(0, 500), 6);
  assert.equal(at(-500, 0), 9);
  assert.equal(at(-400, 400), 8); // behind left: 7:30 rounds to 8
  assert.equal(at(300, 520), 5);
  const east = v3(1, 0, 0); // heading east, a missile due south is on my right
  assert.equal(clockOf(relBearing(me, east, v3(0, 1000, 500))), 3);
});

test("the beam turn brings the missile to the nearer of 3 and 9 o'clock", () => {
  assert.equal(beamTurn(deg(180)), "right", "dead astern: always the same way");
  assert.equal(beamTurn(deg(-180)), "right");
  assert.equal(beamTurn(deg(-135)), "left");  // 7:30: turn left, it slides to 9
  assert.equal(beamTurn(deg(135)), "right");  // 4:30: turn right, it slides to 3
  assert.equal(beamTurn(deg(45)), "left");    // 1:30: turn left, it slides back to 3
  assert.equal(beamTurn(deg(-45)), "right");  // 10:30: turn right, it slides back to 9
  assert.equal(beamTurn(deg(80)), "hold");
  assert.equal(beamTurn(deg(-100)), "hold");
});

test("the arrow points at the threat in my body frame, straight behind is down", () => {
  assert.ok(near(arrowAngle(me, north, up, v3(500, 1000, 0)), Math.PI / 2), "right");
  assert.ok(near(arrowAngle(me, north, up, v3(0, 1500, 0)), 0), "above");
  assert.ok(near(arrowAngle(me, north, up, v3(-500, 1000, 0)), -Math.PI / 2), "left");
  assert.ok(near(arrowAngle(me, north, up, v3(0, 1000, 800)), Math.PI), "behind");
  assert.ok(near(arrowAngle(me, north, up, v3(10, 1000, 800)), Math.PI), "nearly behind");
});

test("the threat is the nearest missile tracking me, else a plane locked on me", () => {
  const m = (id: number, tg: number, z: number, mk = 0, bp?: number): MissileJSON => ({ id, tg, p: [0, 1000, z], v: [0, 0, 0], mk, bp });
  const plane = (id: number, lk: number, ld: boolean): PlaneJSON =>
    ({ id, p: [0, 1000, 900], a: true, lk, ld } as unknown as PlaneJSON);
  assert.deepEqual(threatSource(me, 1, [m(10, 2, 300), m(11, 1, 800), m(12, 1, 500, 1)], [])?.kind, "radar");
  assert.equal(threatSource(me, 1, [m(11, 1, 800), m(12, 1, 500, 1)], [], "ir")?.dist, 800);
  assert.equal(threatSource(me, 1, [m(12, 1, 500, 1, 0.4)], [], "radar")?.beam, 0.4, "the beam progress rides along");
  assert.equal(threatSource(me, 1, [m(12, 1, 500, 1)], [], "radar")?.beam, 0, "missing bp is 0");
  assert.equal(threatSource(me, 1, [], [plane(5, 1, true)])?.kind, "lock");
  assert.equal(threatSource(me, 1, [], [plane(5, 1, false)]), null, "a lock still building is no threat yet");
  assert.equal(threatSource(me, 1, [], [plane(5, 1, true)], "radar"), null, "a kind filter skips locks");
});
