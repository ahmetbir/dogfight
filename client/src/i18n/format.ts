// Numbers and units in the current language: Turkish writes a decimal comma
// and "%55", English a decimal point and "55%"; seconds are "sn" / "s".
import { makeFormat } from "roomkit/i18n/format";
import { lang, t } from "./index.ts";

export const { num, fixed } = makeFormat(() => lang() === "tr");

/** m/s → "101 km/h". */
export const kmh = (ms: number) => `${Math.round(ms * 3.6)} km/h`;
/** "28 m/s (101 km/h)". */
export const speed = (ms: number) => `${num(ms)} m/s (${kmh(ms)})`;
/** "2,5 sn" / "2.5 s". */
export const sec = (s: number) => t("unit.sec", { n: num(s) });
/** 0.55 → "%55" / "55%". */
export const pct = (x: number) => t("unit.pct", { n: Math.round(x * 100) });
/** 900 → "900 m", 1500 → "1,5 km" / "1.5 km". */
export const dist = (m: number) => (m >= 1000 ? `${num(m / 1000, 2)} km` : `${Math.round(m)} m`);
