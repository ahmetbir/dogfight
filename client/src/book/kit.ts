// Building blocks of the pilot's manual: number formatting, text blocks and
// a tiny SVG builder. DOM only through createElement(NS) and text nodes.
import type { AircraftInfo } from "../net/protocol.ts";
import { append, h, type Child } from "../ui/dom.ts";

/** What a chapter renders from: the aircraft table (the welcome's in a game, else the built-in one). */
export type BookCtx = { aircraft: AircraftInfo[] };

export type Chapter = { id: string; title: string; render(ctx: BookCtx): Node[] };

// ---- numbers ----

/** Rounded with at most `digits` decimals, Turkish decimal comma: 0.55 → "0,55". */
export function num(v: number, digits = 1): string {
  const r = Math.round(v * 10 ** digits) / 10 ** digits;
  return String(r).replace(".", ",");
}

export const kmh = (ms: number) => `${Math.round(ms * 3.6)} km/h`;
/** "28 m/s (101 km/h)". */
export const speed = (ms: number) => `${num(ms)} m/s (${kmh(ms)})`;
export const sec = (s: number) => `${num(s)} sn`;
export const pct = (x: number) => `%${Math.round(x * 100)}`;
/** 900 → "900 m", 1500 → "1,5 km". */
export const dist = (m: number) => (m >= 1000 ? `${num(m / 1000, 2)} km` : `${Math.round(m)} m`);

// ---- text blocks ----

export const p = (...c: Child[]) => h("p", {}, ...c);
export const b = (...c: Child[]) => h("strong", {}, ...c);
export const kbd = (k: string) => h("kbd", {}, k);
export const sub = (title: string) => h("h3", { class: "book-sub" }, title);

/** A bullet list; each item may mix text and nodes. */
export function list(...items: Child[][]): HTMLElement {
  return h("ul", { class: "book-list" }, ...items.map((c) => h("li", {}, ...c)));
}

/** A numbered list. */
export function steps(...items: Child[][]): HTMLElement {
  return h("ol", { class: "book-steps" }, ...items.map((c) => h("li", {}, ...c)));
}

/** A tip / warning box. */
export const note = (kind: "tip" | "warn", ...c: Child[]) => h("div", { class: `book-note ${kind}` }, ...c);

/** A simple table: header row and body rows. */
export function table(head: string[], rows: Child[][]): HTMLElement {
  return h("div", { class: "book-table-wrap" }, h("table", { class: "book-table" },
    h("thead", {}, h("tr", {}, ...head.map((x) => h("th", {}, x)))),
    h("tbody", {}, ...rows.map((r) => h("tr", {}, ...r.map((c) => h("td", {}, c)))))));
}

/** A figure: an SVG drawing with a caption. */
export const figure = (art: SVGSVGElement, caption: string) => h("figure", { class: "book-fig" }, art, h("figcaption", {}, caption));

// ---- SVG ----

const NS = "http://www.w3.org/2000/svg";
type SAttrs = Record<string, string | number>;

/** An SVG element; children may be text (as text nodes). */
export function s<K extends keyof SVGElementTagNameMap>(tag: K, attrs: SAttrs = {}, ...children: Child[]): SVGElementTagNameMap[K] {
  const e = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  append(e, ...children);
  return e;
}

/** An <svg> canvas of w × h user units that scales to its box; label is its accessible name. */
export function art(w: number, hgt: number, label: string, ...children: Child[]): SVGSVGElement {
  return s("svg", { viewBox: `0 0 ${w} ${hgt}`, class: w < 400 ? "book-art narrow" : "book-art", role: "img", "aria-label": label }, s("title", {}, label), ...children);
}

/** A text label in the drawing. */
export const label = (x: number, y: number, t: string, cls = "") => s("text", { x, y, class: `t ${cls}`.trim() }, t);

/** A plane silhouette pointing up (−y), centered on (x, y), scaled by k. */
export function jet(x: number, y: number, k = 1, cls = "jet", rot = 0): SVGGElement {
  return s("g", { transform: `translate(${x} ${y}) rotate(${rot}) scale(${k})`, class: cls },
    s("path", { d: "M0 -14 L3 -6 L3 -2 L13 4 L13 7 L3 5 L2 10 L6 13 L6 15 L0 14 L-6 15 L-6 13 L-2 10 L-3 5 L-13 7 L-13 4 L-3 -2 L-3 -6 Z" }));
}

/** Appends nodes to a parent (re-export for chapters building in steps). */
export { append };
