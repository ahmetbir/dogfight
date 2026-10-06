// Screen-projected HUD marks, moved every frame: aim circle, nose cross,
// lock box (with the lock's missile kind, distance and that kind's range
// bar) and the cannon lead circle.
import { add, len, norm, scale, sub, type V3 } from "../sim/vec.ts";
import { h, text } from "./dom.ts";
import { inCone, rangeFill } from "./lockinfo.ts";

// internal/sim/cannon.go: a round leaves MUZZLE_M ahead of the plane at
// BULLET_SPEED along the nose on top of the shooter's velocity, flies straight
// (no gravity, no wind) and expires after BULLET_LIFE_S.
export const BULLET_SPEED = 900;
const MUZZLE_M = 8;
const BULLET_LIFE_S = 72 / 60;
// Each tick the target steps first, then the round sweeps a whole tick of its
// path: on average it meets the target half a tick further along.
const SWEEP_S = 1 / 120;
const NOSE_M = 500;
const BOX_MAX = 140; // px while the lock starts
const BOX_MIN = 46;  // px when locked

export type Pt = { x: number; y: number };
export type Project = (p: V3) => Pt | null;
export type Body = { pos: V3; vel: V3 };

/**
 * The nose direction for which a round fired now meets target (its present
 * position and velocity): solves pos + (MUZZLE_M + BULLET_SPEED·(s+SWEEP_S))·d
 * + vel·(s+SWEEP_S) = target.pos + target.vel·s. null beyond the round's life.
 */
export function leadDir(me: Body, target: Body): V3 | null {
  const off = sub(target.pos, me.pos);
  let s = Math.max(0, (len(off) - MUZZLE_M) / BULLET_SPEED - SWEEP_S);
  let r = off;
  for (let i = 0; i < 6; i++) {
    r = sub(add(off, scale(target.vel, s)), scale(me.vel, s + SWEEP_S));
    s = Math.max(0, (len(r) - MUZZLE_M) / BULLET_SPEED - SWEEP_S);
  }
  if (s + SWEEP_S > BULLET_LIFE_S || len(r) < 1e-6) return null;
  return norm(r);
}

/** The nose cross: NOSE_M along fwd. */
export function noseMark(pos: V3, fwd: V3): V3 {
  return add(pos, scale(fwd, NOSE_M));
}

/**
 * The lead circle at the same distance as the nose cross, so the two overlap
 * on screen exactly when the nose points along the lead, whatever the chase
 * camera's offset (a mark at the target's own range would drift by parallax).
 */
export function leadMark(me: Body, target: Body): V3 | null {
  const d = leadDir(me, target);
  return d && noseMark(me.pos, d);
}

/** Lock box edge in px for progress 0..1. */
export function boxSize(progress: number): number {
  const p = Math.max(0, Math.min(1, progress));
  return BOX_MAX + (BOX_MIN - BOX_MAX) * p;
}

export { inCone }; // lives in lockinfo.ts, so the two modules do not import each other

export function formatDist(m: number): string {
  return m >= 1000 ? `${(m / 1000).toFixed(1)} km` : `${Math.round(m / 10) * 10} m`;
}

export type ReticleView = {
  alive: boolean; pos: V3; vel: V3; fwd: V3; aimDir: V3 | null;
  lock: { pos: V3; progress: number; locked: boolean; dist: number; range: number; kind: "ir" | "radar" } | null;
  lead: Body | null; // gun target at the present (where my next round meets it)
  project: Project;
};

export class Reticle {
  readonly el: HTMLElement;
  // Each mark is a zero-size anchor moved by transform; its child is centered on it by CSS.
  private readonly aim = h("div", { class: "rt-anchor", hidden: true }, h("div", { class: "rt-aim" }));
  private readonly nose = h("div", { class: "rt-anchor", hidden: true }, h("div", { class: "rt-nose" }));
  private readonly frame = h("div", { class: "rt-box" }, h("span", { class: "rt-box-label" }, "KİLİT"));
  private readonly lockDist = h("span", { class: "rt-lock-dist" });
  private readonly rangeBar = h("div", { class: "bar-fill" });
  private readonly lockInfo = h("div", { class: "rt-lock-info" }, this.lockDist, h("div", { class: "bar rt-range" }, this.rangeBar));
  private readonly box = h("div", { class: "rt-anchor", hidden: true }, this.frame, this.lockInfo);
  private readonly dist = h("span", { class: "rt-dist" });
  private readonly lead = h("div", { class: "rt-anchor", hidden: true }, h("div", { class: "rt-lead" }), this.dist);

  constructor() {
    this.el = h("div", { class: "reticle" }, this.lead, this.box, this.nose, this.aim);
  }

  update(v: ReticleView): void {
    const at = (e: HTMLElement, p: Pt | null) => {
      e.hidden = !p;
      if (p) e.style.transform = `translate(${p.x.toFixed(1)}px, ${p.y.toFixed(1)}px)`;
    };
    if (!v.alive) {
      for (const e of [this.aim, this.nose, this.box, this.lead]) e.hidden = true;
      return;
    }
    at(this.aim, v.aimDir ? v.project(add(v.pos, scale(v.aimDir, NOSE_M))) : null);
    at(this.nose, v.project(noseMark(v.pos, v.fwd)));
    const lp = v.lock ? v.project(v.lock.pos) : null;
    at(this.box, lp);
    if (v.lock && lp) {
      const s = boxSize(v.lock.locked ? 1 : v.lock.progress);
      this.frame.style.width = this.frame.style.height = `${s.toFixed(0)}px`;
      this.frame.classList.toggle("locked", v.lock.locked);
      this.lockInfo.style.top = `${(s / 2 + 6).toFixed(0)}px`;
      text(this.lockDist, `${v.lock.kind === "radar" ? "RADAR" : "IR"} · ${formatDist(v.lock.dist)}`);
      this.box.classList.toggle("lock-radar", v.lock.kind === "radar");
      const fill = rangeFill(v.lock.dist, v.lock.range);
      this.rangeBar.style.width = `${Math.round(fill * 100)}%`;
      this.rangeBar.classList.toggle("far", fill >= 1);
    }
    const mark = v.lead && leadMark({ pos: v.pos, vel: v.vel }, v.lead);
    const lead = mark ? v.project(mark) : null;
    at(this.lead, lead);
    if (v.lead && lead) text(this.dist, formatDist(len(sub(v.lead.pos, v.pos))));
  }
}
