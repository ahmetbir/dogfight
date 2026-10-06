// Transient visual effects: tracers, explosions, sparks, smoke, missile trails, flares.
import * as THREE from "three";
import type { V3 } from "../sim/vec.ts";
import { Particles, type Look } from "./particles.ts";

const MAX_TRACERS = 400;
const GLOW_CAP = 800;   // additive: fire, sparks, flares
const SMOKE_CAP = 1200; // alpha-blended: smoke, trails (2000 particles in all)
const FLASHES = 16;
const FLASH_S = 0.3;
const TRAIL_STEP = 2.5;  // meters between missile trail puffs
const TRAIL_GAP_S = 1;  // forget a missile trail after this long without a call
const FLARE_EMIT_S = 1 / 30; // flare glow/smoke cadence, independent of frame rate

const look = (life: number, size: [number, number], color: string, alpha: number, drag: number, lift: number): Look =>
  ({ life, size, color: new THREE.Color(color), alpha, drag, lift });

const FIRE = look(0.7, [3, 9], "#ff8a2a", 0.9, 2, 2);
const SPARK = look(0.45, [0.8, 0.3], "#ffd56a", 1, 1, -9.8);
const SMOKE = look(3, [5, 16], "#3c3c3c", 0.55, 0.6, 3);
const DAMAGE = look(1.6, [2, 7], "#2c2c2c", 0.6, 0.5, 2);
const WRECK = look(6, [6, 28], "#262422", 0.6, 0.3, 7);
const TRAIL = look(2, [2.5, 9], "#c9cdd2", 0.55, 0.2, 0.5);
const RADAR_TRAIL = look(3.2, [1.4, 5], "#9cc0f0", 0.7, 0.1, 0.2); // radar missiles: thin, long, blue-white
const FLARE = look(0.14, [5, 3], "#fff2c0", 1, 0, 0);
const FLARE_SMOKE = look(1.2, [1, 4], "#e8e8e8", 0.45, 0.4, 0.5);
const PUFF_FIRE = look(0.35, [2, 5], "#ffb04a", 0.9, 2, 1);
const PUFF_SMOKE = look(1.4, [3, 9], "#f2f2f2", 0.5, 0.8, 2);

type Tracer = { p: THREE.Vector3; v: THREE.Vector3; life: number; color: THREE.Color };
type Flash = { mesh: THREE.Mesh; age: number; size: number };

/** Owns every pooled effect; update advances them once per frame. */
export class Effects {
  private readonly tracerMesh: THREE.InstancedMesh;
  private readonly tracers: Tracer[] = [];
  private readonly glow: Particles;
  private readonly smokes: Particles;
  private readonly flashes: Flash[] = [];
  private readonly trails = new Map<number, { last: THREE.Vector3; idle: number }>();
  private readonly flareEmit = new Map<number, number>(); // burning flare id → seconds toward its next puff
  private readonly m = new THREE.Matrix4();
  private readonly q = new THREE.Quaternion();
  private readonly dir = new THREE.Vector3();
  private readonly one = new THREE.Vector3(1, 1, 1);
  private readonly fwd = new THREE.Vector3(0, 0, 1);
  private readonly yellow = new THREE.Color("#ffe066");
  private readonly orange = new THREE.Color("#ff8a1f");
  private readonly colors = new Map<string, THREE.Color>(); // tracer colors by CSS string

  /** perf: performance mode, half the particle capacity. */
  constructor(scene: THREE.Scene, perf = false) {
    this.glow = new Particles(GLOW_CAP, true);
    this.smokes = new Particles(SMOKE_CAP, false);
    this.setPerf(perf);
    const mat = new THREE.MeshBasicMaterial({ color: 0xffffff, toneMapped: false, fog: false });
    this.tracerMesh = new THREE.InstancedMesh(new THREE.BoxGeometry(0.25, 0.25, 12), mat, MAX_TRACERS);
    this.tracerMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    this.tracerMesh.setColorAt(0, this.yellow); // allocates instanceColor
    this.tracerMesh.count = 0;
    this.tracerMesh.frustumCulled = false;
    scene.add(this.tracerMesh, this.glow.points, this.smokes.points);
    for (let i = 0; i < FLASHES; i++) {
      const mesh = new THREE.Mesh(
        new THREE.IcosahedronGeometry(1, 1),
        new THREE.MeshBasicMaterial({ color: "#ffb347", transparent: true, depthWrite: false, toneMapped: false }),
      );
      mesh.visible = false;
      scene.add(mesh);
      this.flashes.push({ mesh, age: FLASH_S, size: 1 });
    }
  }

  /** Performance mode halves the live particle capacity (switchable mid-game). */
  setPerf(perf: boolean): void {
    const k = perf ? 0.5 : 1;
    this.glow.setLimit(GLOW_CAP * k);
    this.smokes.setLimit(SMOKE_CAP * k);
  }

  /** A round from `from` moving at vel for lifeS seconds; mine are orange, others yellow unless color is given. */
  tracer(from: V3, vel: V3, lifeS: number, mine: boolean, color?: string): void {
    if (this.tracers.length >= MAX_TRACERS) this.tracers.shift();
    const c = color ? this.colorOf(color) : mine ? this.orange : this.yellow;
    this.tracers.push({ p: new THREE.Vector3(from.x, from.y, from.z), v: new THREE.Vector3(vel.x, vel.y, vel.z), life: lifeS, color: c });
  }

  private colorOf(css: string): THREE.Color {
    let c = this.colors.get(css);
    if (!c) this.colors.set(css, (c = new THREE.Color(css)));
    return c;
  }

  explosion(at: V3, big: boolean): void {
    const f = this.flashes.reduce((a, b) => (b.age > a.age ? b : a));
    f.age = 0;
    f.size = big ? 28 : 12;
    f.mesh.position.set(at.x, at.y, at.z);
    f.mesh.visible = true;
    const k = big ? 1 : 0.5;
    this.burst(at, 30, 40 * k, FIRE, this.glow);
    this.burst(at, big ? 20 : 8, 25 * k, SPARK, this.glow);
    this.burst(at, big ? 14 : 6, 8 * k, SMOKE, this.smokes);
  }

  sparks(at: V3): void {
    this.burst(at, 12, 30, SPARK, this.glow);
  }

  /** Damage smoke puff (burning aircraft). */
  smoke(at: V3): void {
    this.burst(at, 1, 2, DAMAGE, this.smokes);
  }

  /** Smoke plume puffs over a destroyed base attack structure. */
  wreckSmoke(at: V3): void {
    this.burst(at, 3, 3, WRECK, this.smokes);
  }

  /** Called every frame per live missile: drops grey puffs every few meters (radar: a thin blue-white line). */
  missileTrail(id: number, at: V3, radar = false): void {
    const trail = radar ? RADAR_TRAIL : TRAIL;
    const cur = new THREE.Vector3(at.x, at.y, at.z);
    const t = this.trails.get(id);
    if (!t) {
      this.trails.set(id, { last: cur, idle: 0 });
      this.smokes.emit(at.x, at.y, at.z, 0, 0, 0, trail);
      return;
    }
    t.idle = 0;
    const d = t.last.distanceTo(cur);
    const n = Math.floor(d / TRAIL_STEP);
    const steps = Math.min(n, 12);
    for (let i = 1; i <= steps; i++) {
      const p = t.last.clone().lerp(cur, (i * TRAIL_STEP) / d);
      this.smokes.emit(p.x, p.y, p.z, 0, 0, 0, trail);
    }
    // Keep the remainder so puffs stay evenly spaced (no beads up close);
    // after a long gap (hidden tab) restart from here.
    if (n > steps) t.last.copy(cur);
    else if (steps > 0) t.last.lerp(cur, (steps * TRAIL_STEP) / d);
  }

  /** The server's burning flares this frame: glow and a smoke trail at each, one per flare. */
  flares(list: readonly { id: number; pos: V3 }[], dtS: number): void {
    const seen = new Set<number>();
    for (const { id, pos } of list) {
      seen.add(id);
      let e = Math.min((this.flareEmit.get(id) ?? FLARE_EMIT_S) + dtS, 4 * FLARE_EMIT_S);
      for (; e >= FLARE_EMIT_S; e -= FLARE_EMIT_S) {
        this.glow.emit(pos.x, pos.y, pos.z, 0, 0, 0, FLARE);
        this.smokes.emit(pos.x, pos.y, pos.z, 0, 0, 0, FLARE_SMOKE);
      }
      this.flareEmit.set(id, e);
    }
    for (const id of this.flareEmit.keys()) if (!seen.has(id)) this.flareEmit.delete(id);
  }

  /** A decoyed missile popping harmlessly at its flare: small orange flash, white puff. */
  puff(at: V3): void {
    this.burst(at, 10, 14, PUFF_FIRE, this.glow);
    this.burst(at, 6, 5, PUFF_SMOKE, this.smokes);
  }

  update(dtS: number): void {
    this.updateTracers(dtS);
    for (const f of this.flashes) {
      if (!f.mesh.visible) continue;
      f.age += dtS;
      const t = f.age / FLASH_S;
      f.mesh.visible = t < 1;
      f.mesh.scale.setScalar(f.size * (0.4 + 0.6 * t));
      (f.mesh.material as THREE.MeshBasicMaterial).opacity = 1 - t;
    }
    for (const [id, t] of this.trails) if ((t.idle += dtS) > TRAIL_GAP_S) this.trails.delete(id);
    this.glow.update(dtS);
    this.smokes.update(dtS);
  }

  private burst(at: V3, n: number, speed: number, l: Look, into: Particles): void {
    for (let i = 0; i < n; i++) {
      const u = Math.random() * 2 - 1;
      const a = Math.random() * Math.PI * 2;
      const r = Math.sqrt(1 - u * u);
      const s = speed * (0.3 + 0.7 * Math.random());
      into.emit(at.x, at.y, at.z, r * Math.cos(a) * s, u * s, r * Math.sin(a) * s, l);
    }
  }

  private updateTracers(dt: number): void {
    let n = 0;
    for (const t of this.tracers) {
      t.life -= dt;
      if (t.life <= 0) continue;
      t.p.addScaledVector(t.v, dt);
      this.tracers[n] = t;
      if (t.v.lengthSq() > 0) this.q.setFromUnitVectors(this.fwd, this.dir.copy(t.v).normalize());
      this.tracerMesh.setMatrixAt(n, this.m.compose(t.p, this.q, this.one));
      this.tracerMesh.setColorAt(n, t.color);
      n++;
    }
    this.tracers.length = n;
    this.tracerMesh.count = n;
    this.tracerMesh.instanceMatrix.needsUpdate = true;
    if (this.tracerMesh.instanceColor) this.tracerMesh.instanceColor.needsUpdate = true;
  }
}
