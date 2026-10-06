// The TR / EN switch (home page header, settings menu).
import { langToggle as core } from "../core/ui/lang.ts";
import { lang, LANGS, setLang, t, tIn, type Lang } from "../i18n/index.ts";

/** Two toggle buttons; a click switches the language, then `switched` re-renders what is not live. */
export const langToggle = (switched?: (l: Lang) => void): HTMLElement =>
  core({ lang, setLang, tIn, t }, LANGS, () => t("lang.label"), switched);
