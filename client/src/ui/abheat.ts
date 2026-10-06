// Afterburner heat bar next to the AB light (feedback #1 item 15): fills
// while the afterburner burns, flashes while it is locked out.
import { lattr } from "../i18n/index.ts";
import { h } from "./dom.ts";

export type AbHeat = { pct: number; locked: boolean; warm: boolean };

/** Bar state from heat 0..1 and the lockout flag (snapshot abh/abl or my prediction). */
export function abHeat(heat: number | undefined, locked: boolean | undefined): AbHeat {
  const x = Number.isFinite(heat) ? Math.max(0, Math.min(1, heat as number)) : 0;
  return { pct: Math.round(x * 100), locked: !!locked, warm: x >= 0.75 };
}

export class AbHeatBar {
  readonly el: HTMLElement;
  private readonly fill = h("div", { class: "bar-fill" });

  constructor() {
    this.el = lattr(h("div", { class: "bar ab-heat" }, this.fill), "title", "g.abHeat");
  }

  update(s: AbHeat): void {
    this.fill.style.width = `${s.pct}%`;
    this.el.classList.toggle("warm", s.warm && !s.locked);
    this.el.classList.toggle("locked", s.locked);
  }
}
