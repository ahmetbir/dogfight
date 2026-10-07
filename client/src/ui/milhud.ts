// The Military HUD style: one 2D canvas over the game, redrawn once per frame
// in one colour, thin lines and a monospace font. Heading tape on top; speed
// and altitude boxes left and right with G, Mach, throttle and vertical speed
// beneath; flight path marker and a pitch ladder projected into the world (so
// they roll with the horizon) in a narrow window that keeps the centre calm;
// gun pipper, the seeker's cone while a lock builds, target designator; the
// weapons block in a corner. Lines and glyphs are always the luminous tone;
// what lies behind them (render/luma.ts) sets only their shadow: a faint glow
// over sea, ground and night, a soft dark shadow over bright sky, cloud and
// snow, plus a faint tinted backing behind the readouts there (never behind
// the centre symbols). The DOM parts of the HUD (mission text, radar,
// warnings) are restyled by CSS.
import type { HudView } from "../game/events.ts";
import { regionLuma } from "../render/luma.ts";
import { add, cross, len, scale, sub, type V3 } from "../sim/vec.ts";
import { rangeFill, LOCK_HALF_ANGLE } from "./lockinfo.ts";
import { ammoParts, ranges } from "./loadout.ts";
import {
  coneRing, dirOf, fpmDir, gText, headingDeg, headingText, inkFor, kmText, ladderHeading, ladderPitches, machText, MIL_PALETTE,
  pitchDeg, rangeArc, rung, rungFade, rungLabel, speedIn, tapeMarks, vsText, type Ink, type MilColor, type SpeedUnit,
} from "./milmath.ts";
import { boxSize, leadMark, noseMark, type Pt, type ReticleView } from "./reticle.ts";

export type { MilColor };

/** The style's colour per choice (CSS: the DOM parts). */
export const MIL_COLORS: Record<MilColor, string> = MIL_PALETTE;

const R = 500;            // m: every projected mark sits this far out, as the classic nose cross does
const TAPE_HALF = 25;     // deg either side of the heading tape's centre
const LADDER_SPAN = 12;   // deg: the ladder's window either side of the flight path (it fades out at the edge)
const LADDER_ALPHA = 0.8; // the ladder is secondary: a touch dimmer than the readouts
const GUN_REACH = 2000;   // m: the pipper's range arc is full here (the HUD's gun range)
const TEXT_MS = 100;      // readouts refresh at 10 Hz so the digits do not shimmer
const FONT = "ui-monospace, SFMono-Regular, Menlo, Consolas, 'Liberation Mono', monospace";

/** glow: the faint glow over dark backdrops (off in performance mode). */
export type MilStyle = { color: MilColor; unit: SpeedUnit; glow: boolean };

/** The readouts, rebuilt at 10 Hz. */
type Texts = {
  speed: string; alt: string; heading: string;
  left: string[]; right: string[]; weapons: { text: string; blink?: boolean; bar?: number }[];
};

export class MilHud {
  readonly el: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private style: MilStyle = { color: "green", unit: "kmh", glow: true };
  private w = 0;
  private h = 0;
  private dpr = 1;
  private texts: Texts | null = null;
  private textAt = 0;
  private drawn = false;

  constructor() {
    this.el = document.createElement("canvas");
    this.el.className = "mil-hud";
    this.g = this.el.getContext("2d");
    // The size comes from the observer, never from a layout read in the frame.
    const fit = (w: number, h: number) => {
      this.w = w;
      this.h = h;
    };
    if (typeof ResizeObserver === "function") {
      new ResizeObserver((es) => {
        const r = es[es.length - 1]?.contentRect;
        if (r) fit(r.width, r.height);
      }).observe(this.el);
    } else {
      fit(window.innerWidth, window.innerHeight);
    }
  }

  setStyle(s: MilStyle): void {
    this.style = s;
    this.texts = null;
  }

  /** Clears the canvas (style switched off, waiting, down). */
  clear(): void {
    if (!this.drawn || !this.g) return;
    this.g.setTransform(1, 0, 0, 1, 0, 0);
    this.g.clearRect(0, 0, this.el.width, this.el.height);
    this.drawn = false;
  }

  draw(v: HudView, rv: ReticleView, now = performance.now()): void {
    const g = this.g;
    if (!g || this.w === 0 || this.h === 0) return;
    if (!v.alive) {
      this.clear();
      return;
    }
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const bw = Math.round(this.w * dpr), bh = Math.round(this.h * dpr);
    if (this.el.width !== bw || this.el.height !== bh || dpr !== this.dpr) {
      this.el.width = bw;
      this.el.height = bh;
      this.dpr = dpr;
    }
    if (!this.texts || now - this.textAt >= TEXT_MS) {
      this.texts = readouts(v, this.style.unit);
      this.textAt = now;
    }
    const L = layout(this.w, this.h, v.scheme === "touch");
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    g.clearRect(0, 0, this.w, this.h);
    g.lineJoin = g.lineCap = "round";
    const grid = v.backdrop;
    const W = this.w, H = this.h;
    const pen = new Pen(g, L.fs, dpr, this.style.glow, (x0, y0, x1, y1) =>
      inkFor(this.style.color, grid ? regionLuma(grid, x0 / W, y0 / H, x1 / W, y1 / H) : null));
    const blink = Math.floor(now / 250) % 2 === 0;

    this.tape(pen, L, v);
    this.boxes(pen, L, this.texts);
    this.weapons(pen, L, this.texts, blink);

    // Projected symbology, clipped to the HUD's field between the boxes and kept off my own plane.
    const proj = (d: V3): Pt | null => v.project(add(v.pos, scale(d, R)));
    const nose = v.project(noseMark(v.pos, v.fwd));
    const upPt = v.project(add(noseMark(v.pos, v.fwd), scale(v.up, 20)));
    const upS = nose && upPt ? unit2(upPt.x - nose.x, upPt.y - nose.y) : { x: 0, y: -1 };
    const fd = fpmDir(v.vel);
    const fpm = fd ? proj(fd) : null;
    g.save();
    g.beginPath();
    g.rect(L.clip.x, L.clip.y, L.clip.w, L.clip.h);
    const own = planeHole(v, upS, L.fs);
    if (own) g.ellipse(own.x, own.y, own.rx, own.ry, own.rot, 0, Math.PI * 2);
    g.clip("evenodd");
    this.ladder(pen, v, proj);
    if (rv.lock && !rv.lock.locked && nose) { // the seeker's cone while a lock builds
      pen.around(nose, L.fs * 8);
      g.globalAlpha = 0.45;
      pen.polyline(coneRing(v.fwd, LOCK_HALF_ANGLE).map(proj), true, [3, 6]);
      g.globalAlpha = 1;
    }
    g.restore();
    // One central aiming symbol: the FPM. The waterline (the nose) and the mouse aim show only where they part from it.
    if (fpm) {
      pen.around(fpm, L.fs * 1.6);
      pen.fpm(fpm, upS);
    }
    const apart = (q: Pt | null, d: number) => !!q && (!fpm || Math.hypot(q.x - fpm.x, q.y - fpm.y) > d);
    if (apart(nose, L.fs * 1.8)) {
      pen.around(nose!, L.fs * 2);
      g.globalAlpha = 0.7;
      pen.waterline(nose!, upS);
      g.globalAlpha = 1;
    }
    const aim = v.aimDir ? proj(v.aimDir) : null;
    if (apart(aim, L.fs * 1.2)) {
      pen.around(aim!, L.fs);
      g.globalAlpha = 0.8;
      pen.ring(aim!, L.fs * 0.55);
      g.globalAlpha = 1;
    }
    this.pipper(pen, v, rv);
    this.designator(pen, rv, blink);
    this.drawn = true;
  }

  private tape(p: Pen, L: Layout, v: HudView): void {
    const hdg = headingDeg(v.fwd);
    const ppd = L.tapeHalf / TAPE_HALF;
    const yTick = L.tapeY + p.fs + 3;
    const yc = yTick + 10;
    const bw = p.fs * 3, bh = p.fs + 7;
    p.region(L.cx - L.tapeHalf, L.tapeY, L.cx + L.tapeHalf, yc + 8 + bh);
    p.backing(L.cx - L.tapeHalf - 8, L.tapeY - 4, L.tapeHalf * 2 + 16, yTick + 10 - L.tapeY);
    p.backing(L.cx - bw / 2 - 3, yc + 5, bw + 6, bh + 6);
    const marks = tapeMarks(hdg, TAPE_HALF);
    p.stroke((g) => {
      for (const m of marks) {
        const x = L.cx + m.off * ppd;
        g.moveTo(x, yTick);
        g.lineTo(x, yTick + (m.major ? 7 : 4));
      }
      // the caret
      g.moveTo(L.cx - 4, yc + 5); g.lineTo(L.cx, yc); g.lineTo(L.cx + 4, yc + 5);
      g.rect(L.cx - bw / 2, yc + 8, bw, bh);
    });
    for (const m of marks) {
      if (m.major && Math.abs(m.off) < TAPE_HALF - 2) p.text(m.label, L.cx + m.off * ppd, L.tapeY, "center", "top");
    }
    p.text(this.texts?.heading ?? "", L.cx, yc + 8 + bh / 2 + 0.5, "center", "middle", 1.15);
  }

  private boxes(p: Pen, L: Layout, t: Texts): void {
    const bw = p.fs * 5, bh = p.fs + 11;
    const box = (x: number, value: string, label: string, rows: string[], right: boolean) => {
      const edge = right ? x + bw / 2 : x - bw / 2;
      const top = L.boxY - bh / 2 - p.fs - 8, bottom = L.boxY + bh / 2 + rows.length * (p.fs + 4) + 8;
      p.region(x - bw / 2 - p.fs, top, x + bw / 2 + p.fs, bottom);
      p.backing(x - bw / 2 - 6, top, bw + 12, bottom - top);
      p.text(label, edge, L.boxY - bh / 2 - 4, right ? "right" : "left", "bottom");
      p.stroke((g) => g.rect(x - bw / 2, L.boxY - bh / 2, bw, bh));
      p.text(value, right ? edge - 6 : edge + 6, L.boxY + 1, right ? "right" : "left", "middle", 1.3);
      rows.forEach((r, i) => p.text(r, edge, L.boxY + bh / 2 + 6 + i * (p.fs + 4), right ? "right" : "left", "top"));
    };
    box(L.cx - L.boxDx, t.speed, this.style.unit === "kt" ? "KT" : "KM/H", t.left, true);
    box(L.cx + L.boxDx, t.alt, "ALT M", t.right, false);
  }

  private weapons(p: Pen, L: Layout, t: Texts, blink: boolean): void {
    const lh = p.fs + 4;
    const y0 = L.wpnTop ?? L.h - L.wpnBottom - t.weapons.length * lh;
    p.region(L.wpnX - 4, y0 - 4, L.wpnX + p.fs * 10, y0 + t.weapons.length * lh + 4);
    p.backing(L.wpnX - 6, y0 - 5, p.fs * 10, t.weapons.length * lh + 8);
    t.weapons.forEach((r, i) => {
      if (r.blink && !blink) return;
      const y = y0 + i * lh;
      p.text(r.text, L.wpnX, y, "left", "top");
      if (r.bar === undefined) return;
      const x = L.wpnX + p.fs * 4.6, w = p.fs * 4.5;
      p.stroke((g) => g.rect(x, y + 3, w, p.fs - 5));
      p.fill((g) => g.rect(x, y + 3, w * Math.max(0, Math.min(1, r.bar ?? 0)), p.fs - 5));
    });
  }

  /** The ladder in a window round the flight path: rungs fade out toward its edges; labels small, at the right ends. */
  private ladder(p: Pen, v: HudView, proj: (d: V3) => Pt | null): void {
    const az = ladderHeading(v.vel, v.fwd, v.up);
    const centre = pitchDeg(fpmDir(v.vel) ?? v.fwd);
    const g = p.g;
    for (const pitch of ladderPitches(centre, LADDER_SPAN)) {
      const fade = rungFade(pitch, centre, LADDER_SPAN);
      if (fade <= 0.05) continue;
      const r = rung(az, pitch);
      const li = proj(r.left[0]), lo = proj(r.left[1]), ri = proj(r.right[0]), ro = proj(r.right[1]);
      const mid = proj(dirOf(az, pitch));
      if (!li || !lo || !ri || !ro || !mid) continue;
      p.around(mid, Math.hypot(ro.x - mid.x, ro.y - mid.y) + p.fs);
      g.globalAlpha = LADDER_ALPHA * fade;
      const tl = pitch === 0 ? null : proj(r.tickL), tr = pitch === 0 ? null : proj(r.tickR);
      p.stroke((c) => {
        c.moveTo(li.x, li.y); c.lineTo(lo.x, lo.y);
        c.moveTo(ri.x, ri.y); c.lineTo(ro.x, ro.y);
      }, 1, pitch < 0 ? [5, 4] : undefined);
      if (tl || tr) {
        p.stroke((c) => {
          if (tl) { c.moveTo(lo.x, lo.y); c.lineTo(tl.x, tl.y); }
          if (tr) { c.moveTo(ro.x, ro.y); c.lineTo(tr.x, tr.y); }
        });
      }
      if (pitch !== 0) {
        const out = unit2(ro.x - ri.x, ro.y - ri.y);
        p.text(rungLabel(pitch), ro.x + out.x * p.fs * 1.1, ro.y + out.y * p.fs * 1.1, "center", "middle", 0.85);
      }
    }
    g.globalAlpha = 1;
  }

  /** Gun pipper: a ring with a centre dot on the lead point, its range arc unwinding as the target nears. */
  private pipper(p: Pen, v: HudView, rv: ReticleView): void {
    if (!rv.lead) return;
    const mark = leadMark({ pos: v.pos, vel: v.vel }, rv.lead);
    const at = mark ? v.project(mark) : null;
    if (!at) return;
    const r = p.fs * 1.6;
    p.around(at, r * 1.5);
    p.ring(at, r);
    p.fill((g) => g.arc(at.x, at.y, 1.5, 0, Math.PI * 2));
    const d = len(sub(rv.lead.pos, v.pos));
    const f = rangeArc(d, GUN_REACH);
    if (f > 0) p.stroke((g) => g.arc(at.x, at.y, r + 3, -Math.PI / 2, -Math.PI / 2 + f * Math.PI * 2), 2.5);
    p.text(kmText(d), at.x + r + 6, at.y + r, "left", "top");
  }

  /** Target designator: a diamond that closes as the lock builds, filled once locked; range staple and readout beside it. */
  private designator(p: Pen, rv: ReticleView, blink: boolean): void {
    const k = rv.lock;
    const at = k ? rv.project(k.pos) : null;
    if (!k || !at) return;
    const g = p.g;
    const s = (boxSize(k.locked ? 1 : k.progress) / 2) * 0.85;
    p.around(at, s + p.fs);
    const diamond = (c: CanvasRenderingContext2D) => {
      c.moveTo(at.x, at.y - s); c.lineTo(at.x + s, at.y); c.lineTo(at.x, at.y + s); c.lineTo(at.x - s, at.y);
      c.closePath();
    };
    if (k.locked) {
      g.globalAlpha = 0.3;
      p.fill(diamond);
      g.globalAlpha = 1;
    }
    p.stroke(diamond, k.locked ? 1.5 : 1, k.kind === "radar" ? [5, 3] : undefined);
    if (k.locked) p.text("LOCK", at.x, at.y - s - 5, "center", "bottom");
    const x = at.x + s + 8;
    p.text(k.kind === "radar" ? "RDR" : "IR", x, at.y - 2, "left", "bottom");
    p.text(kmText(k.dist), x, at.y + 2, "left", "top");
    // range staple: the lock range as a short bar, filled to the target's share of it
    const fill = rangeFill(k.dist, k.range);
    if (fill >= 1 && !blink) return;
    const bw = p.fs * 3.2, y = at.y + s + 6;
    p.stroke((c) => c.rect(at.x - bw / 2, y, bw, 3));
    p.fill((c) => c.rect(at.x - bw / 2, y, bw * fill, 3));
  }
}

/** Pixel layout for a viewport; touch keeps the classic touch areas clear. */
type Layout = {
  w: number; h: number; fs: number; cx: number;
  tapeY: number; tapeHalf: number;
  boxY: number; boxDx: number;
  wpnX: number; wpnTop: number | null; wpnBottom: number;
  clip: { x: number; y: number; w: number; h: number };
};

export function layout(w: number, h: number, touch: boolean): Layout {
  const compact = w <= 700 || h <= 500;
  const fs = Math.round(Math.max(10, Math.min(13, Math.min(w, h * 1.6) * 0.009)));
  const tapeY = compact ? 6 : 14;
  const tapeHalf = Math.max(100, Math.min(200, w * 0.15));
  // touch on a phone: the boxes stay inside the weapons block (top right) and clear of the throttle strip (left)
  const boxDx = Math.max(150, Math.min(w * (touch && !compact ? 0.36 : touch ? 0.3 : 0.29), 520));
  const boxY = Math.round(h * (compact ? 0.47 : 0.45));
  const top = Math.max(tapeY + fs * 3 + 30, boxY - h * 0.3);
  const bottom = Math.min(h * (compact ? 0.86 : 0.84), boxY + h * 0.3);
  const inner = boxDx - fs * 3.2;
  const wpnW = fs * 12;
  return {
    w, h, fs, cx: w / 2, tapeY, tapeHalf, boxY, boxDx,
    // touch: the weapons block sits right, under the kill feed, above the buttons (as the classic right panel)
    wpnX: w - wpnW - (compact ? 10 : 22), wpnTop: touch ? (compact ? 92 : 110) : null, wpnBottom: compact ? 12 : 22,
    clip: { x: w / 2 - inner, y: top, w: inner * 2, h: Math.max(0, bottom - top) },
  };
}

/** The readouts for a view, in the display unit. */
export function readouts(v: HudView, unit: SpeedUnit): Texts {
  const pad = (label: string, value: string) => `${label.padEnd(3)}${value.padStart(5)}`;
  const left = [pad("G", gText(v.gLoad)), pad("M", machText(v.speed, v.alt)), pad("THR", String(Math.round(v.th * 100)))];
  if (v.abLocked) left.push("AB HOT");
  else if (v.ab) left.push(`AB ${String(Math.round(v.abHeat * 100)).padStart(3)}%`);
  const right = [pad("VS", vsText(v.vel.y))];
  if (v.gear || v.gearWanted) right.push(v.gear === v.gearWanted ? "GEAR" : "GEAR ..");
  if (v.brake) right.push("BRAKE");
  const weapons: Texts["weapons"] = [];
  const parts = ammoParts(v.missiles, v.radars, v.loadout, v.fires);
  weapons.push({ text: parts.map((x) => (x.on && parts.length > 1 ? `[${short(x.text)}]` : short(x.text))).join(" ") });
  weapons.push({ text: `RNG ${rangeKm(v)}` });
  weapons.push({ text: `FLR ${v.flares}` });
  weapons.push(v.overheated ? { text: "GUN HOT", blink: true } : { text: "GUN", bar: Math.min(1, v.heat) });
  const hp = Math.max(0, v.hp / Math.max(1, v.maxHP));
  weapons.push({ text: `HP ${String(Math.max(0, Math.round(v.hp))).padStart(3)}`, bar: hp, blink: hp < 0.35 });
  if (v.baseMode) weapons.push({ text: `BOMB ${v.bombs}` });
  if (v.rearm > 0) weapons.push({ text: `REARM ${Math.round(v.rearm * 100)}%` });
  const dmg = (["engine", "controls", "avionics"] as const).filter((k) => v.damage[k] > 0);
  if (dmg.length) {
    weapons.push({ text: dmg.map((k) => DMG[k] + (v.damage[k] >= 2 ? "!" : "")).join(" "), blink: dmg.some((k) => v.damage[k] >= 2) });
  }
  return {
    speed: String(speedIn(v.speed, unit)),
    alt: String(Math.max(0, Math.round(v.alt))),
    heading: headingText(headingDeg(v.fwd)),
    left, right, weapons,
  };
}

const DMG = { engine: "ENG", controls: "CTL", avionics: "AVN" } as const;

/** "IR 2" stays, "RADAR 1" → "RDR 1": the HUD's three-letter words. */
function short(s: string): string {
  return s.replace("RADAR", "RDR");
}

/** The picked missile's lock range in km ("4.5", or "4.5/9.0" with both kinds and no pick). */
function rangeKm(v: HudView): string {
  if (v.lockRange <= 0) return "--";
  const r = ranges(v.lockRange);
  if (v.loadout === "radar") return kmText(r.radar);
  if (v.loadout === "mixed") return v.picked ? kmText(r[v.fires]) : `${kmText(r.ir)}/${kmText(r.radar)}`;
  return kmText(r.ir);
}

/**
 * The ellipse my own plane covers on screen in the chase view (its centre,
 * radii and rotation by the wings' screen angle); null when off screen.
 */
function planeHole(v: HudView, upS: Pt, fs: number): { x: number; y: number; rx: number; ry: number; rot: number } | null {
  const c = v.project(v.pos);
  const wing = v.project(add(v.pos, scale(cross(v.fwd, v.up), 9)));
  if (!c || !wing) return null;
  const rx = Math.hypot(wing.x - c.x, wing.y - c.y) * 1.25 + fs;
  return { x: c.x, y: c.y, rx, ry: rx * 0.6, rot: Math.atan2(-upS.x, upS.y) };
}

function unit2(x: number, y: number): Pt {
  const l = Math.hypot(x, y);
  return l < 1e-6 ? { x: 0, y: -1 } : { x: x / l, y: y / l };
}

/** Picks the ink for a screen region (CSS px). */
type InkAt = (x0: number, y0: number, x1: number, y1: number) => Ink;

/**
 * Drawing primitives in the HUD's look: thin luminous lines and glyphs with a
 * soft shadow, in the ink of the region last named by region() / around().
 */
class Pen {
  readonly g: CanvasRenderingContext2D;
  readonly fs: number;
  private readonly dpr: number;
  private readonly soft: boolean;
  private readonly inkAt: InkAt;
  private ink: Ink;

  /** soft: draw the shadows (off in performance mode). */
  constructor(g: CanvasRenderingContext2D, fs: number, dpr: number, soft: boolean, inkAt: InkAt) {
    this.g = g;
    this.fs = fs;
    this.dpr = dpr;
    this.soft = soft;
    this.inkAt = inkAt;
    this.ink = inkAt(0, 0, 0, 0);
  }

  /** The ink for what lies behind this rectangle. */
  region(x0: number, y0: number, x1: number, y1: number): void {
    this.ink = this.inkAt(x0, y0, x1, y1);
  }

  /** The ink for what lies within r of c. */
  around(c: Pt, r: number): void {
    this.region(c.x - r, c.y - r, c.x + r, c.y + r);
  }

  /** The faint tinted glass behind a readout over a bright backdrop (none over a dark one). */
  backing(x: number, y: number, w: number, h: number): void {
    if (this.ink.backing <= 0) return;
    const g = this.g;
    this.shadow(false);
    g.fillStyle = `rgba(0,10,4,${this.ink.backing.toFixed(2)})`;
    g.beginPath();
    g.roundRect(x, y, w, h, 3);
    g.fill();
  }

  private shadow(on: boolean): void {
    const g = this.g;
    const s = on && this.soft;
    g.shadowBlur = s ? this.ink.blur * this.dpr : 0;
    g.shadowColor = s ? this.ink.shadow : "transparent";
  }

  stroke(build: (g: CanvasRenderingContext2D) => void, width = 1, dash?: number[]): void {
    const g = this.g;
    g.setLineDash(dash ?? []);
    this.shadow(true);
    g.beginPath();
    build(g);
    g.lineWidth = width;
    g.strokeStyle = this.ink.core;
    g.stroke();
    g.setLineDash([]);
    this.shadow(false);
  }

  fill(build: (g: CanvasRenderingContext2D) => void): void {
    const g = this.g;
    this.shadow(true);
    g.beginPath();
    build(g);
    g.fillStyle = this.ink.core;
    g.fill();
    this.shadow(false);
  }

  /** Text, size as a share of the HUD's font size (the numeric readouts are larger, not heavier). */
  text(s: string, x: number, y: number, align: CanvasTextAlign, base: CanvasTextBaseline, size = 1): void {
    const g = this.g;
    g.font = `${Math.round(this.fs * size)}px ${FONT}`;
    g.textAlign = align;
    g.textBaseline = base;
    g.fillStyle = this.ink.core;
    this.shadow(true);
    for (let i = 0; i < this.ink.passes; i++) g.fillText(s, x, y); // over bright sky the shadow builds up under the glyph
    this.shadow(false);
  }

  ring(c: Pt, r: number): void {
    this.stroke((g) => g.arc(c.x, c.y, r, 0, Math.PI * 2));
  }

  /** A polyline (closed: back to its start); a gap wherever a point is missing (behind the camera). */
  polyline(pts: (Pt | null)[], closed: boolean, dash?: number[]): void {
    this.stroke((g) => {
      let down = false;
      for (const p of closed ? [...pts, pts[0]] : pts) {
        if (!p) { down = false; continue; }
        if (down) g.lineTo(p.x, p.y);
        else g.moveTo(p.x, p.y);
        down = true;
      }
    }, 1, dash);
  }

  /** Points given in the aircraft's screen frame: a along its wings, b down toward its belly. */
  private local(c: Pt, up: Pt, a: number, b: number): [number, number] {
    return [c.x - up.y * a - up.x * b, c.y + up.x * a - up.y * b];
  }

  /** Flight path marker: a circle with wings and a tail fin, level with the wings. */
  fpm(c: Pt, up: Pt): void {
    const r = this.fs * 0.5, wing = this.fs * 0.95, fin = this.fs * 0.6;
    this.stroke((g) => {
      g.moveTo(c.x + r, c.y);
      g.arc(c.x, c.y, r, 0, Math.PI * 2);
      for (const [a0, b0, a1, b1] of [[-r, 0, -r - wing, 0], [r, 0, r + wing, 0], [0, -r, 0, -r - fin]]) {
        g.moveTo(...this.local(c, up, a0, b0));
        g.lineTo(...this.local(c, up, a1, b1));
      }
    }, 1.3);
  }

  /** Waterline (the nose, where the gun points): —\/\/—. */
  waterline(c: Pt, up: Pt): void {
    const u = this.fs * 0.55;
    const pts: [number, number][] = [[-3.6 * u, 0], [-1.8 * u, 0], [-0.9 * u, 1.3 * u], [0, 0], [0.9 * u, 1.3 * u], [1.8 * u, 0], [3.6 * u, 0]];
    this.stroke((g) => pts.forEach(([a, b], i) => (i ? g.lineTo(...this.local(c, up, a, b)) : g.moveTo(...this.local(c, up, a, b)))));
  }
}
