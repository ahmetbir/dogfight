// UI language: Turkish (the source) and English, on the core i18n. t() reads
// the current dictionary; setLang() switches it live.
import { createI18n } from "roomkit/i18n/i18n";
import { EN } from "./en/index.ts";
import { TR, type Key } from "./tr/index.ts";

export type { Key } from "./tr/index.ts";
export type { Params } from "roomkit/i18n/types";

export type Lang = "tr" | "en";
export const LANGS: readonly Lang[] = ["tr", "en"];

const i18n = createI18n<Lang, Key>({
  dicts: { tr: TR, en: EN }, source: "tr", langs: LANGS, storeKey: "dogfight.lang",
  /** Browser preferences → language: any tr* first choice wins Turkish, everything else English. */
  detect: (prefs) => (/^tr\b/i.test(prefs.find((p) => p.trim() !== "") ?? "") ? "tr" : "en"),
});

export const { lang, isLang, detectLang, initialLang, setLang, onLang, t, tIn, lt, lattr } = i18n;
