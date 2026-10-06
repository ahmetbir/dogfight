// Missiles and bombs (extrapolated from the latest snapshot) and power-up crates.
import * as THREE from "three";
import type { BombJSON, MissileJSON, PowerupJSON, Vec3 } from "../net/protocol.ts";
import type { V3 } from "../sim/vec.ts";

const MISSILES = 32;
const BOMBS = 16;
const CRATE_SPIN = 1.2; // rad/s
const CRATE_BOB = 3;    // m

export type TrailSink = { missileTrail(id: number, at: V3, radar?: boolean): void };

export class Props {
  private readonly missiles: THREE.Mesh[] = [];
  private readonly irMat: THREE.Material;
  private readonly radarMat: THREE.Material;
  private readonly bombs: THREE.Mesh[] = [];
  private readonly crates: THREE.Group[] = [];
  private readonly flash: THREE.Sprite;
  private readonly spots: Vec3[];
  private readonly fwd = new THREE.Vector3(0, 0, -1);
  private readonly dir = new THREE.Vector3();

  constructor(scene: THREE.Scene, spots: Vec3[]) {
    this.spots = spots;
    const body = new THREE.CylinderGeometry(0.18, 0.18, 3.6, 6).rotateX(Math.PI / 2);
    const mat = new THREE.MeshLambertMaterial({ color: "#e8e8e8", emissive: "#555555" });
    this.radarMat = new THREE.MeshLambertMaterial({ color: "#d8e6ff", emissive: "#3a5a8a" });
    this.irMat = mat;
    for (let i = 0; i < MISSILES; i++) {
      const m = new THREE.Mesh(body, mat);
      m.visible = false;
      scene.add(m);
      this.missiles.push(m);
    }
    const bomb = new THREE.CylinderGeometry(0.3, 0.3, 2.4, 8).rotateX(Math.PI / 2);
    const bombMat = new THREE.MeshLambertMaterial({ color: "#3a3d40" });
    for (let i = 0; i < BOMBS; i++) {
      const m = new THREE.Mesh(bomb, bombMat);
      m.visible = false;
      scene.add(m);
      this.bombs.push(m);
    }
    const box = new THREE.BoxGeometry(6, 6, 6);
    const crateMat = new THREE.MeshLambertMaterial({ color: "#ffd21f", emissive: "#a07800" });
    const glowMat = new THREE.SpriteMaterial({
      map: glowTexture(), color: "#ffe066", transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    });
    this.flash = new THREE.Sprite(new THREE.SpriteMaterial({
      map: glowMat.map, color: "#ffb347", transparent: true, depthWrite: false,
      blending: THREE.AdditiveBlending, toneMapped: false,
    }));
    this.flash.visible = false;
    scene.add(this.flash);
    for (const s of spots) {
      const g = new THREE.Group();
      const glow = new THREE.Sprite(glowMat);
      glow.scale.set(26, 26, 1);
      g.add(new THREE.Mesh(box, crateMat), glow);
      g.position.set(s[0], s[1], s[2]);
      g.visible = false;
      scene.add(g);
      this.crates.push(g);
    }
  }

  /** Draws missiles at pos + vel·sinceSnapS and feeds their smoke trails. */
  syncMissiles(list: MissileJSON[], sinceSnapS: number, fx: TrailSink): void {
    for (let i = 0; i < this.missiles.length; i++) {
      const m = this.missiles[i];
      const j = list[i];
      m.visible = !!j;
      if (!j) continue;
      const at = { x: j.p[0] + j.v[0] * sinceSnapS, y: j.p[1] + j.v[1] * sinceSnapS, z: j.p[2] + j.v[2] * sinceSnapS };
      m.position.set(at.x, at.y, at.z);
      if (this.dir.set(j.v[0], j.v[1], j.v[2]).lengthSq() > 0) m.quaternion.setFromUnitVectors(this.fwd, this.dir.normalize());
      const radar = j.mk === 1;
      m.material = radar ? this.radarMat : this.irMat;
      fx.missileTrail(j.id, at, radar);
    }
  }

  /** Draws falling bombs at pos + vel·sinceSnapS, nose along the velocity. */
  syncBombs(list: BombJSON[], sinceSnapS: number): void {
    for (let i = 0; i < this.bombs.length; i++) {
      const m = this.bombs[i];
      const j = list[i];
      m.visible = !!j;
      if (!j) continue;
      m.position.set(j.p[0] + j.v[0] * sinceSnapS, j.p[1] + j.v[1] * sinceSnapS, j.p[2] + j.v[2] * sinceSnapS);
      if (this.dir.set(j.v[0], j.v[1], j.v[2]).lengthSq() > 0) m.quaternion.setFromUnitVectors(this.fwd, this.dir.normalize());
    }
  }

  /** Muzzle flash at the given point; null hides it. */
  muzzle(at: V3 | null): void {
    this.flash.visible = !!at;
    if (!at) return;
    this.flash.position.set(at.x, at.y, at.z);
    const k = 2.5 + Math.random() * 1.5;
    this.flash.scale.set(k, k, 1);
  }

  /** Shows available crates spinning and bobbing; tS is seconds. */
  syncPowerups(list: PowerupJSON[], tS: number): void {
    const shown = new Set<number>();
    for (const p of list) if (p.a) shown.add(p.s);
    this.crates.forEach((g, i) => {
      g.visible = shown.has(i);
      if (!g.visible) return;
      g.rotation.y = tS * CRATE_SPIN + i;
      g.position.y = this.spots[i][1] + Math.sin(tS * 1.5 + i) * CRATE_BOB;
    });
  }
}

function glowTexture(): THREE.Texture {
  const c = document.createElement("canvas");
  c.width = c.height = 64;
  const g = c.getContext("2d");
  if (g) {
    const grad = g.createRadialGradient(32, 32, 0, 32, 32, 32);
    grad.addColorStop(0, "rgba(255,255,255,1)");
    grad.addColorStop(0.4, "rgba(255,255,255,0.35)");
    grad.addColorStop(1, "rgba(255,255,255,0)");
    g.fillStyle = grad;
    g.fillRect(0, 0, 64, 64);
  }
  return new THREE.CanvasTexture(c);
}
