// Chapter 3 drawings and tables: afterburner heat, control authority against
// speed, corner speeds and turn bleed (the prose: i18n/book/*/basics.ts).
import { t } from "../i18n/index.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { authority } from "../sim/flight.ts";
import { art, b, kmh, label, num, pct, s, sec, table } from "./kit.ts";
import { TURN_S, turnBleed } from "./physics.ts";
import { RULES as R } from "./rules.ts";

/** Control authority below the stall speed (the same for every aircraft). */
export const STALL_AUTHORITY = authority(0, { cornerSpeed: 1, maxSpeedAB: 2 } as Parameters<typeof authority>[1]);

/** AB heat over time: burn until the lockout, then cool to the unlock level. */
export function abArt(): SVGSVGElement {
  const lockAt = R.abBurnS, unlockAt = lockAt + (1 - R.abUnlock) * R.abCoolS, end = lockAt + R.abCoolS;
  const W = 300, H = 120, x0 = 30, y0 = 100, k = (W - x0 - 10) / end, hgt = 80;
  const X = (t: number) => x0 + t * k, Y = (v: number) => y0 - v * hgt;
  return art(W, H + 20, t("art.ab"),
    s("line", { x1: x0, y1: y0, x2: W - 10, y2: y0, class: "axis" }), s("line", { x1: x0, y1: y0, x2: x0, y2: y0 - hgt, class: "axis" }),
    s("line", { x1: x0, y1: Y(R.abUnlock), x2: W - 10, y2: Y(R.abUnlock), class: "guide" }),
    s("polyline", { points: `${X(0)},${Y(0)} ${X(lockAt)},${Y(1)} ${X(end)},${Y(0)}`, class: "curve" }),
    s("rect", { x: X(lockAt), y: y0 - hgt, width: X(unlockAt) - X(lockAt), height: hgt, class: "lockout" }),
    label(X(lockAt * 0.62), Y(0.2), t("art.abBurning"), "mid small"), label((X(lockAt) + X(unlockAt)) / 2, Y(1) + 14, t("art.abLocked"), "mid small warn"),
    label(x0 - 4, Y(R.abUnlock) + 4, pct(R.abUnlock), "end small"), label(x0 - 4, Y(1) + 4, pct(1), "end small"),
    label(X(lockAt), y0 + 14, sec(lockAt), "mid small"), label(X(unlockAt), y0 + 14, sec(unlockAt), "mid small"));
}

/** Control authority against speed for each aircraft (the sim's own function). */
export function authArt(list: AircraftInfo[]): SVGSVGElement {
  const top = Math.max(...list.map((a) => a.maxSpeedAB));
  const W = 320, x0 = 34, y0 = 120, k = (W - x0 - 10) / top, hgt = 100;
  const X = (v: number) => x0 + v * k, Y = (a: number) => y0 - a * hgt;
  const curves = list.map((a, i) => {
    const pts: string[] = [];
    for (let v = 40; v <= a.maxSpeedAB; v += 2) pts.push(`${X(v).toFixed(1)},${Y(authority(v, a)).toFixed(1)}`);
    return s("polyline", { points: pts.join(" "), class: `curve c${i}` });
  });
  return art(W, 160, t("art.auth"),
    s("line", { x1: x0, y1: y0, x2: W - 10, y2: y0, class: "axis" }), s("line", { x1: x0, y1: y0, x2: x0, y2: y0 - hgt, class: "axis" }),
    s("line", { x1: X(R.stallSpeed), y1: y0, x2: X(R.stallSpeed), y2: y0 - hgt, class: "guide" }),
    label(X(R.stallSpeed), y0 + 14, `stall ${kmh(R.stallSpeed)}`, "mid small warn"),
    ...curves, label(x0 - 4, Y(1) + 4, pct(1), "end small"), label(W - 10, y0 + 14, kmh(top), "end small"),
    ...list.map((a, i) => label(x0 + 8, 24 + i * 13, a.name, `small c${i}`)));
}

export function aircraftTable(list: AircraftInfo[]): HTMLElement {
  const kmhLoss = (a: AircraftInfo, ab: boolean) => `−${num(turnBleed(a, ab) * 3.6, 0)}`;
  return table([t("bt.aircraft"), t("bt.corner"), t("bt.maxSpeed"), t("bt.turnLoss", { s: sec(TURN_S) })], list.map((a) => [
    b(a.name), kmh(a.cornerSpeed), `${Math.round(a.maxSpeed * 3.6)} / ${kmh(a.maxSpeedAB)}`, `${kmhLoss(a, false)} / ${kmhLoss(a, true)} km/h`,
  ]));
}
