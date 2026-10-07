// Where things sit on an airframe, read off its geometry: the nose, the tail,
// the top (name tag), the wingtips (vapour trails). Works the same on a .glb
// and on a procedural model, so effects follow whichever jet is drawn.
import * as THREE from "three";

/** Measured in the model's parent frame (the plane's: nose −Z, right +X, up +Y), metres. */
export type Shape = {
  nose: number;  // distance of the nose ahead of the origin
  tail: number;  // distance of the tail behind it
  top: number;   // highest point above the origin
  tip: THREE.Vector3; // right wingtip at its trailing edge (the left one mirrors x)
};

const TIP_BAND = 0.3; // m: vertices this close to the widest x count as the tip

/** Engine flames hang off the airframe; they are not part of its shape. */
const skip = (o: THREE.Object3D) => o.name === "ab" || o.name === "idle";

/**
 * Measures every mesh under root (its own transform included), leaving out
 * the engine flames. An empty model measures as zero.
 */
export function measure(root: THREE.Object3D): Shape {
  root.updateMatrixWorld(true);
  const toParent = root.parent ? root.parent.matrixWorld.clone().invert() : new THREE.Matrix4();
  const m = new THREE.Matrix4();
  const v = new THREE.Vector3();
  const pts: THREE.Vector3[] = [];
  const walk = (o: THREE.Object3D) => {
    if (skip(o)) return;
    if (o instanceof THREE.Mesh) {
      const pos = (o.geometry as THREE.BufferGeometry).getAttribute("position");
      if (pos) {
        m.multiplyMatrices(toParent, o.matrixWorld);
        for (let i = 0; i < pos.count; i++) pts.push(v.fromBufferAttribute(pos, i).applyMatrix4(m).clone());
      }
    }
    for (const c of o.children) walk(c);
  };
  walk(root);
  if (pts.length === 0) return { nose: 0, tail: 0, top: 0, tip: new THREE.Vector3() };
  let minZ = Infinity, maxZ = -Infinity, maxY = -Infinity, half = 0;
  for (const p of pts) {
    minZ = Math.min(minZ, p.z);
    maxZ = Math.max(maxZ, p.z);
    maxY = Math.max(maxY, p.y);
    half = Math.max(half, Math.abs(p.x));
  }
  // The tip's trailing edge: the aft-most point of the widest band.
  const tip = new THREE.Vector3(half, 0, -Infinity);
  for (const p of pts) {
    if (Math.abs(p.x) >= half - TIP_BAND && p.z > tip.z) tip.set(half, p.y, p.z);
  }
  return { nose: -minZ, tail: maxZ, top: maxY, tip };
}
