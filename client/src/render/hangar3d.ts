// The hangar picker's 3D: one WebGL renderer that draws the selected jet as
// a slowly turning preview (drag to turn it) and, once per kind and team, a
// still thumbnail copied into a plain 2D canvas for its card. The jets are
// the game's own .glb models dressed in team colours, gear down, every
// missile on its rail; a kind without a .glb shows its procedural model.
// The renderer lives only while the picker is open (dispose()); the
// thumbnails and the loaded models outlive it, owned by the HangarModels.
import * as THREE from "three";
import { dressGlb, NEUTRAL, type Dressed } from "./glb.ts";
import { buildModel, tryLoadGlb } from "./models.ts";
import type { Team } from "./models/common.ts";

const TURN_RATE = 0.35;  // rad/s of the idle turn
const DRAG_RATE = 0.01;  // rad per CSS px dragged
const TILT_MAX = 0.6;    // rad, either way
const THUMB_W = 250, THUMB_H = 100; // CSS px; drawn at 2x
const FOV = 30;

/** What a jet looks like on the hangar floor: its scene object and the parts to free. */
type Shown = { root: THREE.Group; dressed: Dressed | null };

/**
 * Loads each kind's .glb once and keeps the thumbnails, across picker opens.
 * Nothing here holds a GL resource.
 */
export class HangarModels {
  private readonly glbs = new Map<string, Promise<THREE.Group | null>>();
  private readonly thumbs = new Map<string, HTMLCanvasElement>();

  glb(kind: string): Promise<THREE.Group | null> {
    let p = this.glbs.get(kind);
    if (!p) {
      p = tryLoadGlb(kind);
      this.glbs.set(kind, p);
    }
    return p;
  }

  /** The thumbnail canvas of kind for team, empty until a stage draws it. */
  thumb(kind: string, team: Team): { canvas: HTMLCanvasElement; drawn: boolean } {
    const key = `${kind}|${team}`;
    let c = this.thumbs.get(key);
    const drawn = !!c && c.dataset.drawn === "1";
    if (!c) {
      c = document.createElement("canvas");
      c.width = THUMB_W * 2;
      c.height = THUMB_H * 2;
      c.className = "hangar-thumb";
      this.thumbs.set(key, c);
    }
    return { canvas: c, drawn };
  }
}

/** A jet for the hangar: the dressed .glb if there is one, else the procedural model. */
async function showJet(models: HangarModels, kind: string, team: Team): Promise<Shown> {
  const root = new THREE.Group();
  const g = await models.glb(kind);
  if (g) {
    const d = dressGlb(g, team, false);
    d.rig.pose(NEUTRAL, 1);         // gear down, flaps lowered with it
    d.rig.missiles(Infinity);       // the full load on its rails
    for (const o of d.ab) o.visible = false;
    for (const o of d.idle) o.visible = true;
    root.add(d.body);
    return { root, dressed: d };
  }
  const m = buildModel(kind, team);
  for (const o of m.getObjectsByProperty("name", "ab")) o.visible = false;
  const gear = m.getObjectByName("gear");
  if (gear) gear.visible = true;
  root.add(m);
  return { root, dressed: null };
}

function freeJet(s: Shown): void {
  s.root.removeFromParent();
  if (s.dressed) {
    for (const m of s.dressed.materials) m.dispose(); // geometry and textures are shared with the loaded scene
    for (const e of s.dressed.engines) e.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  } else {
    s.root.traverse((o) => { if (o instanceof THREE.Mesh) { o.geometry.dispose(); (o.material as THREE.Material).dispose(); } });
  }
}

/** Camera distance that fits a jet of radius r in a view of aspect a. */
function fitDistance(r: number, aspect: number): number {
  const half = THREE.MathUtils.degToRad(FOV / 2);
  const byH = r / Math.tan(half);
  const byW = r / Math.tan(Math.atan(Math.tan(half) * aspect));
  return 1.08 * Math.max(byH, byW);
}

/**
 * The preview: draws into canvas (its CSS size), turning slowly unless
 * reduced motion is asked for; a drag turns and tilts it.
 */
export class HangarStage {
  private readonly gl: THREE.WebGLRenderer;
  private readonly scene = new THREE.Scene();
  private readonly camera = new THREE.PerspectiveCamera(FOV, 1, 0.5, 400);
  private readonly turntable = new THREE.Group();
  private readonly models: HangarModels;
  private readonly canvas: HTMLCanvasElement;
  private readonly still: boolean;
  private shown: Shown | null = null;
  private want = "";           // kind|team asked for last
  private radius = 10;
  private yaw = -2.3;          // rad: the nose toward the viewer's left, three-quarter
  private tilt = 0.32;         // rad of camera elevation
  private drag: { id: number; x: number; y: number } | null = null;
  private raf = 0;
  private last = -1;
  private alive = true;
  private readonly cleanup: (() => void)[] = [];
  private jobs: { kind: string; team: Team; done: (kind: string) => void; jet: Shown | null }[] = [];

  constructor(canvas: HTMLCanvasElement, models: HangarModels, reducedMotion: boolean) {
    this.canvas = canvas;
    this.models = models;
    this.still = reducedMotion;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.gl.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    this.gl.setClearColor(0x000000, 0);
    this.scene.add(new THREE.HemisphereLight(0xdde8f5, 0x3a4450, 1.5));
    const sun = new THREE.DirectionalLight(0xffffff, 1.9);
    sun.position.set(-30, 60, -20);
    this.scene.add(sun, this.turntable);
    const on = <K extends keyof HTMLElementEventMap>(type: K, f: (e: HTMLElementEventMap[K]) => void) => {
      canvas.addEventListener(type, f);
      this.cleanup.push(() => canvas.removeEventListener(type, f));
    };
    on("pointerdown", (e) => {
      this.drag = { id: e.pointerId, x: e.clientX, y: e.clientY };
      canvas.setPointerCapture(e.pointerId);
    });
    on("pointermove", (e) => {
      if (!this.drag || e.pointerId !== this.drag.id) return;
      this.yaw += (e.clientX - this.drag.x) * DRAG_RATE;
      this.tilt = Math.max(-TILT_MAX, Math.min(TILT_MAX, this.tilt + (e.clientY - this.drag.y) * DRAG_RATE));
      this.drag.x = e.clientX;
      this.drag.y = e.clientY;
    });
    const up = (e: PointerEvent) => { if (this.drag?.id === e.pointerId) this.drag = null; };
    on("pointerup", up);
    on("pointercancel", up);
    this.raf = requestAnimationFrame(this.frame);
  }

  /** Shows kind in team colours (the newest call wins while models load). */
  show(kind: string, team: Team): void {
    const key = `${kind}|${team}`;
    if (key === this.want) return;
    this.want = key;
    void showJet(this.models, kind, team).then((s) => {
      if (!this.alive || this.want !== key) {
        freeJet(s);
        return;
      }
      if (this.shown) freeJet(this.shown);
      this.shown = s;
      this.turntable.add(s.root);
      const box = new THREE.Box3().setFromObject(s.root);
      const c = box.getCenter(new THREE.Vector3());
      s.root.position.sub(c); // turn about the jet's middle
      this.radius = box.getSize(new THREE.Vector3()).length() / 2;
    });
  }

  /**
   * Draws every kind's thumbnail for team that is not drawn yet, one per
   * frame before the preview (so the preview never shows a cleared buffer),
   * calling done(kind) after each.
   */
  thumbnails(kinds: readonly string[], team: Team, done: (kind: string) => void): void {
    for (const kind of kinds) {
      if (this.models.thumb(kind, team).drawn) continue;
      const job = { kind, team, done, jet: null as Shown | null };
      this.jobs.push(job);
      void showJet(this.models, kind, team).then((s) => {
        if (this.alive) job.jet = s;
        else freeJet(s);
      });
    }
  }

  private drawThumb(s: Shown, out: HTMLCanvasElement): void {
    const scene = new THREE.Scene();
    for (const o of this.scene.children) if (o instanceof THREE.Light) scene.add(o.clone());
    const box = new THREE.Box3().setFromObject(s.root);
    s.root.position.sub(box.getCenter(new THREE.Vector3()));
    const holder = new THREE.Group();
    holder.add(s.root);
    holder.rotation.y = -2.3;
    scene.add(holder);
    const r = box.getSize(new THREE.Vector3()).length() / 2;
    const cam = new THREE.PerspectiveCamera(FOV, out.width / out.height, 0.5, 400);
    const d = fitDistance(r * 0.55, cam.aspect);
    cam.position.set(0, Math.sin(0.42) * d, Math.cos(0.42) * d);
    cam.lookAt(0, 0, 0);
    const size = this.gl.getSize(new THREE.Vector2());
    const ratio = this.gl.getPixelRatio();
    this.gl.setPixelRatio(1);
    this.gl.setSize(out.width, out.height, false);
    this.gl.render(scene, cam);
    const g = out.getContext("2d");
    if (g) {
      g.clearRect(0, 0, out.width, out.height);
      g.drawImage(this.canvas, 0, 0, out.width, out.height); // same task as the render: the buffer is still there
      out.dataset.drawn = "1";
    }
    this.gl.setPixelRatio(ratio);
    this.gl.setSize(size.x, size.y, false);
    holder.remove(s.root);
    s.root.position.set(0, 0, 0);
  }

  private readonly frame = (now: number): void => {
    if (!this.alive) return;
    const dt = this.last < 0 ? 0 : Math.min(0.1, (now - this.last) / 1000);
    this.last = now;
    if (!this.still && !this.drag) this.yaw += TURN_RATE * dt;
    const job = this.jobs[0];
    if (job?.jet) {
      this.jobs.shift();
      const out = this.models.thumb(job.kind, job.team);
      if (!out.drawn) this.drawThumb(job.jet, out.canvas);
      freeJet(job.jet);
      job.done(job.kind);
    }
    const w = this.canvas.clientWidth, h = this.canvas.clientHeight;
    if (w > 0 && h > 0) {
      const size = this.gl.getSize(new THREE.Vector2());
      if (size.x !== w || size.y !== h) this.gl.setSize(w, h, false);
      this.camera.aspect = w / h;
      this.camera.updateProjectionMatrix();
      const d = fitDistance(this.radius * 0.74, this.camera.aspect); // room for the span as it turns
      this.camera.position.set(0, Math.sin(this.tilt) * d, Math.cos(this.tilt) * d);
      this.camera.lookAt(0, 0, 0);
      this.turntable.rotation.y = this.yaw;
      this.gl.render(this.scene, this.camera);
    }
    this.raf = requestAnimationFrame(this.frame);
  };

  /** Stops drawing and frees the renderer and the shown jet's own materials. */
  dispose(): void {
    this.alive = false;
    cancelAnimationFrame(this.raf);
    for (const f of this.cleanup) f();
    if (this.shown) freeJet(this.shown);
    this.shown = null;
    for (const j of this.jobs) if (j.jet) freeJet(j.jet);
    this.jobs = [];
    this.gl.dispose();
    this.gl.forceContextLoss();
  }
}
