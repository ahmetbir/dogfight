// The manual's chapters, in reading order; each renders in the current language.
import { BOOK } from "../i18n/book/index.ts";
import type { ChapterName } from "../i18n/book/types.ts";
import { lang, t, type Key } from "../i18n/index.ts";
import type { Chapter } from "./kit.ts";

/** Chapter id (stable: remembered in storage), its prose and its title key. */
const ORDER: [string, ChapterName, Key][] = [
  ["baslangic", "start", "ch.start"], ["kontroller", "controls", "ch.controls"], ["ucus", "flight", "ch.flight"], ["ucaklar", "aircraft", "ch.aircraft"], ["yer", "ground", "ch.ground"],
  ["silahlar", "weapons", "ch.weapons"], ["modlar", "modes", "ch.modes"], ["dunya", "world", "ch.world"], ["hud", "hud", "ch.hud"],
  ["ipuclari", "tips", "ch.tips"],
];

export const CHAPTERS: readonly Chapter[] = ORDER.map(([id, name, title]) => ({
  id, title: () => t(title), render: (ctx) => BOOK[lang()][name](ctx),
}));
