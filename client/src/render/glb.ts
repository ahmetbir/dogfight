// A loaded .glb airframe made ready for one plane: materials by role coloured
// for its team, flames at the engine markers, and a rig that moves the control
// surfaces and the landing gear. Node contract: tools/blender (spec Phase 3).
import * as THREE from "three";
import { prepareCamo, roleColorOf, skinMaterial } from "./camo.ts";
import { engine, type Team } from "./models/common.ts";
import { SCHEMES, STANDARD, type SkinId } from "./skins.ts";

/** Stick, -1..1 each: p pull (nose up), r roll right, y yaw right. */
export type Controls = { p: number; r: number; y: number };

export const NEUTRAL: Controls = { p: 0, r: 0, y: 0 };

const AILERON = 0.35;  // rad at full roll
const FLAP = 0.4;      // rad down with the gear out
const FLAPERON = 0.5;  // share of roll the flaps also fly
const STAB = 0.3;      // rad at full pitch
const TAILERON = 0.4;  // share of roll on the stabilators
const RUDDER = 0.35;   // rad at full yaw
const CANARD = 0.3;   // rad at full pitch: the leading edge comes up as the stick pulls

// Swing wings (F-14, MiG-23): spread at low speed, swept back fast, stowed
// back on the ground at a standstill (the hangar fit; carrier habit).
const SPREAD_SPEED = 130; // m/s and below: fully forward
const SWEPT_SPEED = 250;  // m/s and above: fully back
const STOW_SPEED = 12;    // m/s: parked or nearly, on the ground: stowed back

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
    case "canard": return c.p * CANARD; // ahead of the wing: pulls with its trailing edge down, no roll
    default: return 0;
  }
}

/**
 * How far back a swing wing wants to be, 0 fully forward .. 1 fully back,
 * from the jet's speed (m/s) and whether it stands on its wheels.
 */
export function sweepTarget(speed: number, ground: boolean): number {
  if (!Number.isFinite(speed)) return 1;
  if (ground && speed < STOW_SPEED) return 1;
  return Math.max(0, Math.min(1, (speed - SPREAD_SPEED) / (SWEPT_SPEED - SPREAD_SPEED)));
}

/**
 * The pivot angle for a sweep t (0 forward .. 1 back) within the node's
 * range [lo, hi] around the modelled pose: a positive turn swings the tip
 * forward, so forward is hi and back is lo.
 */
export function sweepAngle(range: readonly [number, number], t: number): number {
  const k = Math.max(0, Math.min(1, Number.isFinite(t) ? t : 0.5));
  return range[1] + (range[0] - range[1]) * k;
}

/**
 * Colour of each material role: body and secondary from the skin (standard:
 * the team's grey), stripe always the team's, canopy when the skin tints it;
 * null keeps the model's colour.
 */
export function roleColor(role: string, team: Team, own: boolean, skin: SkinId = STANDARD): string | null {
  return roleColorOf(role, team, own, skin);
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
  private readonly pivots: (Hinge & { range: [number, number] })[] = []; // swing wings
  private readonly stores: THREE.Object3D[]; // msl_0.. in firing order
  readonly gear: THREE.Object3D | null;

  constructor(root: THREE.Object3D) {
    this.gear = root.getObjectByName("gear") ?? null;
    const msl: [number, THREE.Object3D][] = [];
    root.traverse((o) => {
      const m = /^msl_(\d+)$/.exec(o.name);
      if (m) msl.push([Number(m[1]), o]);
      const d = o.userData as { role?: unknown; axis?: unknown; retract?: unknown; sweep?: unknown };
      if (d.role === "sweep") {
        const h = hinge(o, d.axis);
        const r = d.sweep;
        if (h && Array.isArray(r) && r.length === 2 && r.every(Number.isFinite) && r[0] < r[1]) this.pivots.push({ ...h, range: [r[0], r[1]] });
      } else if (typeof d.role === "string" && d.axis) {
        const h = hinge(o, d.axis);
        const side = /_([lr])$/.exec(o.name)?.[1] ?? "";
        if (h) this.surfaces.push({ ...h, role: d.role, side });
      }
      if (Array.isArray(d.retract) && d.retract.length === 4 && Number.isFinite(d.retract[3])) {
        const h = hinge(o, d.retract);
        if (h) this.legs.push({ ...h, angle: d.retract[3] as number });
      }
    });
    msl.sort((a, b) => a[0] - b[0]);
    this.stores = msl.map(([, o]) => o);
  }

  /** Missile stations on the model (the aircraft's full load). */
  get missileSlots(): number {
    return this.stores.length;
  }

  /**
   * Shows the left missiles still on their rails: the first fired (msl_0)
   * goes first, so a partial load keeps the last stations.
   */
  missiles(left: number): void {
    const n = this.stores.length;
    const keep = Number.isFinite(left) ? Math.max(0, Math.min(n, Math.floor(left))) : n;
    this.stores.forEach((o, i) => { o.visible = i >= n - keep; });
  }

  /** Whether the model has swing wings. */
  get swings(): boolean {
    return this.pivots.length > 0;
  }

  /** Swing wings to t: 0 fully forward .. 1 fully back (sweepTarget). */
  sweep(t: number): void {
    for (const p of this.pivots) turn(p, sweepAngle(p.range, t));
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
  materials: THREE.Material[];    // shared with every plane of the same look: release(), never dispose
  release: () => void;            // gives the materials back (the flames are the caller's to free)
};

/**
 * Clones the loaded scene for one plane in team colours and a skin (checked
 * for the kind by the caller: skins.ts validSkin). Geometry, textures and the role materials
 * are shared; call release() when the plane goes.
 */
export function dressGlb(src: THREE.Object3D, team: Team, own: boolean, skin: SkinId = STANDARD): Dressed {
  prepareCamo(src);
  const look: SkinId = Object.hasOwn(SCHEMES, skin) ? skin : STANDARD;
  const body = src.clone(true);
  const made = new Map<THREE.Material, { mat: THREE.Material; release: () => void }>();
  body.traverse((o) => {
    if (!(o instanceof THREE.Mesh)) return;
    const swap = (m: THREE.Material) => {
      let n = made.get(m);
      if (!n) {
        n = skinMaterial(m as THREE.MeshStandardMaterial, team, own, look);
        made.set(m, n);
      }
      return n.mat;
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
  const held = [...made.values()];
  return {
    body, rig: new Rig(body), ab, idle, engines, materials: held.map((x) => x.mat),
    release: () => { for (const x of held) x.release(); },
  };
}
