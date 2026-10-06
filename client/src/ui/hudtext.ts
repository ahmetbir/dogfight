// HUD readout panels: speed, altitude, throttle/AB and flight lights on the
// left; HP, cannon heat, lock range and ammo on the right. Refreshed at 10 Hz.
import type { HudView } from "../game/events.ts";
import { lt, type Key } from "../i18n/index.ts";
import { abHeat, AbHeatBar } from "./abheat.ts";
import { h, text } from "./dom.ts";
import { FlightLights } from "./flightlights.ts";
import { missileText, ranges } from "./loadout.ts";
import { formatDist } from "./reticle.ts";

export class Gauges {
  readonly left: HTMLElement;
  readonly right: HTMLElement;
  private readonly speed = h("span", { class: "g-big" });
  private readonly alt = h("span", { class: "g-big" });
  private readonly thFill = h("div", { class: "bar-fill" });
  private readonly ab = h("span", { class: "ab-light" }, "AB"); // the same in every language
  private readonly abBar = new AbHeatBar();
  private readonly hpFill = h("div", { class: "bar-fill" });
  private readonly hpText = h("span", { class: "g-num" });
  private readonly heatFill = h("div", { class: "bar-fill" });
  private readonly heatBar = h("div", { class: "bar heat" }, this.heatFill);
  private readonly range = h("span", { class: "g-num range" });
  private readonly ms = h("span", { class: "g-big" });
  private readonly fl = h("span", { class: "g-big" });
  private readonly lights = new FlightLights();

  constructor() {
    const label = (k: Key) => h("span", { class: "g-label" }, lt(k));
    const row = (k: Key, ...c: HTMLElement[]) => h("div", { class: "g-row" }, label(k), ...c);
    this.left = h("div", { class: "hud-panel hud-left" },
      row("g.speed", this.speed, h("span", { class: "g-unit" }, "km/h")),
      row("g.alt", this.alt, h("span", { class: "g-unit" }, "m")),
      row("g.thr", h("div", { class: "bar throttle" }, this.thFill), this.ab, this.abBar.el),
      this.lights.el);
    this.right = h("div", { class: "hud-panel hud-right" },
      row("g.hp", h("div", { class: "bar hp" }, this.hpFill), this.hpText),
      row("g.heat", this.heatBar),
      h("div", { class: "g-row lock-range" }, label("g.range"), this.range),
      h("div", { class: "g-row ammo" }, label("g.missiles"), this.ms, label("g.flares"), this.fl));
  }

  update(v: HudView): void {
    text(this.speed, v.alive ? String(Math.round(v.speed * 3.6)) : "—");
    text(this.alt, v.alive ? String(Math.max(0, Math.round(v.alt))) : "—");
    this.thFill.style.width = `${Math.round(v.th * 100)}%`;
    this.ab.classList.toggle("on", v.ab);
    this.ab.classList.toggle("locked", v.alive && v.abLocked);
    this.abBar.update(abHeat(v.alive ? v.abHeat : 0, v.alive && v.abLocked));
    const hp = Math.max(0, v.hp / Math.max(1, v.maxHP));
    this.hpFill.style.width = `${Math.round(hp * 100)}%`;
    this.hpFill.classList.toggle("low", hp < 0.35);
    text(this.hpText, String(Math.max(0, Math.round(v.hp))));
    this.heatFill.style.width = `${Math.round(Math.min(1, v.heat) * 100)}%`;
    this.heatBar.classList.toggle("over", v.overheated);
    text(this.range, rangeText(v));
    text(this.ms, missileText(v.missiles, v.radars, v.loadout));
    text(this.fl, String(v.flares));
    this.lights.update(v);
  }
}

/** The lock-range readout: the IR range, the radar range, or "IR / radar" with both kinds aboard. */
export function rangeText(v: Pick<HudView, "lockRange" | "missiles" | "radars" | "loadout">): string {
  if (v.lockRange <= 0) return "—";
  const r = ranges(v.lockRange);
  if (v.loadout === "radar") return formatDist(r.radar);
  if (v.loadout === "mixed") return `${formatDist(r.ir)} / ${formatDist(r.radar)}`;
  return formatDist(r.ir);
}
