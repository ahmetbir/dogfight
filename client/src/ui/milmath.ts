// Pure maths behind the Military HUD style: heading tape, pitch ladder, flight
// path marker, the missile cone ring and the readouts. World axes as in sim:
// Y up, north −Z, east +X. No DOM here; milhud.ts projects and draws.
import { add, cross, len, norm, scale, type V3 } from "../sim/vec.ts";

const DEG = Math.PI / 180;
const UP: V3 = { x: 0, y: 1, z: 0 };

/** Compass heading of a direction in degrees, 0..360 (0 north, 90 east); the nose's when level. */
export function headingDeg(d: V3): number {
  const h = Math.atan2(d.x, -d.z) / DEG;
  return h < 0 ? h + 360 : h;
}

/**
 * The heading of a direction that may point (nearly) straight up or down,
 * where atan2 of a vanishing horizontal part jumps arbitrarily: there the
 * heading the plane pulled through (behind its canopy when climbing, ahead
 * of it diving), which moves steadily with the body's up axis.
 */
export function steadyHeading(d: V3, up: V3): number {
  if (Math.hypot(d.x, d.z) > 1e-3) return headingDeg(d);
  return headingDeg(d.y > 0 ? scale(up, -1) : up);
}

/** Elevation of a direction above the horizon in degrees, −90..90. */
export function pitchDeg(d: V3): number {
  const l = len(d);
  return l < 1e-9 ? 0 : Math.asin(Math.max(-1, Math.min(1, d.y / l))) / DEG;
}

/** Unit direction for a compass heading and an elevation, both in degrees. */
export function dirOf(headingDegs: number, pitchDegs: number): V3 {
  const h = headingDegs * DEG;
  const p = pitchDegs * DEG;
  return { x: Math.sin(h) * Math.cos(p), y: Math.sin(p), z: -Math.cos(h) * Math.cos(p) };
}

/** A tape mark: its heading (0..359), its offset from the centre in degrees (negative: left), a label every 10°. */
export type TapeMark = { deg: number; off: number; major: boolean; label: string };

/**
 * The heading tape's marks within ±half degrees of heading, every step
 * degrees, left to right. Majors fall on tens and carry the heading in tens
 * of degrees, two digits ("00", "09", "35"), as a fighter's tape does. With
 * out the marks are written into it (and its objects reused) every frame.
 */
export function tapeMarks(heading: number, half: number, step = 5, out: TapeMark[] = []): TapeMark[] {
  let n = 0;
  const first = Math.ceil((heading - half) / step) * step;
  for (let a = first; a <= heading + half + 1e-9; a += step) {
    const deg = ((a % 360) + 360) % 360;
    const major = deg % 10 === 0;
    const m = (out[n] ??= { deg: 0, off: 0, major: false, label: "" });
    m.deg = deg;
    m.off = a - heading;
    m.major = major;
    m.label = major ? TENS[deg / 10] : "";
    n++;
  }
  out.length = n;
  return out;
}

const TENS = Array.from({ length: 36 }, (_, i) => String(i).padStart(2, "0"));

/** "087": the boxed heading under the tape. */
export function headingText(heading: number): string {
  return String(Math.round(heading) % 360).padStart(3, "0");
}

/** Below this speed (m/s) the flight path marker has no meaning (parked, taxiing slowly). */
export const FPM_MIN_SPEED = 5;

/** The flight path marker's direction: where the plane is going; null when (nearly) stopped. */
export function fpmDir(vel: V3): V3 | null {
  return len(vel) < FPM_MIN_SPEED ? null : norm(vel);
}

/**
 * The azimuth the ladder hangs on: the flight path's heading, or the nose's
 * when slow. Pointing straight up or down it has none; then the heading the
 * plane pulled through: behind its canopy when climbing, ahead of it diving.
 */
export function ladderHeading(vel: V3, fwd: V3, up: V3): number {
  return steadyHeading(fpmDir(vel) ?? fwd, up);
}

/** One rung: two bars either side of the gap, each from its inner to its outer end, and the end ticks toward the horizon. */
export type Rung = {
  pitch: number;
  left: [V3, V3];   // inner, outer
  right: [V3, V3];  // inner, outer
  tickL: V3;        // the left bar's outer end moved toward the horizon (a tick from left[1] to here)
  tickR: V3;
};

/** Rung geometry in degrees. The horizon line is wider and has no ticks. */
export const RUNG = { half: 3.6, gap: 1.6, tick: 0.6, horizonHalf: 7 };

/**
 * Rung at pitch (deg) on azimuth heading (deg): unit directions of its bar
 * ends. A bar is a great circle through the rung's centre, square to the
 * azimuth, so it keeps its angular width at any pitch. With out the result
 * is written into it (and its vectors reused) every frame.
 */
export function rung(heading: number, pitch: number, out?: Rung): Rung {
  const r = out ?? { pitch, left: [v0(), v0()], right: [v0(), v0()], tickL: v0(), tickR: v0() };
  r.pitch = pitch;
  const h = heading * DEG;
  const rx = Math.cos(h), rz = Math.sin(h); // level, square to the azimuth (dirOf(heading + 90, 0))
  const half = pitch === 0 ? RUNG.horizonHalf : RUNG.half;
  const toward = pitch > 0 ? -RUNG.tick : RUNG.tick;
  const p = pitch * DEG, q = (pitch + toward) * DEG;
  // centre c = dirOf(heading, pitch); a bar end is norm(c + right·tan(deg))
  const put = (o: V3, pr: number, deg: number) => {
    const t = Math.tan(deg * DEG);
    const x = Math.sin(h) * Math.cos(pr) + rx * t, y = Math.sin(pr), z = -Math.cos(h) * Math.cos(pr) + rz * t;
    const l = Math.sqrt(x * x + y * y + z * z);
    o.x = x / l; o.y = y / l; o.z = z / l;
  };
  put(r.left[0], p, -RUNG.gap);
  put(r.left[1], p, -half);
  put(r.right[0], p, RUNG.gap);
  put(r.right[1], p, half);
  put(r.tickL, q, -half);
  put(r.tickR, q, half);
  return r;
}

const v0 = (): V3 => ({ x: 0, y: 0, z: 0 });

/** Rung spacing: 5° within NEAR_HORIZON of the horizon, 10° beyond (a calm ladder away from level flight). */
export const NEAR_HORIZON = 10;

/**
 * The rungs within ±span of centre (deg), inside −80..80 (no rungs near the
 * poles): every 5° up to NEAR_HORIZON from the horizon, every 10° beyond.
 */
export function ladderPitches(centre: number, span: number): number[] {
  const out: number[] = [];
  const lo = Math.max(-80, Math.ceil((centre - span) / 5) * 5);
  const hi = Math.min(80, Math.floor((centre + span) / 5) * 5);
  for (let p = lo; p <= hi; p += 5) {
    if (Math.abs(p) > NEAR_HORIZON && p % 10 !== 0) continue;
    out.push(p === 0 ? 0 : p); // no -0
  }
  return out;
}

/** A rung's opacity in the HUD's window: 1 on the flight path, fading to 0 at ±span. */
export function rungFade(pitch: number, centre: number, span: number): number {
  return Math.max(0, Math.min(1, 1 - Math.abs(pitch - centre) / span));
}

/** A rung's label: the pitch in degrees, negative ones signed. */
export function rungLabel(pitch: number): string {
  return String(Math.round(pitch));
}

/** n unit directions on a cone of half angle rad around axis (the missile seeker's field); with out, written into it (its vectors reused). */
export function coneRing(axis: V3, rad: number, n = 32, out: V3[] = []): V3[] {
  const a = norm(axis);
  const ref = Math.abs(a.y) < 0.9 ? UP : { x: 1, y: 0, z: 0 };
  const u = norm(cross(a, ref));
  const w = cross(u, a);
  const t = Math.tan(rad);
  for (let i = 0; i < n; i++) {
    const th = (i / n) * Math.PI * 2;
    const c = t * Math.cos(th), s = t * Math.sin(th);
    const x = a.x + u.x * c + w.x * s, y = a.y + u.y * c + w.y * s, z = a.z + u.z * c + w.z * s;
    const l = Math.sqrt(x * x + y * y + z * z);
    const o = (out[i] ??= v0());
    o.x = x / l; o.y = y / l; o.z = z / l;
  }
  out.length = n;
  return out;
}

/** Speed of sound (m/s) at altitude (m), ISA troposphere, constant above 11 km. */
export function soundSpeed(alt: number): number {
  const T = Math.max(216.65, 288.15 - 0.0065 * Math.max(0, alt));
  return Math.sqrt(1.4 * 287.053 * T);
}

/** "0.84": the Mach number, two decimals. */
export function machText(speed: number, alt: number): string {
  return (speed / soundSpeed(alt)).toFixed(2);
}

export type SpeedUnit = "kmh" | "kt";

/** Speed (m/s) in the display unit, rounded. */
export function speedIn(ms: number, unit: SpeedUnit): number {
  return Math.round(unit === "kt" ? ms * 1.943844 : ms * 3.6);
}

/** "+12" / "-4" / "0": vertical speed in m/s. */
export function vsText(vy: number): string {
  const v = Math.round(vy);
  return v > 0 ? `+${v}` : String(v);
}

/** "4.2": load factor, one decimal. */
export function gText(g: number): string {
  return g.toFixed(1);
}

/** 0..1: how much of the gun's reach (m) a target at dist (m) uses; the pipper's range arc. */
export function rangeArc(dist: number, reach: number): number {
  return reach <= 0 ? 0 : Math.max(0, Math.min(1, dist / reach));
}

/** "1.2" (km, one decimal) under 10 km, else whole km: the designator's range readout. */
export function kmText(m: number): string {
  const km = m / 1000;
  return km < 10 ? km.toFixed(1) : String(Math.round(km));
}

/** The style's colours: luminous, like light on a combiner glass. The core of every glyph and line is always this tone. */
export const MIL_PALETTE = { green: "#6dff9a", amber: "#ffc54d" } as const;
export type MilColor = keyof typeof MIL_PALETTE;

/**
 * How a symbol is drawn over its backdrop: the core colour (never changes),
 * a soft shadow behind it (colour and blur in px) and the alpha of the faint
 * dark backing behind the readout boxes and the tape (0: none).
 */
export type Ink = { core: string; shadow: string; blur: number; backing: number; passes: number };

/** 0 over a dark backdrop … 1 over a bright one (backdrop luma 0..1; unknown counts as dark). */
export function brightness(luma: number | null): number {
  if (luma === null) return 0;
  const t = Math.max(0, Math.min(1, (luma - 0.4) / 0.25));
  return t * t * (3 - 2 * t);
}

/**
 * The ink for a backdrop. The core stays the bright tone; only what is behind
 * it adapts: over dark backdrops a faint glow of the core colour, over bright
 * sky and cloud a soft low-opacity dark shadow (drawn twice under text, where
 * it is thinnest) and a faint tinted backing behind the readouts.
 */
export function inkFor(color: MilColor, luma: number | null): Ink {
  const t = brightness(luma);
  const core = MIL_PALETTE[color];
  if (t < 0.35) return { core, shadow: hexA(core, 0.55 * (1 - t / 0.35)), blur: 4, backing: 0, passes: 1 };
  return { core, shadow: `rgba(0,0,0,${(0.3 + 0.15 * t).toFixed(2)})`, blur: 3 + 2 * t, backing: 0.2 * t, passes: t > 0.6 ? 2 : 1 };
}

/** "#rrggbb" with an alpha as "rgba(…)". */
export function hexA(hex: string, a: number): string {
  const ch = (i: number) => parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16);
  return `rgba(${ch(0)},${ch(1)},${ch(2)},${a.toFixed(2)})`;
}

/** WCAG relative luminance of "#rrggbb" (0..1). */
export function relLuminance(hex: string): number {
  const lin = (i: number) => {
    const c = parseInt(hex.slice(1 + 2 * i, 3 + 2 * i), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * lin(0) + 0.7152 * lin(1) + 0.0722 * lin(2);
}

/** WCAG contrast ratio between two colours (1..21). */
export function contrast(a: string, b: string): number {
  const la = relLuminance(a), lb = relLuminance(b);
  return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
}
