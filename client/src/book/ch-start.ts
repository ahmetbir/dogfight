// Chapter 1 drawings: the airborne start (the prose: i18n/book/*/basics.ts).
import { t } from "../i18n/index.ts";
import { art, dist, jet, label, s } from "./kit.ts";
import { RULES as R } from "./rules.ts";

/** Top view of the map: both team air-spawn zones at the ends, facing the middle. */
export function spawnArt(): SVGSVGElement {
  const zone = (x: number, cls: string) => s("rect", { x: x - 14, y: 40, width: 28, height: 120, rx: 6, class: `zone ${cls}` });
  const arrow = (x1: number, x2: number) => s("line", { x1, y1: 100, x2, y2: 100, class: "arrow", "marker-end": "url(#book-arrow)" });
  return art(320, 200, t("art.spawn"),
    s("defs", {}, s("marker", { id: "book-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" },
      s("path", { d: "M0 0 L10 5 L0 10 Z", class: "arrow-head" }))),
    s("rect", { x: 10, y: 10, width: 300, height: 180, rx: 10, class: "map" }),
    zone(45, "nato"), zone(275, "soviet"), arrow(64, 140), arrow(256, 180),
    jet(45, 80, 0.8, "jet nato", 90), jet(45, 120, 0.8, "jet nato", 90), jet(275, 80, 0.8, "jet soviet", -90), jet(275, 120, 0.8, "jet soviet", -90),
    s("circle", { cx: 160, cy: 100, r: 5, class: "center" }),
    label(45, 32, t("team.nato"), "mid"), label(275, 32, t("team.soviet"), "mid"), label(160, 180, t("art.playArea", { d: dist(R.playHalf) }), "mid small"));
}
