// Chase camera: follows the plane from behind with a smoothed offset.
import * as THREE from "three";
import { airframe } from "../game/airframe.ts";
import { add, qForward, qRotate, scale, type Q, type V3 } from "../sim/vec.ts";

const BACK = 28;      // m behind an F-16 (the boom scales with the jet's length)
const ABOVE = 7;      // m above it
const REF_LENGTH = airframe("f16").length;
const RATE = 6;       // 1/s, approach factor 1 - exp(-dt*RATE)
const AIM_LOOK = 200; // m along the aim (mouse scheme)
const FWD_LOOK = 100; // m along the nose (keyboard scheme)
const WORLD_UP = new THREE.Vector3(0, 1, 0);
const WALL_PAD = 0.8;  // m: the camera stops this far in front of a solid

/** Axis-aligned box [minX, minY, minZ, maxX, maxY, maxZ] the camera must not see through (hangars, buildings). */
export type Solid = readonly number[];

/**
 * Fraction t ∈ [0, 1] of the segment from + t·d where it first enters a
 * solid grown by pad; 1 when it enters none. Solids around from are ignored.
 */
export function firstHit(from: V3, d: V3, solids: readonly Solid[], pad: number): number {
  let best = 1;
  const o = [from.x, from.y, from.z], v = [d.x, d.y, d.z];
  for (const b of solids) {
    let t0 = 0, t1 = best, inside = true;
    for (let a = 0; a < 3 && t0 <= t1; a++) {
      const lo = b[a] - pad, hi = b[a + 3] + pad;
      if (o[a] < lo || o[a] > hi) inside = false;
      if (Math.abs(v[a]) < 1e-12) {
        if (o[a] < lo || o[a] > hi) t1 = -1; // parallel and outside the slab
        continue;
      }
      let ta = (lo - o[a]) / v[a], tb = (hi - o[a]) / v[a];
      if (ta > tb) [ta, tb] = [tb, ta];
      t0 = Math.max(t0, ta);
      t1 = Math.min(t1, tb);
    }
    if (!inside && t0 <= t1) best = t0;
  }
  return best;
}

/** FOV in degrees: 70 up to 150 m/s, widening to 85 at 300 m/s. */
export function chaseFov(speed: number): number {
  return 70 + 15 * Math.max(0, Math.min(1, (speed - 150) / 150));
}

/** Boom behind and above a jet length m long: every jet fills the view as the F-16 does. */
export function chaseBoom(length: number): { back: number; above: number } {
  const k = length > 0 ? length / REF_LENGTH : 1;
  return { back: BACK * k, above: ABOVE * k };
}

/**
 * The offset from the plane (not the world position) is smoothed, so the
 * camera trails rotations but never falls behind at speed. Mouse aim keeps
 * the camera's up on world Y; the keyboard scheme rolls with the plane.
 */
export class ChaseCam {
  private readonly cam: THREE.PerspectiveCamera;
  private readonly offset = new THREE.Vector3();
  private readonly up = new THREE.Vector3(0, 1, 0);
  private readonly want = new THREE.Vector3();
  private fresh = true;
  private back = false;
  private readonly solids: readonly Solid[];

  /** solids: boxes the camera is pulled in front of, toward the plane. */
  constructor(cam: THREE.PerspectiveCamera, solids: readonly Solid[] = []) {
    this.cam = cam;
    this.solids = solids;
  }

  /** Snap to the target on the next update (spawn, teleport). */
  snap(): void {
    this.fresh = true;
  }

  /** length: the followed jet's, in metres (it sets the boom). */
  update(dtS: number, pos: V3, rot: Q, speed: number, lookBack: boolean, aimDir: V3 | null, length: number): void {
    const { back: BACK, above: ABOVE } = chaseBoom(length);
    const fwd = qForward(rot);
    const planeUp = qRotate(rot, { x: 0, y: 1, z: 0 });
    const up = aimDir ? WORLD_UP : this.want.set(planeUp.x, planeUp.y, planeUp.z);
    const dir = lookBack ? -1 : 1;
    const tx = -fwd.x * BACK * dir + up.x * ABOVE;
    const ty = -fwd.y * BACK * dir + up.y * ABOVE;
    const tz = -fwd.z * BACK * dir + up.z * ABOVE;
    const snap = this.fresh || lookBack !== this.back;
    const k = snap ? 1 : 1 - Math.exp(-dtS * RATE);
    this.offset.x += (tx - this.offset.x) * k;
    this.offset.y += (ty - this.offset.y) * k;
    this.offset.z += (tz - this.offset.z) * k;
    this.up.lerp(up, k).normalize();
    this.fresh = false;
    this.back = lookBack;

    // Never behind a wall: in a hangar the boom shortens to stay inside it.
    const t = this.solids.length > 0 ? firstHit(pos, this.offset, this.solids, WALL_PAD) : 1;
    this.cam.position.set(pos.x + this.offset.x * t, pos.y + this.offset.y * t, pos.z + this.offset.z * t);
    this.cam.up.copy(this.up);
    const look = lookBack
      ? add(pos, scale(fwd, -FWD_LOOK))
      : aimDir ? add(pos, scale(aimDir, AIM_LOOK)) : add(pos, scale(fwd, FWD_LOOK));
    this.cam.lookAt(look.x, look.y, look.z);
    const fov = chaseFov(speed);
    if (Math.abs(fov - this.cam.fov) > 0.01) {
      this.cam.fov = fov;
      this.cam.updateProjectionMatrix();
    }
  }
}
