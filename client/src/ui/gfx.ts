// G effects (feedback #1 item 14), purely visual: sustained high +G darkens
// the screen edges toward a blackout, negative G tints it red; both fade out.
import { h } from "./dom.ts";

// Thresholds for the FB-A flight model, measured on Hard-bot duels (all 10
// aircraft pairings × 12 seeds × 120 s, 1.59 M airborne ticks, load factor
// smoothed like OwnPlane.gLoad): sustained turns (≥ 2 G held 1.5 s) run
// p50 13.1 / p85 15.5 / p95 16.6 G; pushes reach p20 −10.1 / p10 −13.5 G
// among negative-G ticks. Blackout starts near the top 15% of sustained
// turns, the red tint only on strong pushes, at its strongest by about −14 G.
export const BLACK_G = 15;       // +G above which the blackout clock runs
export const BLACK_AFTER_S = 1.5; // sustained this long before the edges darken
const BLACK_FULL_S = 3;          // further seconds to the darkest edges
const BLACK_MAX = 0.92;
export const RED_G = -8;         // below this the view reddens
const RED_FULL_G = 6;            // G past RED_G for the strongest tint
const RED_MAX = 0.55;
const RISE = 1.2;                // opacity per second toward a stronger effect
const FADE = 0.8;                // opacity per second back to clear

export type GState = { over: number; black: number; red: number };

export const G_CLEAR: GState = { over: 0, black: 0, red: 0 };

const toward = (x: number, want: number, dt: number) =>
  want > x ? Math.min(want, x + RISE * dt) : Math.max(want, x - FADE * dt);

/** One frame: g is the signed load factor (1 in level flight), dt in seconds. */
export function gStep(s: GState, g: number, dt: number): GState {
  const over = g > BLACK_G ? s.over + dt : Math.max(0, s.over - 2 * dt);
  const black = over > BLACK_AFTER_S ? BLACK_MAX * Math.min(1, (over - BLACK_AFTER_S) / BLACK_FULL_S) : 0;
  const red = g < RED_G ? RED_MAX * Math.min(1, 0.3 + (RED_G - g) / RED_FULL_G) : 0;
  return { over, black: toward(s.black, black, dt), red: toward(s.red, red, dt) };
}

export class GEffects {
  readonly el: HTMLElement;
  private readonly black = h("div", { class: "g-black" });
  private readonly red = h("div", { class: "g-red" });
  private s: GState = G_CLEAR;

  constructor() {
    this.el = h("div", { class: "g-fx" }, this.red, this.black);
  }

  /** enabled: the "G efektleri" setting; off (or dead) clears at once. */
  update(g: number, dt: number, enabled: boolean): void {
    this.s = enabled ? gStep(this.s, g, Math.min(dt, 0.1)) : G_CLEAR;
    this.black.style.opacity = this.s.black.toFixed(3);
    this.red.style.opacity = this.s.red.toFixed(3);
  }
}
