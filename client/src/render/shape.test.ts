import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import { airframe } from "../game/airframe.ts";
import { buildModel } from "./models.ts";
import { places } from "./planes.ts";
import { measure } from "./shape.ts";
import { contract, readGlb } from "./testglb.ts";

const KINDS = Object.keys(contract.kinds);
const near = (a: number, b: number, eps: number) => Math.abs(a - b) <= eps;

test("measure: nose, tail, top and the wingtip's trailing edge; flames left out", () => {
  const root = new THREE.Group();
  const body = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 10)); // z -5..5
  const wing = new THREE.Mesh(new THREE.BoxGeometry(8, 0.2, 2));
  wing.position.set(0, 0, 2); // tips at x ±4, trailing edge z 3
  const flame = new THREE.Group();
  flame.name = "ab";
  flame.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 30)));
  root.add(body, wing, flame);
  root.scale.setScalar(2);
  const s = measure(root);
  assert.deepEqual([s.nose, s.tail, s.top], [10, 10, 1]);
  assert.deepEqual(s.tip.toArray().map((v) => Math.round(v * 100) / 100), [8, 0.2, 6]);
});

// The sim's airframe numbers are the committed models' (sim.Spec via RULES).
for (const kind of KINDS) {
  const file = new URL(`../../static/models/${kind}.glb`, import.meta.url);
  test(`${kind}.glb measures as its airframe`, () => {
    const s = measure(readGlb(file));
    const a = airframe(kind);
    assert.ok(near(s.nose + s.tail, a.length, 0.01), `${kind}: length ${s.nose + s.tail}, sim ${a.length}`);
    assert.ok(near(2 * s.tip.x, a.span, 0.01), `${kind}: span ${2 * s.tip.x}, sim ${a.span}`);
    assert.ok(near(s.nose, a.nose, 0.01), `${kind}: nose ${s.nose}, sim ${a.nose}`);
    assert.ok(a.muzzle > s.nose, `${kind}: rounds leave ahead of the nose`);
    assert.ok(s.tip.z > 0 && s.tip.z < s.tail, `${kind}: tip trailing edge at z ${s.tip.z}, behind the wing`);
  });
}

test("the procedural fallback keeps each jet's true length and puts effects on it", () => {
  for (const kind of KINDS) {
    const g = buildModel(kind, "nato");
    const s = measure(g);
    assert.ok(near(s.nose + s.tail, airframe(kind).length, 1e-3), `${kind}: ${s.nose + s.tail}`);
    const at = places(g);
    assert.ok(at.tip.x > 4 && at.tip.z > 0, `${kind}: tip ${at.tip.toArray()}`);
    assert.ok(at.tagUp > s.top, `${kind}: tag above the fin`);
  }
});

test("name tags ride above each model's fin; the F-16's stays at v1's 9 m", () => {
  const tag = (kind: string) => places(readGlb(new URL(`../../static/models/${kind}.glb`, import.meta.url))).tagUp;
  assert.ok(near(tag("f16"), 9, 0.1), `f16 tag ${tag("f16")}`);
  for (const kind of KINDS) assert.ok(tag(kind) > 7, `${kind} tag ${tag(kind)}`);
});
