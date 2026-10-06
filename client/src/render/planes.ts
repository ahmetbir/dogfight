// Scene objects for every aircraft: model, flames, name tag, wingtip
// vapor trails and damage smoke. sync() mirrors the given render states.
import * as THREE from "three";
import { enemyTagVisible } from "../game/sight.ts";
import { dist, qForward, type Q, type V3 } from "../sim/vec.ts";
import type { Effects } from "./effects.ts";
import { buildModel, tryLoadGlb } from "./models.ts";
import type { Team } from "./models/common.ts";

export type PlaneRender = {
  id: number; kind: string; team: string; pos: V3; rot: Q; alive: boolean;
  hp: number; maxHP: number; ab: boolean; gForce: number; name: string; isMe: boolean;
  gear: boolean; // landing gear down
};

const LABEL_RANGE = 3000; // m: friendly tags (enemies: game/sight.ts)
const SMOKE_HP = 0.4;     // fraction of maxHP below which the plane smokes
const SMOKE_MS = 50;
const TRAIL_G = 9;
const TRAIL_MS = 500;
const TRAIL_CAP = 64;
const GEAR_S = 0.8;       // gear travel time, s
const ENEMY = "#ff5a5a";
const FRIEND = "#6aa8ff";

const asTeam = (t: string): Team => (t === "nato" || t === "soviet" ? t : "none");

/** A fading polyline through the last TRAIL_MS of wingtip positions. */
class Trail {
  readonly line: THREE.Line;
  private readonly buf = new Float32Array(TRAIL_CAP * 3);
  private readonly times: number[] = [];

  constructor() {
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(this.buf, 3).setUsage(THREE.DynamicDrawUsage));
    geo.setDrawRange(0, 0);
    this.line = new THREE.Line(geo, new THREE.LineBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
    this.line.frustumCulled = false;
  }

  /** Expires old points and, when p is given, appends it. */
  step(now: number, p: THREE.Vector3 | null): void {
    let drop = 0;
    while (drop < this.times.length && now - this.times[drop] > TRAIL_MS) drop++;
    if (p && this.times.length - drop >= TRAIL_CAP) drop++;
    if (drop > 0) {
      this.buf.copyWithin(0, 3 * drop, 3 * this.times.length);
      this.times.splice(0, drop);
    }
    if (p) {
      this.buf.set([p.x, p.y, p.z], 3 * this.times.length);
      this.times.push(now);
    }
    const geo = this.line.geometry;
    geo.setDrawRange(0, this.times.length);
    geo.attributes.position.needsUpdate = true;
  }

  dispose(): void {
    this.line.geometry.dispose();
    (this.line.material as THREE.Material).dispose();
  }
}

function makeLabel(text: string, color: string): THREE.Sprite {
  const c = document.createElement("canvas");
  c.width = 256;
  c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    g.font = "bold 30px system-ui, sans-serif";
    g.textAlign = "center";
    g.textBaseline = "middle";
    g.lineWidth = 6;
    g.strokeStyle = "rgba(0,0,0,0.75)";
    g.strokeText(text, 128, 32, 248);
    g.fillStyle = color;
    g.fillText(text, 128, 32, 248);
  }
  const tex = new THREE.CanvasTexture(c);
  tex.colorSpace = THREE.SRGBColorSpace;
  const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, sizeAttenuation: false, depthTest: false, fog: false }));
  s.scale.set(LABEL_W, LABEL_H, 1);
  s.renderOrder = 10;
  return s;
}

const LABEL_W = 0.16, LABEL_H = 0.04; // sprite scale at LABEL_REF_H and above
const LABEL_REF_H = 600;               // CSS px: shorter views (phones) grow the tags

/** Name-tag scale factor for a view viewH CSS px tall: 1 on desktops, up to 2 on phones. */
export function labelScale(viewH: number): number {
  return viewH > 0 ? Math.min(2, Math.max(1, LABEL_REF_H / viewH)) : 1;
}

function disposeTree(o: THREE.Object3D): void {
  o.traverse((c) => {
    if (c instanceof THREE.Mesh || c instanceof THREE.Sprite) {
      if (c instanceof THREE.Mesh) c.geometry.dispose(); // sprites share one geometry
      const m = c.material as THREE.Material & { map?: THREE.Texture | null };
      m.map?.dispose();
      m.dispose();
    }
  });
}

class PlaneView {
  readonly key: string;
  readonly root = new THREE.Group();
  private readonly label: THREE.Sprite | null;
  private readonly ab: THREE.Object3D[];
  private readonly idle: THREE.Object3D[];
  private readonly trails = [new Trail(), new Trail()];
  private readonly span: number;
  private readonly gear: THREE.Object3D | null; // null if a model ever comes without one
  private gearT: number;      // 0 retracted .. 1 down
  private lastAt = -1;        // ms of the previous update
  private body: THREE.Object3D;
  private glb = false;
  private lastSmoke = -Infinity;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, key: string, p: PlaneRender, labelColor: string) {
    this.scene = scene;
    this.key = key;
    const model = buildModel(p.kind, asTeam(p.team), p.isMe);
    this.body = model.children[0];
    this.span = model.userData.span as number;
    this.ab = model.getObjectsByProperty("name", "ab");
    this.idle = model.getObjectsByProperty("name", "idle");
    this.gear = model.getObjectByName("gear") ?? null;
    this.gearT = p.gear ? 1 : 0; // a plane first seen parked has its wheels down already
    this.root.add(model);
    this.label = p.isMe ? null : makeLabel(p.name, labelColor);
    scene.add(this.root, ...this.trails.map((t) => t.line));
    if (this.label) scene.add(this.label);
  }

  /** Swaps the procedural airframe for a loaded .glb (flames stay). */
  useGlb(g: THREE.Group): void {
    const parent = this.body.parent;
    if (!parent || this.glb) return;
    disposeTree(this.body);
    parent.remove(this.body);
    this.body = g.clone();
    parent.add(this.body);
    this.glb = true;
  }

  update(p: PlaneRender, now: number, showLabel: boolean, fx: Effects, labelK = 1): void {
    this.root.visible = p.alive;
    this.root.position.set(p.pos.x, p.pos.y, p.pos.z);
    this.root.quaternion.set(p.rot.x, p.rot.y, p.rot.z, p.rot.w);
    const flick = 0.85 + Math.random() * 0.3;
    for (const o of this.ab) {
      o.visible = p.ab;
      o.scale.set(0.9 + 0.2 * Math.random(), 0.9 + 0.2 * Math.random(), flick);
    }
    for (const o of this.idle) o.visible = !p.ab;
    this.updateGear(p, now);
    if (this.label) {
      this.label.position.set(p.pos.x, p.pos.y + 9, p.pos.z);
      this.label.visible = p.alive && showLabel;
      this.label.scale.set(LABEL_W * labelK, LABEL_H * labelK, 1);
    }
    const pulling = p.alive && p.gForce > TRAIL_G;
    this.root.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      const tip = pulling ? this.root.localToWorld(new THREE.Vector3(i ? this.span : -this.span, 0, 2.5)) : null;
      this.trails[i].step(now, tip);
    }
    if (p.alive && p.hp < SMOKE_HP * p.maxHP && now - this.lastSmoke >= SMOKE_MS) {
      this.lastSmoke = now;
      fx.smoke(this.root.localToWorld(new THREE.Vector3(0, 0.5, 6)));
    }
  }

  /** Moves the gear toward p.gear over GEAR_S; a dead plane snaps (respawn in a hangar). */
  private updateGear(p: PlaneRender, now: number): void {
    const dt = this.lastAt < 0 ? 0 : Math.max(0, now - this.lastAt) / 1000;
    this.lastAt = now;
    const want = p.gear ? 1 : 0;
    if (!p.alive) this.gearT = want;
    else if (this.gearT < want) this.gearT = Math.min(want, this.gearT + dt / GEAR_S);
    else this.gearT = Math.max(want, this.gearT - dt / GEAR_S);
    if (!this.gear) return;
    this.gear.visible = this.gearT > 0.01;
    this.gear.scale.y = this.gearT * this.gear.scale.x; // x carries 1/model scale
  }

  dispose(): void {
    this.scene.remove(this.root, ...this.trails.map((t) => t.line));
    if (this.glb) this.body.removeFromParent(); // shared .glb geometry is not ours
    disposeTree(this.root);
    for (const t of this.trails) t.dispose();
    if (this.label) {
      this.scene.remove(this.label);
      disposeTree(this.label);
    }
  }
}

/** Keeps one PlaneView per aircraft id in sync with the render states. */
export class PlaneViews {
  private readonly views = new Map<number, PlaneView>();
  private readonly glbs = new Map<string, Promise<THREE.Group | null>>();
  private readonly scene: THREE.Scene;
  private readonly camera: THREE.Camera;
  private readonly effects: Effects;
  private readonly now: () => number;
  private labelK = 1;

  /** The canvas height in CSS px: name tags stay readable on short (phone) views. */
  setViewHeight(h: number): void {
    this.labelK = labelScale(h);
  }

  /** camera hides far name tags; effects receives damage smoke; now is in ms. */
  constructor(scene: THREE.Scene, camera: THREE.Camera, effects: Effects, now: () => number = () => performance.now()) {
    this.scene = scene;
    this.camera = camera;
    this.effects = effects;
    this.now = now;
  }

  /**
   * myTeam comes from the roster, so friends stay friends while I have no
   * plane (pick screen); without it, my own plane's team is used.
   */
  sync(planes: Map<number, PlaneRender>, myTeam = ""): void {
    const now = this.now();
    if (!myTeam) for (const p of planes.values()) if (p.isMe) myTeam = p.team;
    for (const [id, v] of this.views) {
      if (!planes.has(id)) {
        v.dispose();
        this.views.delete(id);
      }
    }
    const camPos = this.camera.getWorldPosition(new THREE.Vector3());
    const cam = { x: camPos.x, y: camPos.y, z: camPos.z };
    let mine: { pos: V3; fwd: V3 } | null = null;
    for (const p of planes.values()) if (p.isMe && p.alive) mine = { pos: p.pos, fwd: qForward(p.rot) };
    for (const [id, p] of planes) {
      const friend = !p.isMe && p.team !== "none" && p.team === myTeam;
      const key = `${p.kind}|${p.team}|${p.isMe}|${p.name}|${friend}`;
      let v = this.views.get(id);
      if (v && v.key !== key) {
        v.dispose();
        v = undefined;
      }
      if (!v) {
        v = new PlaneView(this.scene, key, p, friend ? FRIEND : ENEMY);
        this.views.set(id, v);
        this.attachGlb(id, v, p.kind);
      }
      const show = friend ? dist(cam, p.pos) <= LABEL_RANGE : enemyTagVisible(mine, cam, p.pos);
      v.update(p, now, show, this.effects, this.labelK);
    }
  }

  private attachGlb(id: number, v: PlaneView, kind: string): void {
    let req = this.glbs.get(kind);
    if (!req) {
      req = tryLoadGlb(kind);
      this.glbs.set(kind, req);
    }
    void req.then((g) => {
      if (g && this.views.get(id) === v) v.useGlb(g);
    });
  }
}
