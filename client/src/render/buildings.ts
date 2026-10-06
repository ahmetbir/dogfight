// City buildings from welcome.map.bld (sehir only): one InstancedMesh of
// unit boxes, a deterministic shade per building, flat shaded.
import * as THREE from "three";
import { hash } from "./terrain.ts";

const BASE_COLOR = "#b9b4aa";
// A few facade tints (concrete, sandstone, blue glass, white) so blocks read apart.
const TINTS = ["#b9b4aa", "#c4b294", "#98a4b0", "#d2cfc8"];

/** Brightness factor 0.75..1.0 of building i (same integer hash as the terrain). */
export function buildingShade(i: number): number {
  return 0.75 + 0.25 * hash(i);
}

/** Facade self-light: a lift by day, near dark at night so the city does not glow. */
export const cityEmissive = (night: boolean) => (night ? 0.02 : 0.12);

/** One instance per [minX, minY, minZ, maxX, maxY, maxZ] box; null when there are none. */
export function buildCity(bld: number[][], night = false): THREE.InstancedMesh | null {
  if (bld.length === 0) return null;
  const geo = new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0); // origin at the footprint
  const mat = new THREE.MeshLambertMaterial({ flatShading: true, emissive: BASE_COLOR, emissiveIntensity: cityEmissive(night) });
  const mesh = new THREE.InstancedMesh(geo, mat, bld.length);
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const p = new THREE.Vector3();
  const s = new THREE.Vector3();
  const tints = TINTS.map((t) => new THREE.Color(t));
  const c = new THREE.Color();
  bld.forEach((b, i) => {
    p.set((b[0] + b[3]) / 2, b[1], (b[2] + b[5]) / 2);
    s.set(b[3] - b[0], b[4] - b[1], b[5] - b[2]);
    mesh.setMatrixAt(i, m.compose(p, q, s));
    mesh.setColorAt(i, c.copy(tints[Math.floor(hash(i + 7919) * tints.length)]).multiplyScalar(buildingShade(i)));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.name = "city";
  return mesh;
}
