// Air bases from welcome.map.bases (spec §4.3, §12.1): runway with markings,
// taxiways, apron, hangars and, at night, runway lights. Everything is
// instanced: a handful of draw calls for both bases.
import * as THREE from "three";
import type { BaseInfo } from "../net/protocol.ts";
import type { V3 } from "../sim/vec.ts";

// Mirrors internal/maps (HangarW, HangarD, HangarH; hangar floors v 210..240).
export const HANGAR_W = 40, HANGAR_D = 30, HANGAR_H = 12;
const HANGAR_V0 = 210;
const ARCH_H = 1; // m: curved roof over the 12 m hangar box (visual; hangarSolids covers it for the camera)
const RUNWAY_HALF_L = 900;
const LIGHT_V = 22;      // runway edge lights, m off the centerline
const LIGHT_STEP = 60;

/** World-space axis-aligned box: center and size. */
export type Part = { cx: number; cy: number; cz: number; sx: number; sy: number; sz: number };

/** Local (u along the runway, v inward) → world x, z. */
function world(b: BaseInfo, u: number, v: number): { x: number; z: number } {
  return { x: b.c[0] + b.axis[0] * u + b.inner[0] * v, z: b.c[2] + b.axis[1] * u + b.inner[1] * v };
}

/** The world box of a local rect u0..u1 × v0..v1 between heights y0 and y1. */
function part(b: BaseInfo, u0: number, u1: number, v0: number, v1: number, y0: number, y1: number): Part {
  const a = world(b, u0, v0);
  const c = world(b, u1, v1);
  return {
    cx: (a.x + c.x) / 2, cy: (y0 + y1) / 2, cz: (a.z + c.z) / 2,
    sx: Math.abs(c.x - a.x), sy: y1 - y0, sz: Math.abs(c.z - a.z),
  };
}

/** A hangar's position along the runway axis. */
function hangarU(b: BaseInfo, h: readonly number[]): number {
  return (h[0] - b.c[0]) * b.axis[0] + (h[2] - b.c[2]) * b.axis[1];
}

/** 4 boxes per hangar: roof, back wall, two side walls (mirrors maps.hangarBoxes). */
export function hangarParts(b: BaseInfo): Part[] {
  const y0 = b.c[1];
  const out: Part[] = [];
  for (const h of b.hangars) {
    const u = hangarU(b, h);
    const u0 = u - HANGAR_W / 2, u1 = u + HANGAR_W / 2;
    const v0 = HANGAR_V0, v1 = HANGAR_V0 + HANGAR_D;
    out.push(
      part(b, u0, u1, v0, v1, y0 + HANGAR_H - 1, y0 + HANGAR_H), // roof
      part(b, u0, u1, v1 - 1, v1, y0, y0 + HANGAR_H),           // back
      part(b, u0, u0 + 1, v0, v1, y0, y0 + HANGAR_H),           // side
      part(b, u1 - 1, u1, v0, v1, y0, y0 + HANGAR_H),           // side
    );
  }
  return out;
}

/**
 * Hangar boxes as [min x,y,z, max x,y,z] for the chase camera, roofs raised
 * to the top of the visual arch.
 */
export function hangarSolids(b: BaseInfo): number[][] {
  return hangarParts(b).map((p, i) => [
    p.cx - p.sx / 2, p.cy - p.sy / 2, p.cz - p.sz / 2,
    p.cx + p.sx / 2, p.cy + p.sy / 2 + (i % 4 === 0 ? ARCH_H : 0), p.cz + p.sz / 2,
  ]);
}

/** Edge lights on both runway edges every 60 m, end to end (2 × 31). */
export function runwayLights(b: BaseInfo): V3[] {
  const out: V3[] = [];
  for (let u = -RUNWAY_HALF_L; u <= RUNWAY_HALF_L; u += LIGHT_STEP) {
    for (const v of [-LIGHT_V, LIGHT_V]) {
      const p = world(b, u, v);
      out.push({ x: p.x, y: b.c[1] + 0.5, z: p.z });
    }
  }
  return out;
}

const MARK_Y0 = 0.15, MARK_Y1 = 0.2; // paint sits just on the runway surface

/** 30 dashes of 30 × 1 m every 60 m on the centerline. */
export function centerDashes(b: BaseInfo): Part[] {
  const y = b.c[1];
  const out: Part[] = [];
  for (let k = 0; k < 30; k++) {
    const u = -870 + 60 * k;
    out.push(part(b, u - 15, u + 15, -0.5, 0.5, y + MARK_Y0, y + MARK_Y1));
  }
  return out;
}

/** 8 threshold bars (30 × 1.8 m, four each side of the centerline) at both runway ends. */
export function thresholdBars(b: BaseInfo): Part[] {
  const y = b.c[1];
  const out: Part[] = [];
  for (const end of [-1, 1]) {
    const u0 = end * (RUNWAY_HALF_L - 6), u1 = end * (RUNWAY_HALF_L - 36);
    for (let k = 0; k < 4; k++) {
      for (const side of [-1, 1]) {
        const v = side * (2.7 + 3.6 * k);
        out.push(part(b, Math.min(u0, u1), Math.max(u0, u1), v - 0.9, v + 0.9, y + MARK_Y0, y + MARK_Y1));
      }
    }
  }
  return out;
}

/** Runway edge stripes and yellow taxiway centerlines (spec §4.3 layout). */
function sideMarks(b: BaseInfo): { white: Part[]; yellow: Part[] } {
  const y0 = b.c[1] + MARK_Y0, y1 = b.c[1] + MARK_Y1;
  return {
    white: [-1, 1].map((s) => part(b, -RUNWAY_HALF_L + 2, RUNWAY_HALF_L - 2, s * 21 - 0.45, s * 21 + 0.45, y0, y1)),
    yellow: [
      part(b, -700, 700, 119.7, 120.3, y0 - 0.05, y1 - 0.05), // parallel taxiway
      part(b, -700.3, -699.7, 22.5, 120, y0 - 0.05, y1 - 0.05), // connectors
      part(b, 699.7, 700.3, 22.5, 120, y0 - 0.05, y1 - 0.05),
    ],
  };
}

/** One InstancedMesh of geo with an instance per part (scaled unit geometry). */
function instanced(geo: THREE.BufferGeometry, mat: THREE.Material, parts: Part[], colors?: string[]): THREE.InstancedMesh {
  const mesh = new THREE.InstancedMesh(geo, mat, parts.length);
  const c = new THREE.Color();
  const m = new THREE.Matrix4();
  const q = new THREE.Quaternion();
  const pos = new THREE.Vector3();
  const size = new THREE.Vector3();
  parts.forEach((p, i) => {
    mesh.setMatrixAt(i, m.compose(pos.set(p.cx, p.cy, p.cz), q, size.set(p.sx, p.sy, p.sz)));
    if (colors) mesh.setColorAt(i, c.set(colors[i]));
  });
  mesh.instanceMatrix.needsUpdate = true;
  mesh.computeBoundingSphere();
  mesh.computeBoundingBox();
  return mesh;
}

/** Flat pavement: one instance per area, offset toward the camera so it never fights the terrain. */
function pavement(areas: Part[], color: string, offset: number): THREE.InstancedMesh {
  const mat = new THREE.MeshLambertMaterial({ color, polygonOffset: true, polygonOffsetFactor: -offset, polygonOffsetUnits: -offset });
  return instanced(new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2), mat, areas);
}

/** Runway (areas[0]) and taxi surfaces (areas[1..]) as flat parts at y. */
function surfaces(b: BaseInfo): { runway: Part[]; taxi: Part[] } {
  const flat = (a: number[], dy: number): Part => ({
    cx: (a[0] + a[2]) / 2, cy: b.c[1] + dy, cz: (a[1] + a[3]) / 2, sx: a[2] - a[0], sy: 1, sz: a[3] - a[1],
  });
  return { runway: [flat(b.areas[0], 0.15)], taxi: b.areas.slice(1).map((a) => flat(a, 0.1)) };
}

/** Runway lights: warm edge lights and green end lights, unlit and fog-free glow at range. */
function lights(bases: BaseInfo[]): THREE.InstancedMesh {
  const pts: V3[] = [];
  const colors: string[] = [];
  for (const b of bases) {
    for (const p of runwayLights(b)) {
      pts.push(p);
      colors.push("#ffd27a");
    }
    for (const end of [-1, 1]) {
      for (let v = -21; v <= 21; v += 6) {
        const p = world(b, end * (RUNWAY_HALF_L + 3), v);
        pts.push({ x: p.x, y: b.c[1] + 0.5, z: p.z });
        colors.push("#5dff7a");
      }
    }
  }
  const parts = pts.map((p) => ({ cx: p.x, cy: p.y, cz: p.z, sx: 1, sy: 1, sz: 1 }));
  const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false });
  const mesh = instanced(new THREE.IcosahedronGeometry(0.7, 0), mat, parts, colors);
  mesh.name = "runway-lights";
  // Far away the spheres are sub-pixel: a few pixels of glow keep the runway findable.
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(pts.flatMap((p) => [p.x, p.y, p.z]), 3));
  geo.setAttribute("color", new THREE.Float32BufferAttribute(colors.flatMap((s) => new THREE.Color(s).toArray()), 3));
  const glow = new THREE.Points(geo, new THREE.PointsMaterial({
    size: 3, sizeAttenuation: false, vertexColors: true, toneMapped: false, transparent: true, opacity: 0.9, depthWrite: false,
  }));
  glow.name = "runway-glow";
  glow.frustumCulled = false;
  mesh.add(glow); // the mesh itself sits at the origin: glow positions stay world positions
  return mesh;
}

/**
 * Curved hangar roofs (half cylinders along v, closed above the door) on top
 * of the boxes: one mesh per runway orientation, as instances scale but do
 * not rotate.
 */
function hangarRoofs(bases: BaseInfo[], color: string): THREE.InstancedMesh[] {
  const out: THREE.InstancedMesh[] = [];
  for (const alongX of [false, true]) {
    const parts: Part[] = [];
    for (const b of bases) {
      if ((Math.abs(b.inner[0]) > 0.5) !== alongX) continue;
      for (const h of b.hangars) {
        const u = hangarU(b, h);
        const p = part(b, u - HANGAR_W / 2, u + HANGAR_W / 2, HANGAR_V0, HANGAR_V0 + HANGAR_D, 0, ARCH_H);
        parts.push({ ...p, cy: b.c[1] + HANGAR_H }); // unit arch spans y 0..1 from its base
      }
    }
    if (parts.length === 0) continue;
    // Half of a unit cylinder, y 0..1, axis along Z (or X).
    const geo = new THREE.CylinderGeometry(0.5, 0.5, 1, 12, 1, false, -Math.PI / 2, Math.PI).rotateX(-Math.PI / 2).scale(1, 2, 1);
    if (alongX) geo.rotateY(Math.PI / 2);
    out.push(instanced(geo, new THREE.MeshLambertMaterial({ color, flatShading: true }), parts));
  }
  return out;
}

/** The scene group for all bases; night adds the runway lights. */
export function buildBases(bases: BaseInfo[], night: boolean): THREE.Group {
  const g = new THREE.Group();
  g.name = "bases";
  if (bases.length === 0) return g;
  const runway: Part[] = [], taxi: Part[] = [], white: Part[] = [], yellow: Part[] = [], hangars: Part[] = [];
  const hangarColors: string[] = [];
  for (const b of bases) {
    const s = surfaces(b);
    runway.push(...s.runway);
    taxi.push(...s.taxi);
    const side = sideMarks(b);
    white.push(...centerDashes(b), ...thresholdBars(b), ...side.white);
    yellow.push(...side.yellow);
    hangarParts(b).forEach((p, i) => {
      hangars.push(p);
      hangarColors.push(i % 4 === 0 ? "#7d858c" : "#9aa0a6"); // roof matches the arch
    });
  }
  g.add(pavement(taxi, "#7c8086", 1), pavement(runway, "#46494d", 2));
  const marks = [...white, ...yellow];
  const paint = new THREE.MeshLambertMaterial({ color: 0xffffff, polygonOffset: true, polygonOffsetFactor: -3, polygonOffsetUnits: -3 });
  const paintMesh = instanced(new THREE.BoxGeometry(1, 1, 1), paint, marks,
    marks.map((_, i) => (i < white.length ? "#e8e8e8" : "#d9b03c")));
  paintMesh.name = "markings";
  const hangarMesh = instanced(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshLambertMaterial({ color: 0xffffff, flatShading: true }),
    hangars, hangarColors);
  hangarMesh.name = "hangars";
  g.add(paintMesh, hangarMesh, ...hangarRoofs(bases, "#7d858c"));
  if (night) g.add(lights(bases));
  return g;
}
