import { test } from "node:test";
import assert from "node:assert/strict";
import type * as THREE from "three";
import { buildCity, buildingShade, cityEmissive } from "./buildings.ts";

test("one instance per building, boxes match the wire extents", () => {
  const bld = [[0, 10, 0, 30, 60, 20], [100, 12, 100, 140, 40, 130]];
  const city = buildCity(bld)!;
  assert.equal(city.count, 2);
  city.computeBoundingBox();
  const bb = city.boundingBox!;
  assert.ok(Math.abs(bb.min.y - 10) < 1e-6 && Math.abs(bb.max.y - 60) < 1e-6 && Math.abs(bb.max.x - 140) < 1e-6);
  assert.equal(buildCity([]), null);
  for (let i = 0; i < 50; i++) assert.ok(buildingShade(i) >= 0.75 && buildingShade(i) <= 1);
});

test("city facades barely self-light at night", () => {
  const bld = [[0, 10, 0, 30, 60, 20]];
  const day = buildCity(bld)!.material as THREE.MeshLambertMaterial;
  const night = buildCity(bld, true)!.material as THREE.MeshLambertMaterial;
  assert.equal(day.emissiveIntensity, cityEmissive(false));
  assert.equal(night.emissiveIntensity, cityEmissive(true));
  assert.ok(night.emissiveIntensity < day.emissiveIntensity / 4);
});
