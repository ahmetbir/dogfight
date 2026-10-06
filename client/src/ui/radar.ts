// Top-down radar, north (−Z) up, 4 km radius around me.
import type { V3 } from "../sim/vec.ts";
import { h } from "./dom.ts";

export const RADAR_M = 4000;
const SIZE = 168; // CSS px

/** target: a base attack structure still standing (hollow square). */
export type Contact = { pos: V3; kind: "friend" | "enemy" | "powerup" | "missile" | "target" };

/** Radar offset of p from me in px (north up, east right), clamped to the rim. */
export function radarPoint(me: V3, p: V3, radiusM: number, radiusPx: number): { x: number; y: number; edge: boolean } {
  let dx = p.x - me.x;
  let dz = p.z - me.z;
  const d = Math.hypot(dx, dz);
  const edge = d > radiusM;
  if (edge) {
    dx *= radiusM / d;
    dz *= radiusM / d;
  }
  return { x: (dx / radiusM) * radiusPx, y: (dz / radiusM) * radiusPx, edge };
}

const COLORS: Record<Contact["kind"], string> = {
  friend: "#5aa9ff", enemy: "#ff4d4d", powerup: "#ffd84d", missile: "#ffffff", target: "#ff6a3d",
};

export class Radar {
  readonly el: HTMLElement;
  private readonly cv: HTMLCanvasElement;
  private readonly g: CanvasRenderingContext2D | null;
  private dpr = 1;

  constructor() {
    this.cv = h("canvas", { class: "radar-canvas", width: SIZE, height: SIZE });
    this.g = this.cv.getContext("2d");
    this.el = h("div", { class: "radar" }, this.cv, h("span", { class: "radar-n" }, "K"), h("span", { class: "radar-r" }, "4 km"));
  }

  draw(me: V3, fwd: V3, contacts: Contact[]): void {
    const g = this.g;
    if (!g) return;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (dpr !== this.dpr || this.cv.width !== SIZE * dpr) {
      this.dpr = dpr;
      this.cv.width = this.cv.height = SIZE * dpr;
    }
    g.setTransform(dpr, 0, 0, dpr, 0, 0);
    const c = SIZE / 2;
    const r = c - 4;
    g.clearRect(0, 0, SIZE, SIZE);
    g.strokeStyle = "rgba(124,255,178,0.25)";
    g.lineWidth = 1;
    for (const f of [1, 0.5]) {
      g.beginPath();
      g.arc(c, c, r * f, 0, Math.PI * 2);
      g.stroke();
    }
    g.beginPath();
    g.moveTo(c, c - r); g.lineTo(c, c + r); g.moveTo(c - r, c); g.lineTo(c + r, c);
    g.stroke();
    for (const k of contacts) {
      const p = radarPoint(me, k.pos, RADAR_M, r);
      g.fillStyle = COLORS[k.kind];
      g.globalAlpha = p.edge ? 0.55 : 1;
      if (k.kind === "target") { // hollow, so it never reads as a power-up square
        g.strokeStyle = COLORS.target;
        g.lineWidth = 1.5;
        g.strokeRect(c + p.x - 3, c + p.y - 3, 6, 6);
        continue;
      }
      g.beginPath();
      if (k.kind === "powerup") g.rect(c + p.x - 3, c + p.y - 3, 6, 6);
      else g.arc(c + p.x, c + p.y, k.kind === "missile" ? 1.8 : 3.4, 0, Math.PI * 2);
      g.fill();
    }
    g.globalAlpha = 1;
    // Me: a small arrow along my heading.
    const a = Math.atan2(fwd.x, -fwd.z);
    g.save();
    g.translate(c, c);
    g.rotate(a);
    g.fillStyle = "#7CFFB2";
    g.beginPath();
    g.moveTo(0, -7); g.lineTo(5, 5); g.lineTo(0, 2); g.lineTo(-5, 5);
    g.closePath();
    g.fill();
    g.restore();
  }
}
