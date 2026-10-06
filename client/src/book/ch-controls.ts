// Chapter 2 drawings and tables: mouse aim and the key list of a scheme,
// rendered from the bindings the schemes read (input/bindings.ts), so the
// lists cannot drift from the game (the prose: i18n/book/*/basics.ts).
import { t } from "../i18n/index.ts";
import { keyRows, type Scheme } from "../input/bindings.ts";
import { art, kbd, label, s, table } from "./kit.ts";

/** Mouse aim: the aim circle leads, the nose cross follows. */
export function aimArt(): SVGSVGElement {
  return art(320, 150, t("art.aim"),
    s("rect", { x: 10, y: 10, width: 300, height: 130, rx: 10, class: "screen" }),
    s("circle", { cx: 220, cy: 60, r: 14, class: "hud-mark" }),
    s("path", { d: "M128 88 h16 M136 80 v16", class: "hud-mark" }),
    s("path", { d: "M146 84 Q180 64 204 62", class: "arrow dashed" }),
    label(220, 36, t("art.aimMark"), "mid"), label(136, 116, t("art.nose"), "mid"));
}

/** A scheme's keys as a table. */
export function keyTable(scheme: Scheme): HTMLElement {
  return table([t("bt.key"), t("bt.action")], keyRows(scheme).map(([key, what]) => [kbd(key), what]));
}
