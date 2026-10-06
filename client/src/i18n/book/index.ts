// The pilot's manual prose in every language.
import type { Lang } from "../index.ts";
import { basics as enBasics } from "./en/basics.ts";
import { combat as enCombat } from "./en/combat.ts";
import { field as enField } from "./en/field.ts";
import { basics as trBasics } from "./tr/basics.ts";
import { combat as trCombat } from "./tr/combat.ts";
import { field as trField } from "./tr/field.ts";
import type { BookText } from "./types.ts";

export const BOOK: Record<Lang, BookText> = {
  tr: { ...trBasics, ...trCombat, ...trField },
  en: { ...enBasics, ...enCombat, ...enField },
};
