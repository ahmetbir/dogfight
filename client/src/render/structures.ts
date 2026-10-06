// Base attack targets (spec §3.10, §12.1): fuel tanks, radar with a turning
// dish, AA sites and a team stripe on the target hangars (the hangars
// themselves are drawn by bases.ts). Destroyed ones turn dark and smoke.
import * as THREE from "three";
import type { StructInfo } from "../net/protocol.ts";
import type { V3 } from "../sim/vec.ts";

const DEAD = "#2a2724";
const COLORS: Record<string, string> = { fuel: "#c9ccd1", radar: "#9aa3ad", aa: "#5d6b4f" };
const TEAM: Record<string, string> = { nato: "#3d6fd6", soviet: "#c73b3b" };
const DISH_RATE = 0.6;  // rad/s
const SMOKE_MS = 300;
const ARCH_H = 1;       // m: bases.ts hangar roof arch above the box
const STRIPE_W = 8;     // m: across the hangar roof

export type SmokeSink = { smoke(at: V3): void };

/** Color and smoke of a structure; tm picks a hangar's stripe color. */
export function structLook(kind: string, alive: boolean, tm = "nato"): { color: string; smoke: boolean } {
  if (!alive) return { color: DEAD, smoke: true };
  return { color: kind === "hangar" ? TEAM[tm] ?? TEAM.nato : COLORS[kind] ?? "#9aa0a6", smoke: false };
}

type View = {
  s: StructInfo;
  mat: THREE.MeshLambertMaterial; // recolored on destruction
  top: V3;                        // smoke source
  dish: THREE.Object3D | null;    // radar only
  charred: THREE.Object3D | null; // hangar only: dark roof and walls shown once destroyed
  alive: boolean;
  smokeAt: number;
};

export class StructureViews {
  private readonly views: View[] = [];
  private lastMs: number | null = null;

  constructor(scene: THREE.Scene, structs: StructInfo[]) {
    for (const s of structs) {
      const [x0, y0, z0, x1, y1, z1] = s.box;
      const mat = new THREE.MeshLambertMaterial({ color: structLook(s.k, true, s.tm).color, flatShading: true });
      const g = new THREE.Group();
      g.name = `struct-${s.id}`;
      g.position.set((x0 + x1) / 2, y0, (z0 + z1) / 2);
      const w = x1 - x0, h = y1 - y0, d = z1 - z0;
      let dish: THREE.Object3D | null = null;
      let charred: THREE.Object3D | null = null;
      let topY = y1;
      switch (s.k) {
        case "fuel": buildFuel(g, mat, w, h); break;
        case "radar": dish = buildRadar(g, mat, w, h, d); break;
        case "aa": buildAA(g, mat, w, h, d); break;
        case "hangar":
          charred = buildHangar(g, mat, w, h, d);
          topY = y1 + ARCH_H;
          break;
      }
      scene.add(g);
      this.views.push({ s, mat, top: { x: g.position.x, y: topY, z: g.position.z }, dish, charred, alive: true, smokeAt: -Infinity });
    }
  }

  /** Mirrors hp (id → HP, 0: destroyed; missing: intact); nowMs paces the dish and smoke. */
  sync(hp: Map<number, number>, nowMs: number, fx: SmokeSink): void {
    const dt = this.lastMs === null ? 0 : Math.max(0, (nowMs - this.lastMs) / 1000);
    this.lastMs = nowMs;
    for (const v of this.views) {
      const h = hp.get(v.s.id);
      const alive = h === undefined || h > 0;
      if (alive !== v.alive) {
        v.alive = alive;
        v.mat.color.set(structLook(v.s.k, alive, v.s.tm).color);
        if (v.charred) v.charred.visible = !alive;
        if (alive) v.smokeAt = -Infinity;
      }
      if (alive) {
        if (v.dish) v.dish.rotation.y += DISH_RATE * dt;
      } else if (nowMs - v.smokeAt >= SMOKE_MS) {
        v.smokeAt = nowMs;
        fx.smoke(v.top);
      }
    }
  }

  /** The radar dish heading of structure id (tests); null when it has none. */
  dishAngle(id: number): number | null {
    return this.views.find((v) => v.s.id === id)?.dish?.rotation.y ?? null;
  }
}

function mesh(geo: THREE.BufferGeometry, mat: THREE.Material, x: number, y: number, z: number): THREE.Mesh {
  const m = new THREE.Mesh(geo, mat);
  m.position.set(x, y, z);
  return m;
}

function buildFuel(g: THREE.Group, mat: THREE.Material, w: number, h: number): void {
  g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, h, 20), mat, 0, h / 2, 0));
}

/** Box with a mast and a dish turning about the vertical. */
function buildRadar(g: THREE.Group, mat: THREE.MeshLambertMaterial, w: number, h: number, d: number): THREE.Object3D {
  mat.side = THREE.DoubleSide; // the dish is an open shell
  const bodyH = h * 0.45;
  g.add(mesh(new THREE.BoxGeometry(w * 0.8, bodyH, d * 0.8), mat, 0, bodyH / 2, 0));
  const mastTop = h * 0.75;
  g.add(mesh(new THREE.CylinderGeometry(0.4, 0.6, mastTop - bodyH, 8), mat, 0, (bodyH + mastTop) / 2, 0));
  const cap = 0.6; // rad: spherical cap half-angle
  const r = (w * 0.45) / Math.sin(cap);
  const dish = new THREE.SphereGeometry(r, 16, 4, 0, Math.PI * 2, 0, cap)
    .translate(0, -r * Math.cos(cap), 0) // rim at y 0
    .rotateX(Math.PI / 2 - 0.35);        // face sideways, tilted up
  const turn = new THREE.Group();
  turn.position.y = mastTop;
  turn.add(new THREE.Mesh(dish, mat));
  g.add(turn);
  return turn;
}

/** Low box, turret and two barrels raised 40°. */
function buildAA(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number): void {
  const baseH = h * 0.6;
  g.add(mesh(new THREE.BoxGeometry(w, baseH, d), mat, 0, baseH / 2, 0));
  const tr = Math.min(w, d) * 0.22;
  g.add(mesh(new THREE.CylinderGeometry(tr, tr * 1.1, h - baseH, 10), mat, 0, (baseH + h) / 2, 0));
  const len = 7;
  const elev = (40 * Math.PI) / 180;
  for (const side of [-0.7, 0.7]) {
    const barrel = new THREE.CylinderGeometry(0.25, 0.3, len, 6)
      .translate(0, len / 2, 0)
      .rotateX(-(Math.PI / 2 - elev)); // from vertical down toward -Z
    g.add(mesh(barrel, mat, side, h - 0.5, 0));
  }
}

/** Team stripe along the roof arch; returns the charred overlay (hidden while intact). */
function buildHangar(g: THREE.Group, mat: THREE.Material, w: number, h: number, d: number): THREE.Object3D {
  const alongX = w >= d; // the 40 m side runs along the runway; the arch runs across it
  const stripe = alongX ? new THREE.BoxGeometry(STRIPE_W, 0.3, d * 1.01) : new THREE.BoxGeometry(w * 1.01, 0.3, STRIPE_W);
  g.add(mesh(stripe, mat, 0, h + ARCH_H + 0.1, 0));
  const dark = new THREE.MeshLambertMaterial({ color: DEAD, flatShading: true });
  const charred = new THREE.Group();
  charred.add(mesh(new THREE.BoxGeometry(w + 0.4, ARCH_H + 0.2, d + 0.4), dark, 0, h + ARCH_H / 2 - 0.05, 0)); // burnt roof
  const wall = 1.4;
  for (const s of [-1, 1]) { // side walls (u ends), slightly thicker than bases.ts' 1 m walls
    const geo = alongX ? new THREE.BoxGeometry(wall, h, d + 0.2) : new THREE.BoxGeometry(w + 0.2, h, wall);
    charred.add(alongX ? mesh(geo, dark, s * (w / 2 - 0.5), h / 2, 0) : mesh(geo, dark, 0, h / 2, s * (d / 2 - 0.5)));
  }
  charred.visible = false;
  g.add(charred);
  return charred;
}
