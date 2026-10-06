// Kill feed, top right: kills for 6 s, quick chat lines for 5 s, at most 5 lines.
import type { Team, Weapon } from "../net/protocol.ts";
import { lt, t } from "../i18n/index.ts";
import { fill, h } from "./dom.ts";

const MAX = 5;
const LIFE_MS = 6000;

/** A weapon (or cause of death) as the kill feed names it. */
export const weaponName = (w: Weapon) => t(`weapon.${w}`);

export type Who = { name: string; team: Team; me: boolean };
type Line = { el: HTMLElement; until: number };

/** A pilot's name, colored by team ("you" for me, live: it follows a language switch); text node only. Names are never translated. */
export function whoEl(p: Who): HTMLElement {
  return h("span", { class: `kf-name ${p.team}${p.me ? " me" : ""}` }, p.me ? lt("common.you") : p.name);
}

export class KillFeed {
  readonly el = h("div", { class: "killfeed" });
  private readonly lines: Line[] = [];

  /** killer null: the victim died on its own (crash, bounds). */
  add(victim: Who, killer: Who | null, w: Weapon | undefined, now: number): void {
    // Live text: a line made before a language switch is re-worded (and re-cased) with it.
    const weapon = h("span", { class: "kf-weapon" }, w ? lt(`weapon.${w}`) : "");
    const el = killer
      ? h("div", { class: "kf-line" }, whoEl(killer), weapon, whoEl(victim))
      : h("div", { class: "kf-line" }, whoEl(victim), weapon);
    this.addLine(el, now, LIFE_MS);
  }

  /** Any line, shown for lifeMs. */
  addLine(el: HTMLElement, now: number, lifeMs: number): void {
    this.lines.push({ el, until: now + lifeMs });
    if (this.lines.length > MAX) this.lines.shift();
    fill(this.el, ...this.lines.map((l) => l.el));
  }

  update(now: number): void {
    const n = this.lines.length;
    for (let i = n - 1; i >= 0; i--) if (now > this.lines[i].until) this.lines.splice(i, 1);
    if (this.lines.length !== n) fill(this.el, ...this.lines.map((l) => l.el));
  }
}
