// Scene objects for every aircraft: model, flames, name tag, wingtip
// vapor trails and damage smoke. sync() mirrors the given render states.
import * as THREE from "three";
import { enemyTagVisible } from "../game/sight.ts";
import { dist, qForward, type Q, type V3 } from "../sim/vec.ts";
import type { Effects } from "./effects.ts";
import { dressGlb, NEUTRAL, sweepTarget, type Controls, type Dressed, type Rig } from "./glb.ts";
import { buildModel, tryLoadGlb } from "./models.ts";
import type { Team } from "./models/common.ts";
import { measure } from "./shape.ts";
import { validSkin, type SkinId } from "./skins.ts";

export type PlaneRender = {
  id: number; kind: string; team: string; pos: V3; rot: Q; alive: boolean;
  hp: number; maxHP: number; ab: boolean; gForce: number; name: string; isMe: boolean;
  gear: boolean; // landing gear down
  ctl?: Controls; // control surfaces: my stick, or others' turn rates (absent: neutral)
  msl?: number;   // missiles left on the rails, IR + radar (absent: a full load)
  skin?: string;  // paint scheme from the roster (absent or not the kind's: standard)
};

const LABEL_RANGE = 3000; // m: friendly tags (enemies: game/sight.ts)
const SMOKE_HP = 0.4;     // fraction of maxHP below which the plane smokes
const SMOKE_MS = 50;      // one puff per interval, engines taking turns
const TRAIL_G = 9;
const TRAIL_MS = 500;
const TRAIL_CAP = 64;
const TAG_GAP = 5.7;      // m above the fin top (the F-16's tag stays where it was)
const GEAR_S = 0.8;       // gear travel time, s
const SURFACE_RATE = 4;   // control surface travel, full scale per s
const SWEEP_RATE = 0.3;   // swing wing travel, full range per s (about 15°/s on the F-14)
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

/** Where a model's effects attach, in the plane's frame: wingtip (trails) and name tag height. */
export function places(model: THREE.Object3D): { tip: THREE.Vector3; tagUp: number } {
  const s = measure(model);
  return { tip: s.tip, tagUp: s.top + TAG_GAP };
}

const placed = new Map<string, { tip: THREE.Vector3; tagUp: number }>(); // per kind and source

/** places(model), measured once per key: every plane of a kind shares it. */
function placesOf(key: string, model: THREE.Object3D): { tip: THREE.Vector3; tagUp: number } {
  let at = placed.get(key);
  if (!at) {
    at = places(model);
    placed.set(key, at);
  }
  return at;
}

class PlaneView {
  readonly key: string;
  private readonly kind: string;
  readonly root = new THREE.Group();
  private readonly label: THREE.Sprite | null;
  private ab: THREE.Object3D[];
  private idle: THREE.Object3D[];
  private readonly trails = [new Trail(), new Trail()];
  private tip: THREE.Vector3;  // right wingtip's trailing edge (model's measure)
  private tagUp: number;       // name tag height above the origin
  private puff = 0;            // engine the next smoke puff leaves
  private gear: THREE.Object3D | null; // null if a model ever comes without one
  private readonly model: THREE.Group;
  private readonly team: Team;
  private readonly own: boolean;
  private skin: SkinId;
  private glbParts: Dressed | null = null;
  private rig: Rig | null = null;
  private readonly ctl: Controls = { ...NEUTRAL };
  private gearT: number;      // 0 retracted .. 1 down
  private lastAt = -1;        // ms of the previous update
  private dt = 0;             // s since the previous update
  private sweepT = -1;        // swing wings: 0 forward .. 1 back; -1 not placed yet
  private readonly lastPos = new THREE.Vector3();
  private body: THREE.Object3D;
  private lastSmoke = -Infinity;
  private readonly scene: THREE.Scene;

  constructor(scene: THREE.Scene, key: string, p: PlaneRender, labelColor: string) {
    this.scene = scene;
    this.key = key;
    this.kind = p.kind;
    this.team = asTeam(p.team);
    this.own = p.isMe;
    this.skin = validSkin(p.kind, p.skin);
    const model = buildModel(p.kind, this.team, this.own);
    this.model = model;
    this.body = model.children[0];
    ({ tip: this.tip, tagUp: this.tagUp } = placesOf(`${p.kind}|built-in`, model));
    this.ab = model.getObjectsByProperty("name", "ab");
    this.idle = model.getObjectsByProperty("name", "idle");
    this.gear = model.getObjectByName("gear") ?? null;
    this.gearT = p.gear ? 1 : 0; // a plane first seen parked has its wheels down already
    this.root.add(model);
    this.label = p.isMe ? null : makeLabel(p.name, labelColor);
    scene.add(this.root, ...this.trails.map((t) => t.line));
    if (this.label) scene.add(this.label);
  }

  /**
   * Swaps the procedural airframe, flames and gear for a loaded .glb: its own
   * flames at the engine markers, its gear and control surfaces on a rig.
   */
  useGlb(g: THREE.Group): void {
    if (this.glbParts) return;
    for (const o of [...this.model.children]) {
      this.model.remove(o);
      disposeTree(o);
    }
    const d = dressGlb(g, this.team, this.own, this.skin);
    d.body.scale.setScalar(1 / this.model.scale.x); // the .glb is in true metres
    this.model.add(d.body);
    this.body = d.body;
    this.glbParts = d;
    this.rig = d.rig;
    this.ab = d.ab;
    this.idle = d.idle;
    this.gear = d.rig.gear;
    ({ tip: this.tip, tagUp: this.tagUp } = placesOf(`${this.kind}|glb`, this.model));
  }

  /** Another paint from the roster: the .glb's materials swap in place (trails, smoke and rig stay). */
  paint(skin: string | undefined): void {
    const s = validSkin(this.kind, skin);
    if (s === this.skin) return;
    this.skin = s;
    this.glbParts?.repaint(s);
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
    this.updateSurfaces(p.alive ? p.ctl ?? NEUTRAL : NEUTRAL);
    this.updateSweep(p);
    this.rig?.missiles(p.msl ?? Infinity);
    if (this.label) {
      this.label.position.set(p.pos.x, p.pos.y + this.tagUp, p.pos.z);
      this.label.visible = p.alive && showLabel;
      this.label.scale.set(LABEL_W * labelK, LABEL_H * labelK, 1);
    }
    const pulling = p.alive && p.gForce > TRAIL_G;
    this.root.updateMatrixWorld();
    for (let i = 0; i < 2; i++) {
      const tip = pulling ? this.root.localToWorld(new THREE.Vector3(i ? this.tip.x : -this.tip.x, this.tip.y, this.tip.z)) : null;
      this.trails[i].step(now, tip);
    }
    if (p.alive && p.hp < SMOKE_HP * p.maxHP && now - this.lastSmoke >= SMOKE_MS && this.ab.length > 0) {
      this.lastSmoke = now;
      this.puff = (this.puff + 1) % this.ab.length;
      fx.smoke(this.ab[this.puff].getWorldPosition(new THREE.Vector3()));
    }
  }

  /** Moves the gear toward p.gear over GEAR_S; a dead plane snaps (respawn in a hangar). */
  private updateGear(p: PlaneRender, now: number): void {
    const dt = this.lastAt < 0 ? 0 : Math.max(0, now - this.lastAt) / 1000;
    this.lastAt = now;
    this.dt = dt;
    const want = p.gear ? 1 : 0;
    if (!p.alive) this.gearT = want;
    else if (this.gearT < want) this.gearT = Math.min(want, this.gearT + dt / GEAR_S);
    else this.gearT = Math.max(want, this.gearT - dt / GEAR_S);
    if (this.rig) return; // posed with the surfaces
    if (!this.gear) return;
    this.gear.visible = this.gearT > 0.01;
    this.gear.scale.y = this.gearT * this.gear.scale.x; // x carries 1/model scale
  }

  /** Moves the control surfaces toward c at SURFACE_RATE (only a .glb has them). */
  private updateSurfaces(c: Controls): void {
    if (!this.rig) return;
    const step = Math.min(1, Math.max(0, this.dt) * SURFACE_RATE);
    for (const k of ["p", "r", "y"] as const) {
      const want = Math.max(-1, Math.min(1, Number.isFinite(c[k]) ? c[k] : 0));
      this.ctl[k] += Math.max(-step, Math.min(step, want - this.ctl[k]));
    }
    this.rig.pose(this.ctl, this.gearT);
  }

  /**
   * Swing wings follow the speed measured from the drawn positions (no wire
   * field), at SWEEP_RATE; a dead or newly seen plane snaps to its target.
   */
  private updateSweep(p: PlaneRender): void {
    const pos = this.root.position;
    const speed = this.dt > 0 ? pos.distanceTo(this.lastPos) / this.dt : NaN;
    this.lastPos.copy(pos);
    if (!this.rig?.swings) return;
    const want = sweepTarget(Number.isFinite(speed) ? speed : p.gear ? 0 : 200, p.gear);
    if (this.sweepT < 0 || !p.alive) this.sweepT = want;
    else {
      const step = Math.max(0, this.dt) * SWEEP_RATE;
      this.sweepT += Math.max(-step, Math.min(step, want - this.sweepT));
    }
    this.rig.sweep(this.sweepT);
  }

  dispose(): void {
    this.scene.remove(this.root, ...this.trails.map((t) => t.line));
    if (this.glbParts) {
      // Geometry, textures and materials of a .glb are shared; its flames are ours.
      for (const e of this.glbParts.engines) disposeTree(e);
      this.glbParts.release();
      this.body.removeFromParent();
    }
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
      v.paint(p.skin);
      const show = friend ? dist(cam, p.pos) <= LABEL_RANGE : enemyTagVisible(mine, cam, p.pos);
      v.update(p, now, show, this.effects, this.labelK);
    }
  }

  private attachGlb(id: number, v: PlaneView, kind: string): void {
    void tryLoadGlb(kind).then((g) => { // the page's library loads each kind once
      if (g && this.views.get(id) === v) v.useGlb(g);
    });
  }
}
