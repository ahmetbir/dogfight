// Chapter 6 drawings and tables: base attack targets (the prose: i18n/book/*/combat.ts).
import { t, type Key } from "../i18n/index.ts";
import type { AircraftInfo, Team } from "../net/protocol.ts";
import { art, b, dist, label, s, table } from "./kit.ts";
import { RULES as R } from "./rules.ts";

const TARGETS: [Key, number, number][] = [
  ["bt.tHangar", R.hangarTargets, R.hangarHP], ["bt.tFuel", R.fuelTargets, R.fuelHP], ["bt.tRadar", R.radarTargets, R.radarHP],
  ["bt.tAA", R.aaTargets, R.aaHP],
];

/** " (F-16, F-15)": a team's aircraft names, "" when the table is unknown. */
export const fleet = (list: AircraftInfo[], team: Team) => {
  const names = list.filter((a) => a.team === team).map((a) => a.name);
  return names.length ? ` (${names.join(", ")})` : "";
};

/** One base's targets around the runway, with the AA's reach. */
export function targetsArt(): SVGSVGElement {
  const tg = (x: number, y: number, w: number, hgt: number, name: string) => [
    s("rect", { x, y, width: w, height: hgt, class: "target" }), label(x + w / 2, y + hgt + 12, name, "mid small"),
  ];
  return art(340, 180, t("art.targets"),
    s("circle", { cx: 170, cy: 118, r: 50, class: "aa-zone" }),
    s("rect", { x: 20, y: 30, width: 300, height: 18, class: "runway" }),
    ...tg(70, 80, 26, 18, t("art.hangar")), ...tg(244, 80, 26, 18, t("art.hangar")), ...tg(282, 66, 14, 14, ""), ...tg(304, 66, 14, 14, ""),
    label(300, 92, t("art.fuel"), "mid small"),
    ...tg(26, 70, 10, 14, t("art.radar")), ...tg(162, 112, 16, 12, "AA"),
    label(170, 178, t("art.aaRange", { d: dist(R.aaRange) }), "mid small warn"));
}

/** Each target kind with its count and HP, and the base's total. */
export function targetTable(): HTMLElement {
  return table([t("bt.target"), t("bt.count"), t("bt.hp")],
    [...TARGETS.map(([n, c, hp]) => [t(n), String(c), String(hp)]), [b(t("bt.total")), String(R.targetsPerBase), b(String(R.baseHP))]]);
}
