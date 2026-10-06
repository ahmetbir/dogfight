// Chapter 4 drawings and tables: the base layout, a landing, rotate speeds
// (the prose: i18n/book/*/combat.ts).
import { t } from "../i18n/index.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { art, b, kmh, label, s, speed, table } from "./kit.ts";
import { RULES as R } from "./rules.ts";

/** Top view of a base: runway, parallel taxiway, apron and the hangar row. */
export function baseArt(): SVGSVGElement {
  const hangars = Array.from({ length: R.hangars }, (_, i) =>
    s("rect", { x: 70 + i * 34, y: 128, width: 24, height: 18, class: "hangar" }));
  return art(340, 170, t("art.base"),
    s("rect", { x: 10, y: 10, width: 320, height: 150, rx: 10, class: "base-area" }),
    s("rect", { x: 20, y: 30, width: 300, height: 22, class: "runway" }),
    s("line", { x1: 30, y1: 41, x2: 310, y2: 41, class: "centerline" }),
    s("rect", { x: 40, y: 78, width: 260, height: 10, class: "taxi" }),
    s("rect", { x: 40, y: 52, width: 10, height: 26, class: "taxi" }), s("rect", { x: 290, y: 52, width: 10, height: 26, class: "taxi" }),
    s("rect", { x: 60, y: 88, width: 220, height: 36, class: "taxi" }),
    ...hangars,
    label(170, 24, t("art.runway"), "mid small"), label(170, 101, t("art.taxi"), "mid small"), label(170, 158, t("art.hangars"), "mid small"),
    label(318, 73, `≤ ${kmh(R.taxiGovernor)}`, "end small warn"));
}

/** Side view of a landing: glide, flare, touchdown limits. */
export function landArt(): SVGSVGElement {
  return art(340, 130, t("art.land"),
    s("line", { x1: 10, y1: 110, x2: 330, y2: 110, class: "ground" }),
    s("rect", { x: 170, y: 106, width: 160, height: 4, class: "runway" }),
    s("path", { d: "M20 30 L170 100 Q190 108 220 108", class: "arrow dashed" }),
    s("g", { transform: "translate(20 30) rotate(25)" }, s("path", { d: "M-12 0 L10 0 L14 2 L-12 3 Z", class: "jet-side" })),
    label(80, 50, t("art.glide"), "small"),
    label(220, 92, t("art.touch", { sink: R.maxSinkRate, bank: R.maxTouchBankDeg }), "mid small warn"));
}

/** Rotate speed per aircraft. */
export function rotateTable(aircraft: AircraftInfo[]): HTMLElement {
  return table([t("bt.aircraft"), t("bt.rotate")], aircraft.map((a) => [b(a.name), speed(a.rotateSpeed)]));
}
