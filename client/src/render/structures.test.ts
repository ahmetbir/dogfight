import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { StructureViews, structLook } from "./structures.ts";
import type { StructInfo } from "../net/protocol.ts";
import type { V3 } from "../sim/vec.ts";

test("destroyed structures turn dark and smoke", () => {
  assert.equal(structLook("fuel", true).smoke, false);
  assert.equal(structLook("fuel", false).smoke, true);
  assert.notEqual(structLook("radar", true).color, structLook("radar", false).color);
});

test("views follow the hp map", () => {
  const scene = new THREE.Scene();
  const v = new StructureViews(scene, [{ id: 4194306, k: "fuel", tm: "nato", box: [0, 10, 0, 20, 24, 20], hp: 250 }]);
  const smoke: unknown[] = [];
  v.sync(new Map([[4194306, 0]]), 0, { smoke: (at) => smoke.push(at) });
  assert.equal(smoke.length, 1);
  v.sync(new Map([[4194306, 0]]), 100, { smoke: (at) => smoke.push(at) });
  assert.equal(smoke.length, 1, "smoke at most every 300 ms");
});

test("the radar dish turns only while intact; smoke repeats from the top until rebuilt", () => {
  const scene = new THREE.Scene();
  const radar = { id: 4194308, k: "radar" as const, tm: "soviet" as const, box: [0, 10, 0, 12, 28, 12] as StructInfo["box"], hp: 300 };
  const v = new StructureViews(scene, [radar]);
  const smoke: V3[] = [];
  const fx = { smoke: (at: V3) => void smoke.push(at) };
  v.sync(new Map(), 0, fx); // no snapshot yet: intact
  v.sync(new Map([[radar.id, 300]]), 1000, fx);
  assert.ok(Math.abs(v.dishAngle(radar.id)! - 0.6) < 1e-9);
  v.sync(new Map([[radar.id, 0]]), 2000, fx);
  v.sync(new Map([[radar.id, 0]]), 2300, fx);
  v.sync(new Map([[radar.id, 0]]), 2500, fx);
  assert.ok(Math.abs(v.dishAngle(radar.id)! - 0.6) < 1e-9, "dish stops");
  assert.deepEqual(smoke, [{ x: 6, y: 28, z: 6 }, { x: 6, y: 28, z: 6 }]);
  v.sync(new Map([[radar.id, 300]]), 3000, fx); // new round: intact again
  assert.equal(smoke.length, 2);
  assert.equal(v.dishAngle(4194306), null);
});

test("hangar stripes take the team color; destroyed hangars show the charred overlay", () => {
  assert.equal(structLook("hangar", true, "nato").color, "#3d6fd6");
  assert.equal(structLook("hangar", true, "soviet").color, "#c73b3b");
  assert.equal(structLook("aa", false).color, "#2a2724");
  const scene = new THREE.Scene();
  const id = 4194304;
  const v = new StructureViews(scene, [{ id, k: "hangar", tm: "nato", box: [-20, 0, 210, 20, 12, 240], hp: 400 }]);
  const g = scene.getObjectByName(`struct-${id}`)!;
  const hidden = () => g.children.filter((c) => !c.visible).length;
  assert.equal(hidden(), 1);
  v.sync(new Map([[id, 0]]), 0, { smoke: () => {} });
  assert.equal(hidden(), 0);
});
