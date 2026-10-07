import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { ChaseCam, chaseBoom, chaseFov, firstHit } from "./camera.ts";
import { airframe } from "../game/airframe.ts";
import { qAxisAngle, qIdentity, v3 } from "../sim/vec.ts";

const near = (a: number, b: number, eps = 1e-6) => Math.abs(a - b) < eps;
const F16 = airframe("f16").length;

test("fov widens from 70 at 150 m/s to 85 at 300 m/s", () => {
  assert.equal(chaseFov(100), 70);
  assert.equal(chaseFov(225), 77.5);
  assert.equal(chaseFov(400), 85);
});

test("first update snaps behind and above; later updates approach with 1-exp(-6dt)", () => {
  const cam = new THREE.PerspectiveCamera();
  const cc = new ChaseCam(cam);
  cc.update(1 / 60, v3(0, 1000, 0), qIdentity(), 200, false, null, F16);
  assert.ok(near(cam.position.x, 0) && near(cam.position.y, 1007) && near(cam.position.z, 28));
  // Yaw the plane 90° left (nose toward -X): target offset becomes (+28, 7, 0).
  const rot = qAxisAngle(v3(0, 1, 0), Math.PI / 2);
  cc.update(0.1, v3(0, 1000, 0), rot, 200, false, null, F16);
  const k = 1 - Math.exp(-0.6);
  assert.ok(near(cam.position.x, 28 * k) && near(cam.position.z, 28 * (1 - k)), `${cam.position.toArray()}`);
  for (let i = 0; i < 120; i++) cc.update(1 / 60, v3(0, 1000, 0), rot, 200, false, null, F16);
  assert.ok(near(cam.position.x, 28, 1e-3) && near(cam.position.z, 0, 1e-3));
});

test("the offset is relative to the plane: no lag at constant velocity", () => {
  const cam = new THREE.PerspectiveCamera();
  const cc = new ChaseCam(cam);
  for (let i = 0; i < 60; i++) cc.update(1 / 60, v3(0, 1000, -250 * i / 60), qIdentity(), 250, false, null, F16);
  assert.ok(near(cam.position.z - -250 * 59 / 60, 28));
});

test("look back puts the camera in front, facing backward", () => {
  const cam = new THREE.PerspectiveCamera();
  const cc = new ChaseCam(cam);
  cc.update(1 / 60, v3(0, 0, 0), qIdentity(), 200, false, null, F16);
  cc.update(1 / 60, v3(0, 0, 0), qIdentity(), 200, true, null, F16);
  assert.ok(near(cam.position.z, -28) && near(cam.position.y, 7));
  const d = cam.getWorldDirection(new THREE.Vector3());
  assert.ok(d.z > 0.9, `${d.toArray()}`);
});

test("mouse aim keeps world up and looks along the aim", () => {
  const cam = new THREE.PerspectiveCamera();
  const cc = new ChaseCam(cam);
  const rolled = qAxisAngle(v3(0, 0, 1), 1.2);
  cc.update(1 / 60, v3(0, 0, 0), rolled, 200, false, v3(1, 0, 0), F16);
  assert.deepEqual(cam.up.toArray(), [0, 1, 0]);
  const d = cam.getWorldDirection(new THREE.Vector3());
  assert.ok(d.x > 0.95, `${d.toArray()}`);
});

test("a wall behind the plane pulls the camera in front of it", () => {
  const cam = new THREE.PerspectiveCamera();
  // Back wall 13 m behind (z 13..14) and a far building that is not in the way.
  const wall = [-20, -5, 13, 20, 12, 14];
  const away = [100, 0, 100, 120, 50, 120];
  const cc = new ChaseCam(cam, [wall, away]);
  cc.update(1 / 60, v3(0, 2.5, 0), qIdentity(), 0, false, null, F16);
  assert.ok(cam.position.z < 13 - 0.5 && cam.position.z > 5, `camera z ${cam.position.z}`);
  const cam2 = new THREE.PerspectiveCamera();
  new ChaseCam(cam2, [away]).update(1 / 60, v3(0, 2.5, 0), qIdentity(), 0, false, null, F16);
  assert.ok(near(cam2.position.z, 28), "nothing in the way: full boom");
});

test("the boom grows with the jet: a Su-27 sits on screen as an F-16 does", () => {
  assert.deepEqual(chaseBoom(F16), { back: 28, above: 7 });
  for (const kind of ["f15", "mig29", "su27"]) {
    const l = airframe(kind).length;
    const b = chaseBoom(l);
    assert.ok(l > F16 && b.back > 28, kind);
    // Same angular size: boom and length in the same ratio.
    assert.ok(near(b.back / l, 28 / F16) && near(b.above / l, 7 / F16), kind);
  }
  const cam = new THREE.PerspectiveCamera();
  new ChaseCam(cam).update(1 / 60, v3(0, 1000, 0), qIdentity(), 200, false, null, airframe("su27").length);
  assert.ok(near(cam.position.z, chaseBoom(airframe("su27").length).back), `${cam.position.z}`);
  assert.deepEqual(chaseBoom(0), { back: 28, above: 7 }, "no length: the F-16's boom");
});

test("firstHit ignores solids the segment starts in and misses parallel slabs", () => {
  assert.equal(firstHit(v3(0, 0, 0), v3(0, 0, 10), [[-1, -1, -1, 1, 1, 1]], 0), 1);
  assert.equal(firstHit(v3(0, 5, 0), v3(0, 0, 10), [[-1, -1, 4, 1, 1, 6]], 0), 1);
  assert.ok(Math.abs(firstHit(v3(0, 0, 0), v3(0, 0, 10), [[-1, -1, 4, 1, 1, 6]], 0) - 0.4) < 1e-12);
});
