// Pure parameter curves and buffer generators for the procedural jet sound.
// No Web Audio here so node tests can check every mapping.
import type { V3 } from "../sim/vec.ts";

export const FLYBY_RANGE_M = 600; // other planes are heard inside this radius
const FLYBY_FULL_M = 400;         // ...at full (panner-attenuated) gain up to here
const SOUND_MS = 343;
const SPOOL_UP_S = 1.5;           // jets spool: N1 lags the throttle
const SPOOL_DOWN_S = 1.1;

const clamp01 = (x: number) => Math.max(0, Math.min(1, x));

/** Engine spool (0 idle … 1 mil) after dt seconds chasing the throttle. */
export function spool(rpm: number, throttle: number, dt: number): number {
  const target = clamp01(throttle);
  if (dt <= 0) return rpm;
  const tau = target > rpm ? SPOOL_UP_S : SPOOL_DOWN_S;
  return rpm + (target - rpm) * (1 - Math.exp(-dt / tau));
}

/** Core roar lowpass: 400 Hz at idle → 6 kHz at mil, exponential. */
export function roarCutoff(rpm: number): number {
  return 400 * Math.pow(15, clamp01(rpm));
}

/** Core roar level (pink noise, rms 0.3 before this gain). */
export function roarGain(rpm: number): number {
  return 0.12 + 0.18 * Math.pow(clamp01(rpm), 1.3);
}

/** Mid "blast" bandpass centre: 300 Hz → 1.2 kHz. */
export function blastFreq(rpm: number): number {
  return 300 + 900 * clamp01(rpm);
}

/** Mid blast level: barely there at idle, the bulk of the roar at mil. */
export function blastGain(rpm: number): number {
  return 0.04 + 0.21 * Math.pow(clamp01(rpm), 1.5);
}

/** Turbine whine: 1.5 kHz at idle → 4.5 kHz at mil. */
export function whineFreq(rpm: number): number {
  return 1500 + 3000 * clamp01(rpm);
}

/** Whine level per partial (two partials). */
export function whineGain(rpm: number): number {
  return 0.016 + 0.01 * clamp01(rpm);
}

/** Air rush bandpass centre: 400 Hz parked → 2.5 kHz at 320 m/s. */
export function windFreq(speed: number): number {
  return 400 + 2100 * clamp01(speed / 320);
}

/** Air rush level: silent below 20 m/s, (v/320)^1.5 above. */
export function windGain(speed: number): number {
  return 0.35 * Math.pow(clamp01((speed - 20) / 300), 1.5);
}

/** Up to k planes closest to ear within FLYBY_RANGE_M, nearest first. */
export function nearest<T extends { pos: V3 }>(ear: V3, planes: readonly T[], k: number): T[] {
  const d2 = (p: V3) => (p.x - ear.x) ** 2 + (p.y - ear.y) ** 2 + (p.z - ear.z) ** 2;
  const r2 = FLYBY_RANGE_M * FLYBY_RANGE_M;
  return planes
    .map((p) => ({ p, d: d2(p.pos) }))
    .filter((e) => e.d <= r2)
    .sort((a, b) => a.d - b.d)
    .slice(0, k)
    .map((e) => e.p);
}

/**
 * Voice slots → plane ids (0: free) for this frame's picks: a plane keeps the
 * voice it had, new planes take free voices in pick order, the rest drop.
 */
export function assign(current: readonly number[], picks: readonly number[]): number[] {
  const want = new Set(picks);
  const out = current.map((id) => (want.has(id) ? id : 0));
  for (const id of picks) {
    if (out.includes(id)) continue;
    const free = out.indexOf(0);
    if (free < 0) break;
    out[free] = id;
  }
  return out;
}

/** Extra flyby gain on top of the panner: 1 to 400 m, smoothstep to 0 at 600 m. */
export function edgeFade(d: number): number {
  const t = clamp01((d - FLYBY_FULL_M) / (FLYBY_RANGE_M - FLYBY_FULL_M));
  return 1 - t * t * (3 - 2 * t);
}

/** Doppler pitch factor for a source heard at ear, clamped to 0.5…2. */
export function doppler(src: V3, srcVel: V3, ear: V3, earVel: V3): number {
  const dx = ear.x - src.x, dy = ear.y - src.y, dz = ear.z - src.z;
  const d = Math.hypot(dx, dy, dz);
  if (d < 1e-3) return 1;
  const vs = (srcVel.x * dx + srcVel.y * dy + srcVel.z * dz) / d; // source closing speed
  const vl = (earVel.x * dx + earVel.y * dy + earVel.z * dz) / d; // listener receding speed
  const den = SOUND_MS - vs;
  if (den <= 0) return 2;
  return Math.max(0.5, Math.min(2, (SOUND_MS - vl) / den));
}

/** World up made perpendicular to fwd (unit); any perpendicular when fwd is vertical. */
export function listenerUp(fwd: V3): V3 {
  const l = Math.hypot(fwd.x, fwd.y, fwd.z) || 1;
  const f = { x: fwd.x / l, y: fwd.y / l, z: fwd.z / l };
  const ref = Math.abs(f.y) > 0.999 ? { x: 0, y: 0, z: -1 } : { x: 0, y: 1, z: 0 };
  const k = f.x * ref.x + f.y * ref.y + f.z * ref.z;
  const u = { x: ref.x - f.x * k, y: ref.y - f.y * k, z: ref.z - f.z * k };
  const m = Math.hypot(u.x, u.y, u.z);
  return { x: u.x / m, y: u.y / m, z: u.z / m };
}

/**
 * n samples of pink noise (Kellet's economy filter), rms 0.3. The last
 * `fade` generated samples are crossfaded into the start so the loop point
 * continues the waveform instead of clicking.
 */
export function pinkNoise(n: number, fade: number, rand: () => number): Float32Array {
  const m = Math.min(fade, n);
  const raw = new Float32Array(n + m);
  let b0 = 0, b1 = 0, b2 = 0;
  for (let i = 0; i < raw.length; i++) {
    const w = rand() * 2 - 1;
    b0 = 0.99765 * b0 + w * 0.099046;
    b1 = 0.963 * b1 + w * 0.2965164;
    b2 = 0.57 * b2 + w * 1.0526913;
    raw[i] = b0 + b1 + b2 + w * 0.1848;
  }
  const out = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    const w = i < m ? i / m : 1;
    out[i] = i < m ? raw[i] * w + raw[n + i] * (1 - w) : raw[i];
  }
  let sq = 0;
  for (const v of out) sq += v * v;
  const k = 0.3 / (Math.sqrt(sq / n) || 1);
  for (let i = 0; i < n; i++) out[i] *= k;
  return out;
}

/** Afterburner crackle: ~35 short noise pops a second (1.5–8 ms, decaying), silence between. */
export function crackle(n: number, sr: number, rand: () => number): Float32Array {
  const out = new Float32Array(n);
  const p = 35 / sr;
  for (let i = 0; i < n; i++) {
    if (rand() >= p) continue;
    const len = Math.floor(sr * (0.0015 + 0.0065 * rand()));
    const amp = 0.3 + 0.7 * rand();
    for (let j = 0; j < len && i + j < n; j++) out[i + j] = amp * Math.exp((-4 * j) / len) * (rand() * 2 - 1);
    i += len;
  }
  return out;
}
