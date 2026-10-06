// Numbers and units in the current language: Turkish writes a decimal comma
// and "%55", English a decimal point and "55%"; seconds are "sn" / "s".
import { lang, t } from "./index.ts";

const sep = (s: string) => (lang() === "tr" ? s.replace(".", ",") : s);

/** Rounded with at most `digits` decimals: 0.55 → "0,55" (tr) / "0.55" (en). */
export function num(v: number, digits = 1): string {
  return sep(String(Math.round(v * 10 ** digits) / 10 ** digits));
}

/** Exactly `digits` decimals: 1.25 → "1,3" / "1.3". */
export function fixed(v: number, digits: number): string {
  return sep(v.toFixed(digits));
}

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
