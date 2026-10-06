// UI language: Turkish (the source) and English. t() reads the current
// dictionary; setLang() switches it live (stored labels follow via relabel,
// screens that build text on demand follow on their next render).
import { EN } from "./en/index.ts";
import { relabel, track } from "./live.ts";
import { TR, type Key } from "./tr/index.ts";
import type { Msg, Params, Plural } from "./types.ts";

export type { Key } from "./tr/index.ts";
export type { Params } from "./types.ts";

export type Lang = "tr" | "en";
export const LANGS: readonly Lang[] = ["tr", "en"];

const DICTS: Record<Lang, Readonly<Record<Key, Msg>>> = { tr: TR, en: EN };
const STORE_KEY = "dogfight.lang";

type Store = Pick<Storage, "getItem" | "setItem">;

/** The session's language and its listeners (one page, one language). */
const state: { lang: Lang; listeners: Set<() => void>; plural: Partial<Record<Lang, Intl.PluralRules>> } = {
  lang: "tr", listeners: new Set(), plural: {},
};

export function lang(): Lang {
  return state.lang;
}

export function isLang(v: unknown): v is Lang {
  return v === "tr" || v === "en";
}

/** Browser preferences → language: any tr* first choice wins Turkish, everything else English. */
export function detectLang(prefs: readonly string[]): Lang {
  return /^tr\b/i.test(prefs.find((p) => p.trim() !== "") ?? "") ? "tr" : "en";
}

function safeStore(): Store | null {
  try {
    return globalThis.localStorage ?? null;
  } catch {
    return null;
  }
}

/** The stored choice, else the browser's preference. */
export function initialLang(prefs: readonly string[], store: Store | null = safeStore()): Lang {
  try {
    const v = store?.getItem(STORE_KEY);
    if (isLang(v)) return v;
  } catch {
    // storage blocked: detect every visit
  }
  return detectLang(prefs);
}

/** Switches the language (stored, <html lang>, live labels, listeners); a no-op when unchanged. */
export function setLang(l: Lang, store: Store | null = safeStore()): void {
  try {
    store?.setItem(STORE_KEY, l);
  } catch {
    // storage blocked: the choice lives for this page only
  }
  if (l === state.lang) return;
  state.lang = l;
  if (typeof document !== "undefined" && document.documentElement) document.documentElement.lang = l;
  relabel();
  for (const f of [...state.listeners]) f();
}

/** Calls f after every switch; returns the unsubscribe. */
export function onLang(f: () => void): () => void {
  state.listeners.add(f);
  return () => state.listeners.delete(f);
}

function plural(m: Plural, n: unknown): string {
  const rules = (state.plural[state.lang] ??= new Intl.PluralRules(state.lang));
  return rules.select(Number(n)) === "one" ? m.one : m.other;
}

/** The text of key in the current language; {name} placeholders take params, plural texts pick by params.n. */
export function t(key: Key, params?: Params): string {
  const m = DICTS[state.lang][key] ?? TR[key];
  const s = typeof m === "string" ? m : plural(m, params?.n);
  if (!params) return s;
  return s.replace(/\{(\w+)\}/g, (all, k: string) => (k in params ? String(params[k]) : all));
}

/** The text of key in a given language (tests, the language toggle's own labels). */
export function tIn(l: Lang, key: Key): string {
  const m = DICTS[l][key];
  return typeof m === "string" ? m : m.other;
}

/** A text node that follows language switches (long-lived labels built once). */
export function lt(key: Key, params?: Params): Text {
  return track(document.createTextNode(t(key, params)), (n) => { n.data = t(key, params); });
}

/** Sets attribute name of e to key's text, now and after every switch. */
export function lattr<E extends Element>(e: E, name: string, key: Key, params?: Params): E {
  e.setAttribute(name, t(key, params));
  return track(e, (x) => x.setAttribute(name, t(key, params)));
}
