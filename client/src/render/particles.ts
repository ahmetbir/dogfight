// Pooled point particles with per-particle size, color and alpha fade.
import * as THREE from "three";

/** How a particle looks and moves over its life. */
export type Look = {
  life: number;         // seconds
  size: [number, number]; // world diameter at birth and death (m)
  color: THREE.Color;
  alpha: number;        // at birth; fades linearly to 0
  drag: number;         // velocity damping per second (0..)
  lift: number;         // vertical acceleration (m/s², negative = falls)
};

const vertex = /* glsl */ `
attribute float size;
attribute float alpha;
attribute vec3 tint;
uniform float halfH;
varying float vAlpha;
varying vec3 vTint;
#include <fog_pars_vertex>
void main() {
  vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
  gl_Position = projectionMatrix * mvPosition;
  gl_PointSize = size * projectionMatrix[1][1] * halfH / max(-mvPosition.z, 1.0);
  vAlpha = alpha;
  vTint = tint;
  #include <fog_vertex>
}`;

const fragment = /* glsl */ `
varying float vAlpha;
varying vec3 vTint;
#include <fog_pars_fragment>
void main() {
  float d = length(gl_PointCoord - 0.5);
  float a = vAlpha * smoothstep(0.5, 0.15, d);
  if (a < 0.01) discard;
  gl_FragColor = vec4(vTint, a);
  #include <tonemapping_fragment>
  #include <colorspace_fragment>
  #include <fog_fragment>
}`;

/** A fixed-capacity particle pool drawn as one Points object. */
export class Particles {
  readonly points: THREE.Points;
  private readonly cap: number;
  private limit: number; // live capacity ≤ cap (performance mode halves it)
  private n = 0;
  private readonly pos: Float32Array;
  private readonly vel: Float32Array;
  private readonly age: Float32Array;
  private readonly look: Look[] = [];
  private readonly size: Float32Array;
  private readonly alpha: Float32Array;
  private readonly tint: Float32Array;
  private readonly geo = new THREE.BufferGeometry();

  constructor(cap: number, additive: boolean) {
    this.cap = this.limit = cap;
    this.pos = new Float32Array(cap * 3);
    this.vel = new Float32Array(cap * 3);
    this.age = new Float32Array(cap);
    this.size = new Float32Array(cap);
    this.alpha = new Float32Array(cap);
    this.tint = new Float32Array(cap * 3);
    this.geo.setAttribute("position", new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("size", new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("alpha", new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    this.geo.setAttribute("tint", new THREE.BufferAttribute(this.tint, 3).setUsage(THREE.DynamicDrawUsage));
    this.geo.setDrawRange(0, 0);
    const mat = new THREE.ShaderMaterial({
      uniforms: THREE.UniformsUtils.merge([THREE.UniformsLib.fog, { halfH: { value: 360 } }]),
      vertexShader: vertex,
      fragmentShader: fragment,
      transparent: true,
      depthWrite: false,
      fog: !additive, // fogging toward a bright color would brighten additive glow
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
    });
    this.points = new THREE.Points(this.geo, mat);
    this.points.frustumCulled = false;
    const drawSize = new THREE.Vector2();
    this.points.onBeforeRender = (renderer) => {
      mat.uniforms.halfH.value = renderer.getDrawingBufferSize(drawSize).y / 2;
    };
  }

  /** Live capacity, clamped to the allocated pool; particles above it fade out on their own. */
  setLimit(n: number): void {
    this.limit = Math.max(1, Math.min(this.cap, Math.floor(n)));
  }

  /** Spawns one particle; when the pool is full the oldest slot is reused. */
  emit(x: number, y: number, z: number, vx: number, vy: number, vz: number, look: Look): void {
    let i = this.n;
    if (i < this.limit) this.n++;
    else i = this.oldest();
    this.pos.set([x, y, z], 3 * i);
    this.vel.set([vx, vy, vz], 3 * i);
    this.age[i] = 0;
    this.look[i] = look;
    this.tint.set([look.color.r, look.color.g, look.color.b], 3 * i);
    this.size[i] = look.size[0];
    this.alpha[i] = look.alpha;
  }

  update(dt: number): void {
    let i = 0;
    while (i < this.n) {
      const l = this.look[i];
      this.age[i] += dt;
      const t = this.age[i] / l.life;
      if (t >= 1) {
        this.remove(i);
        continue;
      }
      const damp = Math.max(0, 1 - l.drag * dt);
      this.vel[3 * i] *= damp;
      this.vel[3 * i + 1] = this.vel[3 * i + 1] * damp + l.lift * dt;
      this.vel[3 * i + 2] *= damp;
      for (let k = 0; k < 3; k++) this.pos[3 * i + k] += this.vel[3 * i + k] * dt;
      this.size[i] = l.size[0] + (l.size[1] - l.size[0]) * t;
      this.alpha[i] = l.alpha * (1 - t);
      i++;
    }
    this.geo.setDrawRange(0, this.n);
    for (const name of ["position", "size", "alpha", "tint"]) this.geo.attributes[name].needsUpdate = true;
  }

  get count(): number {
    return this.n;
  }

  private oldest(): number {
    let best = 0;
    for (let i = 1; i < this.n; i++) if (this.age[i] / this.look[i].life > this.age[best] / this.look[best].life) best = i;
    return best;
  }

  /** Swap-removes slot i with the last live particle. */
  private remove(i: number): void {
    const j = --this.n;
    if (i === j) return;
    this.pos.copyWithin(3 * i, 3 * j, 3 * j + 3);
    this.vel.copyWithin(3 * i, 3 * j, 3 * j + 3);
    this.tint.copyWithin(3 * i, 3 * j, 3 * j + 3);
    this.age[i] = this.age[j];
    this.size[i] = this.size[j];
    this.alpha[i] = this.alpha[j];
    this.look[i] = this.look[j];
  }
}
