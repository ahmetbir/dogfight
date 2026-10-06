// Landing gear shared by every aircraft (spec §12.1): nose strut and wheel at
// z = -5, mains at x = ±1.6, z = +1; wheel bottoms at y = -2.5 (sim GearHeight).
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

const GEAR_HEIGHT = 2.5;  // m from the plane's origin to the ground when parked
const WHEEL_R = 0.35;
const STRUT_TOP = -0.05;  // just inside the airframe
const LEGS: [number, number][] = [[0, -5], [-1.6, 1], [1.6, 1]]; // x, z

/** Gear group named "gear" in model space (unscaled meters), one merged mesh. */
export function buildGear(): THREE.Group {
  const axle = -GEAR_HEIGHT + WHEEL_R;
  const strutL = STRUT_TOP - axle;
  const parts: THREE.BufferGeometry[] = [];
  for (const [x, z] of LEGS) {
    parts.push(new THREE.CylinderGeometry(0.12, 0.12, strutL, 6, 1, true).translate(x, axle + strutL / 2, z));
    // thetaStart π/2 puts a rim vertex straight down once the axis turns to X.
    parts.push(new THREE.CylinderGeometry(WHEEL_R, WHEEL_R, 0.25, 10, 1, false, Math.PI / 2)
      .rotateZ(Math.PI / 2).translate(x, axle, z));
  }
  const geo = mergeGeometries(parts.map((p) => p.toNonIndexed()));
  geo.deleteAttribute("uv");
  geo.computeVertexNormals();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ color: "#2b2b2b", flatShading: true }));
  const g = new THREE.Group();
  g.add(mesh);
  g.name = "gear";
  return g;
}
