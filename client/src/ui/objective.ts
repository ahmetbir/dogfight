// Base attack HUD: each side's remaining target HP as two bars (mine on the
// left) and the enemy targets still standing (radar squares).
import type { RoundMsg, StructInfo, Team } from "../net/protocol.ts";
import type { V3 } from "../sim/vec.ts";
import { h, text } from "./dom.ts";

/** One side's total target HP (internal/maps structLayout: 2×400 + 2×250 + 300 + 350). */
export const OBJECTIVE_MAX = 1950;

/** hp / max clamped to 0..1. */
export function objFrac(hp: number, max = OBJECTIVE_MAX): number {
  return max > 0 ? Math.max(0, Math.min(1, hp / max)) : 0;
}

/** Centers of the enemy structures still standing (hp: live HP by id; missing: not hit yet). */
export function enemyTargets(structs: StructInfo[], hp: Map<number, number>, myTeam: Team): V3[] {
  const out: V3[] = [];
  for (const s of structs) {
    if (s.tm === myTeam || (hp.get(s.id) ?? s.hp ?? 1) <= 0) continue;
    const b = s.box;
    out.push({ x: (b[0] + b[3]) / 2, y: (b[1] + b[4]) / 2, z: (b[2] + b[5]) / 2 });
  }
  return out;
}

type Side = "nato" | "soviet";
const NAMES: Record<Side, string> = { nato: "NATO", soviet: "SOVYET" };

class SideBar {
  readonly el: HTMLElement;
  private readonly label = h("span", { class: "obj-label" });
  private readonly fill = h("div", { class: "bar-fill" });
  private readonly hp = h("span", { class: "obj-hp" });

  constructor() {
    this.el = h("div", { class: "obj-side" }, this.label, h("div", { class: "bar obj-bar" }, this.fill), this.hp);
  }

  update(side: Side, hp: number, mine: boolean): void {
    this.el.className = `obj-side ${side}${mine ? " mine" : ""}`;
    text(this.label, NAMES[side]);
    this.fill.style.width = `${(objFrac(hp) * 100).toFixed(1)}%`;
    text(this.hp, String(Math.max(0, Math.round(hp))));
  }
}

export class ObjectiveBar {
  readonly el: HTMLElement;
  private readonly a = new SideBar();
  private readonly b = new SideBar();

  constructor() {
    this.el = h("div", { class: "objective", hidden: true }, this.a.el, this.b.el);
  }

  /** Hidden outside base attack; my side on the left (NATO when I have none). */
  update(r: RoundMsg | null, mode: string, myTeam: Team): void {
    this.el.hidden = mode !== "base";
    if (this.el.hidden) return;
    const left: Side = myTeam === "soviet" ? "soviet" : "nato";
    const right: Side = left === "nato" ? "soviet" : "nato";
    const hp = (s: Side) => r?.obj?.[s] ?? OBJECTIVE_MAX;
    this.a.update(left, hp(left), myTeam === left);
    this.b.update(right, hp(right), false);
  }
}
