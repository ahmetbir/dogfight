// A loaded .glb airframe made ready for one plane: materials by role coloured
// for its team, flames at the engine markers, and a rig that moves the control
// surfaces and the landing gear. Node contract: tools/blender (spec Phase 3).
import * as THREE from "three";
import { engine, teamColors, type Team } from "./models/common.ts";

/** Stick, -1..1 each: p pull (nose up), r roll right, y yaw right. */
export type Controls = { p: number; r: number; y: number };

export const NEUTRAL: Controls = { p: 0, r: 0, y: 0 };

const AILERON = 0.35;  // rad at full roll
const FLAP = 0.4;      // rad down with the gear out
const FLAPERON = 0.5;  // share of roll the flaps also fly
const STAB = 0.3;      // rad at full pitch
const TAILERON = 0.4;  // share of roll on the stabilators
const RUDDER = 0.35;   // rad at full yaw

/**
 * Deflection in radians of a surface: + is trailing edge down (rudder: to the
 * right). side is the node's "_l"/"_r" suffix; flaps 0..1 lowers the flaps.
 */
export function deflection(role: string, side: string, c: Controls, flaps: number): number {
  const roll = side === "r" ? -c.r : side === "l" ? c.r : 0; // roll right: right trailing edge up
  switch (role) {
    case "aileron": return roll * AILERON;
    case "flap": return flaps * FLAP + roll * AILERON * FLAPERON;
    case "stab": return (-c.p + roll * TAILERON) * STAB;
    case "elevator": return -c.p * STAB;
    case "rudder": return c.y * RUDDER;
    default: return 0;
  }
}

/** Colour of each material role: team roles from the palette, the rest from the model. */
export function roleColor(role: string, team: Team, own: boolean): string | null {
  const c = teamColors(team, own);
  return role === "body" ? c.body : role === "secondary" ? c.secondary : role === "stripe" ? c.stripe : null;
}

type Hinge = { o: THREE.Object3D; base: THREE.Quaternion; axis: THREE.Vector3 };
const q = new THREE.Quaternion();

function hinge(o: THREE.Object3D, a: unknown): Hinge | null {
  if (!Array.isArray(a) || a.length < 3 || !a.slice(0, 3).every(Number.isFinite)) return null;
  const axis = new THREE.Vector3(a[0], a[1], a[2]);
  if (axis.lengthSq() < 1e-6) return null;
  return { o, base: o.quaternion.clone(), axis: axis.normalize() };
}

function turn(h: Hinge, angle: number): void {
  h.o.quaternion.copy(h.base).multiply(q.setFromAxisAngle(h.axis, angle));
}

/** The moving parts of a dressed .glb. */
export class Rig {
  private readonly surfaces: (Hinge & { role: string; side: string })[] = [];
  private readonly legs: (Hinge & { angle: number })[] = [];
  readonly gear: THREE.Object3D | null;

  constructor(root: THREE.Object3D) {
    this.gear = root.getObjectByName("gear") ?? null;
    root.traverse((o) => {
      const d = o.userData as { role?: unknown; axis?: unknown; retract?: unknown };
      if (typeof d.role === "string" && d.axis) {
        const h = hinge(o, d.axis);
        const side = /_([lr])$/.exec(o.name)?.[1] ?? "";
        if (h) this.surfaces.push({ ...h, role: d.role, side });
      }
      if (Array.isArray(d.retract) && d.retract.length === 4 && Number.isFinite(d.retract[3])) {
        const h = hinge(o, d.retract);
        if (h) this.legs.push({ ...h, angle: d.retract[3] as number });
      }
    });
  }

  /** Surfaces from c; gear 0 retracted .. 1 down (flaps follow it). */
  pose(c: Controls, gear: number): void {
    for (const s of this.surfaces) turn(s, deflection(s.role, s.side, c, gear));
    for (const l of this.legs) turn(l, l.angle * (1 - gear));
    if (this.gear) this.gear.visible = gear > 0.01;
  }
}

export type Dressed = {
  body: THREE.Object3D; rig: Rig; ab: THREE.Object3D[]; idle: THREE.Object3D[];
  engines: THREE.Object3D[];      // flames added here: the plane's own
  materials: THREE.Material[];    // the plane's own (their maps are shared)
};

/**
 * Clones the loaded scene for one plane. Geometry and textures stay shared;
 * the returned materials are the plane's own (dispose them, not their maps).
 */
export function dressGlb(src: THREE.Object3D, team: Team, own: boolean): Dressed {
  const body = src.clone(true);
  const made = new Map<THREE.Material, THREE.Material>();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material) => {
      let n = made.get(m);
      if (!n) {
        n = recolor(m as THREE.MeshStandardMaterial, team, own);
        made.set(m, n);
      }
      return n;
    };
    o.material = Array.isArray(o.material) ? o.material.map(swap) : swap(o.material);
  });
  const ab: THREE.Object3D[] = [];
  const idle: THREE.Object3D[] = [];
  const engines: THREE.Object3D[] = [];
  const markers: THREE.Object3D[] = [];
  body.traverse((o) => { if (/^ab_/.test(o.name)) markers.push(o); });
  for (const m of markers) {
    const r = Number((m.userData as { radius?: unknown }).radius) || 0.45;
    const e = engine(0, 0, 0, r);
    m.add(e);
    engines.push(e);
    ab.push(...e.getObjectsByProperty("name", "ab"));
    idle.push(...e.getObjectsByProperty("name", "idle"));
  }
  return { body, rig: new Rig(body), ab, idle, engines, materials: [...made.values()] };
}

function recolor(m: THREE.MeshStandardMaterial, team: Team, own: boolean): THREE.Material {
  const color = roleColor(m.name, team, own) ?? `#${m.color.getHexString()}`;
  const map = m.map ?? null;
  if (map) {
    map.magFilter = THREE.NearestFilter;
    map.minFilter = THREE.NearestMipmapLinearFilter;
  }
  // Like the procedural palette: flat facets, a little self-light on the shaded side.
  return new THREE.MeshLambertMaterial({
    name: m.name, color, map, flatShading: true,
    emissive: color, emissiveMap: map, emissiveIntensity: m.name === "canopy" ? 0.35 : 0.18,
  });
}
