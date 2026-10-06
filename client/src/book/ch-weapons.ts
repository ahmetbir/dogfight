// Chapter 5 drawings and tables: the lock cone, a flare decoy, ammunition per
// aircraft (the prose: i18n/book/*/combat.ts).
import { t } from "../i18n/index.ts";
import { keys, touchLabel, type TouchControl } from "../input/bindings.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { loadoutCounts, missileText } from "../ui/loadout.ts";
import { art, b, dist, jet, label, s, table } from "./kit.ts";
import { RULES as R } from "./rules.ts";

/** "Sol tık · klavye Space · ATEŞ": a weapon's mouse keys, keyboard keys and touch button; kb is "klavye" / "keyboard". */
export const bind = (m: readonly string[], k: readonly string[], c: TouchControl, kb: string) => `${keys(m)} · ${kb} ${keys(k)} · ${touchLabel(c)}`;

/** The lock cone ahead of the nose, with the lock range. */
export function lockArt(): SVGSVGElement {
  const a = (R.lockConeDeg * Math.PI) / 180, L = 230, x0 = 50, y0 = 80;
  const dy = Math.tan(a) * L;
  return art(320, 160, t("art.cone"),
    s("path", { d: `M${x0} ${y0} L${x0 + L} ${y0 - dy} L${x0 + L} ${y0 + dy} Z`, class: "cone" }),
    jet(x0 - 6, y0, 1, "jet me", 90),
    jet(x0 + 170, y0 - 10, 0.8, "jet enemy", 90), label(x0 + 170, y0 - 28, t("art.lock"), "mid small"),
    jet(x0 + 140, y0 + 55, 0.8, "jet enemy dim", 70), label(x0 + 140, y0 + 80, t("art.outCone"), "mid small"),
    s("line", { x1: x0, y1: y0 + 46, x2: x0 + L, y2: y0 + 46, class: "guide" }),
    label(x0 + L, y0 + 42, t("art.lockRange"), "end small"), label(x0 + 60, y0 - 6, `${R.lockConeDeg}°`, "small"));
}

/** A missile turning off toward a burning flare inside its capture radius. */
export function flareArt(): SVGSVGElement {
  return art(320, 170, t("art.flare"),
    s("circle", { cx: 200, cy: 85, r: 70, class: "flare-zone" }),
    jet(260, 85, 1, "jet me", -90), s("circle", { cx: 200, cy: 85, r: 5, class: "flare" }),
    s("path", { d: "M20 120 Q120 120 196 88", class: "arrow dashed warn" }),
    label(20, 140, t("art.missile"), "small warn"), label(200, 70, t("art.flareMark"), "mid small"),
    label(200, 165, t("art.capture", { d: dist(R.flareRange) }), "mid small"));
}

export function ammoTable(list: AircraftInfo[]): HTMLElement {
  return table([t("bt.aircraft"), t("bt.hp"), t("bt.missiles"), t("bt.flares"), t("bt.lockRange"), t("bt.byMissile"), t("bt.byGun")],
    list.map((a) => [
      b(a.name), String(a.maxHP),
      (["ir", "radar", "mixed"] as const).map((lo) => missileText(...loadoutCounts(a.missiles, lo), lo)).join(" / "), String(a.flares),
      `${dist(a.lockRange)} / ${dist(a.lockRange * R.radarRangeMul)}`,
      t("bt.nMissiles", { a: Math.ceil(a.maxHP / R.missileDmg), b: Math.ceil(a.maxHP / R.radarDmg) }),
      t("bt.nRounds", { n: Math.ceil(a.maxHP / R.bulletDmg) }),
    ]));
}
