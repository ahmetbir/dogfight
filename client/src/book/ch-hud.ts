// Chapter 8 drawing: an annotated HUD, labelled with the HUD's own texts
// (the prose: i18n/book/*/world.ts).
import { t } from "../i18n/index.ts";
import { fixed } from "../i18n/format.ts";
import { art, label, s } from "./kit.ts";

/** Radians as whole degrees: "10°". */
export const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`;

/** A numbered callout at (x, y). */
const tag = (n: number, x: number, y: number) => s("g", { class: "callout" }, s("circle", { cx: x, cy: y, r: 9 }), label(x, y + 4, String(n), "mid"));

export function hudArt(): SVGSVGElement {
  const panel = (x: number, rows: string[]) => s("g", {},
    s("rect", { x, y: 228, width: 112, height: 92, rx: 6, class: "hud-box" }),
    ...rows.map((r, i) => label(x + 8, 246 + i * 18, r, "hud small")));
  const g = (k: Parameters<typeof t>[0], rest: string) => `${t(k)} ${rest}`;
  return art(640, 340, t("art.hud"),
    s("rect", { x: 0, y: 0, width: 640, height: 340, rx: 12, class: "screen" }),
    s("circle", { cx: 58, cy: 58, r: 44, class: "hud-box" }), s("circle", { cx: 58, cy: 58, r: 3, class: "hud-fill" }),
    s("rect", { x: 74, y: 40, width: 5, height: 5, class: "blip enemy" }), s("rect", { x: 40, y: 70, width: 5, height: 5, class: "blip friend" }),
    s("rect", { x: 255, y: 12, width: 130, height: 24, rx: 6, class: "hud-box" }), label(320, 29, `${t("team.nato")} 3 · 2 ${t("art.sovShort")} · 6:12`, "mid hud small"),
    s("rect", { x: 240, y: 44, width: 160, height: 22, rx: 5, class: "warn-box" }), label(320, 60, `${t("hud.missileWarn")} · ${fixed(1.2, 1)} km`, "mid small"),
    label(320, 84, t("flare.cue"), "mid warn"),
    label(628, 26, `Ali ✕ Veli  ${t("weapon.cannon").toUpperCase()}`, "end small"),
    s("circle", { cx: 380, cy: 150, r: 16, class: "hud-mark" }),
    s("path", { d: "M312 170 h16 M320 162 v16", class: "hud-mark" }),
    s("rect", { x: 420, y: 118, width: 40, height: 40, class: "lock-box" }), label(440, 172, "820 m", "mid small hud"),
    s("rect", { x: 420, y: 178, width: 40, height: 4, class: "hud-box" }), s("rect", { x: 420, y: 178, width: 30, height: 4, class: "hud-fill" }),
    s("circle", { cx: 470, cy: 128, r: 6, class: "lead" }),
    label(320, 214, t("hud.outRange"), "mid warn small"),
    panel(14, [g("g.speed", "820 km/h"), g("g.alt", "1450 m"), g("g.thr", "▮▮▮▯ AB ▮▯"), `${t("lamp.gear")} ${t("lamp.brake")} ${t("lamp.rearm", { p: "" }).trim()}`]),
    panel(514, [g("g.hp", "▮▮▮▮▯ 76"), g("g.heat", "▮▯▯▯"), g("g.range", "950 m"), `${t("g.missiles")} 3  ${t("g.flares")} 6`]),
    tag(1, 108, 30), tag(2, 396, 24), tag(3, 412, 56), tag(4, 360, 84), tag(5, 560, 44), tag(6, 400, 140), tag(7, 330, 186),
    tag(8, 486, 140), tag(9, 452, 196), tag(10, 232, 214), tag(11, 136, 236), tag(12, 500, 236));
}
