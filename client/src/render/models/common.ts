// Shared parts for the procedural aircraft: palette, primitive parts and the
// engine flame. Models are built nose toward -Z, right wing +X, up +Y.
import * as THREE from "three";
import { mergeGeometries } from "three/examples/jsm/utils/BufferGeometryUtils.js";

export type Team = "nato" | "soviet" | "none";

export type Palette = { body: THREE.Material; stripe: THREE.Material; canopy: THREE.Material; dark: THREE.Material };

// A little self-light keeps the side away from the sun readable.
const flat = (color: string) =>
  new THREE.MeshLambertMaterial({ color, flatShading: true, emissive: color, emissiveIntensity: 0.18 });

/** Role colors of a team; own marks the local player's plane in FFA. */
export function teamColors(team: Team, own: boolean): { body: string; secondary: string; stripe: string } {
  const [body, secondary, stripe] =
    team === "nato" ? ["#9aa3ad", "#7d8792", "#3b6fd8"]
    : team === "soviet" ? ["#a8b8c0", "#8a9aa3", "#d83b3b"]
    : own ? ["#e8b33a", "#b88a2a", "#3a3328"]
    : ["#9aa3ad", "#7d8792", "#d83b3b"];
  return { body, secondary, stripe };
}

/** Team colors; own marks the local player's plane in FFA. */
export function palette(team: Team, own: boolean): Palette {
  const { body, stripe } = teamColors(team, own);
  return {
    body: flat(body),
    stripe: flat(stripe),
    canopy: new THREE.MeshLambertMaterial({ color: "#1c2f55", transparent: true, opacity: 0.75, flatShading: true }),
    dark: flat("#2d3034"),
  };
}

/** Collects parts as meshes; merge() returns one mesh per material. */
export class Parts {
  private readonly items: { geo: THREE.BufferGeometry; mat: THREE.Material }[] = [];

  add(geo: THREE.BufferGeometry, mat: THREE.Material, x = 0, y = 0, z = 0): this {
    geo.translate(x, y, z);
    this.items.push({ geo, mat });
    return this;
  }

  /** Adds geo and its mirror image across the X = 0 plane. */
  mirror(geo: THREE.BufferGeometry, mat: THREE.Material): this {
    const m = geo.clone().scale(-1, 1, 1);
    flipWinding(m);
    return this.add(geo, mat).add(m, mat);
  }

  merge(): THREE.Group {
    const g = new THREE.Group();
    const byMat = new Map<THREE.Material, THREE.BufferGeometry[]>();
    for (const { geo, mat } of this.items) {
      const plain = geo.index ? geo.toNonIndexed() : geo;
      for (const k of Object.keys(plain.attributes)) if (k !== "position") plain.deleteAttribute(k);
      byMat.set(mat, [...(byMat.get(mat) ?? []), plain]);
    }
    for (const [mat, geos] of byMat) {
      const merged = mergeGeometries(geos);
      merged.computeVertexNormals();
      g.add(new THREE.Mesh(merged, mat));
    }
    return g;
  }
}

function flipWinding(geo: THREE.BufferGeometry): void {
  if (geo.index) {
    const a = geo.index.array;
    for (let i = 0; i < a.length; i += 3) [a[i + 1], a[i + 2]] = [a[i + 2], a[i + 1]];
    geo.index.needsUpdate = true;
    return;
  }
  const p = geo.attributes.position;
  for (let i = 0; i < p.count; i += 3) {
    const x = p.getX(i + 1), y = p.getY(i + 1), z = p.getZ(i + 1);
    p.setXYZ(i + 1, p.getX(i + 2), p.getY(i + 2), p.getZ(i + 2));
    p.setXYZ(i + 2, x, y, z);
  }
}

/** Box w (X) × h (Y) × l (Z). */
export const box = (w: number, h: number, l: number) => new THREE.BoxGeometry(w, h, l);

/** Cylinder along Z: r0 at the front (-Z), r1 at the back. */
export function tube(r0: number, r1: number, l: number, seg = 8): THREE.BufferGeometry {
  return new THREE.CylinderGeometry(r0, r1, l, seg).rotateX(-Math.PI / 2);
}

/** Cone along Z with its tip at -l/2 (pointing forward). */
export function nose(r: number, l: number, seg = 8): THREE.BufferGeometry {
  return new THREE.ConeGeometry(r, l, seg).rotateX(-Math.PI / 2);
}

/** Half-ellipsoid bubble canopy, rx × ry × rz. */
export function bubble(rx: number, ry: number, rz: number): THREE.BufferGeometry {
  return new THREE.SphereGeometry(1, 8, 4, 0, Math.PI * 2, 0, Math.PI / 2).scale(rx, ry, rz);
}

/**
 * Flat slab with a convex planform in the XZ plane (points [x, z] in order),
 * t thick: wings, stabilizers, LERX. 4 corners → 12 triangles.
 */
export function slab(pts: [number, number][], t: number): THREE.BufferGeometry {
  const pos: number[] = [];
  const tri = (a: number[], b: number[], c: number[]) => pos.push(...a, ...b, ...c);
  const top = pts.map(([x, z]) => [x, t / 2, z]);
  const bot = pts.map(([x, z]) => [x, -t / 2, z]);
  // Orient so the top faces +Y whatever the input order.
  let area = 0;
  for (let i = 0; i < pts.length; i++) {
    const [x0, z0] = pts[i], [x1, z1] = pts[(i + 1) % pts.length];
    area += x0 * z1 - x1 * z0;
  }
  const ccw = area < 0; // counter-clockwise seen from +Y
  for (let i = 1; i < pts.length - 1; i++) {
    if (ccw) {
      tri(top[0], top[i], top[i + 1]);
      tri(bot[0], bot[i + 1], bot[i]);
    } else {
      tri(top[0], top[i + 1], top[i]);
      tri(bot[0], bot[i], bot[i + 1]);
    }
  }
  for (let i = 0; i < pts.length; i++) {
    const j = (i + 1) % pts.length;
    if (ccw) {
      tri(bot[i], top[j], top[i]);
      tri(bot[i], bot[j], top[j]);
    } else {
      tri(bot[i], top[i], top[j]);
      tri(bot[i], top[j], bot[j]);
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  return geo;
}

/**
 * Vertical fin: planform points [y, z] (y up from the root), t thick, leaning
 * outward by cant radians (positive tilts the tip toward +X).
 */
export function fin(pts: [number, number][], t: number, cant = 0): THREE.BufferGeometry {
  // Build in XZ with x = height, then stand it up: +X → +Y.
  return slab(pts, t).rotateZ(Math.PI / 2 - cant);
}

/**
 * Engine exhaust at (x, y, z) (nozzle exit) with radius r: an afterburner
 * flame cone named "ab" and a small red glow named "idle".
 */
export function engine(x: number, y: number, z: number, r: number): THREE.Group {
  const g = new THREE.Group();
  g.position.set(x, y, z);
  // The outer flame blends normally so it stays orange against a bright sky.
  const add = (geo: THREE.BufferGeometry, color: string, opacity: number, additive = true) =>
    new THREE.Mesh(geo, new THREE.MeshBasicMaterial({
      color, transparent: true, opacity, depthWrite: false, fog: false, toneMapped: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    }));
  const ab = new THREE.Group();
  ab.name = "ab";
  const outer = add(new THREE.ConeGeometry(r * 0.95, r * 7, 8).rotateX(Math.PI / 2).translate(0, 0, r * 3.5), "#ff7a1a", 0.8, false);
  // The blue core blends normally and draws after the orange cone, so it shows
  // through it instead of vanishing additively into the orange.
  const inner = add(new THREE.ConeGeometry(r * 0.6, r * 3.5, 8).rotateX(Math.PI / 2).translate(0, 0, r * 1.75), "#5f9dff", 0.95, false);
  inner.renderOrder = outer.renderOrder + 1;
  ab.add(outer, inner);
  const idle = add(new THREE.CircleGeometry(r * 0.7, 8), "#ff3a1a", 0.9);
  idle.name = "idle";
  idle.position.z = 0.02;
  g.add(ab, idle);
  return g;
}

export type Model = { body: THREE.Group; engines: THREE.Group[] };
