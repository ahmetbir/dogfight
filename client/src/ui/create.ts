// Create-room form: every room setting (mode, size, bots, map, weather,
// start, visibility, seed) and the create message it sends.
import { t } from "../i18n/index.ts";
import type { Create, Difficulty, MapKind, Mode, StartKind, Visibility, WeatherKind } from "../net/protocol.ts";
import { fill, h } from "./dom.ts";

export type CreateState = {
  mode: Mode; size: number; diff: Difficulty; map: MapKind; wx: WeatherKind;
  start: StartKind; vis: Visibility; seed: string;
};

export const DEFAULT_CREATE: CreateState = {
  mode: "team", size: 2, diff: "normal", map: "ada", wx: "acik", start: "hava", vis: "acik", seed: "",
};

export const MODES: readonly Mode[] = ["team", "ffa", "base"];
export const MAPS: readonly MapKind[] = ["ada", "sehir", "col", "dag"];
export const WEATHERS: readonly WeatherKind[] = ["acik", "bulutlu", "sisli", "yagmurlu", "firtina", "gece"];
const DIFFS: readonly Difficulty[] = ["easy", "normal", "hard"];
const STARTS: readonly StartKind[] = ["pist", "hava"];
const VISES: readonly Visibility[] = ["acik", "ozel"];

/** Display names in the current language. */
export const modeName = (m: Mode) => t(`mode.${m}`);
export const mapName = (k: MapKind) => t(`map.${k}`);
export const weatherName = (k: WeatherKind) => t(`wx.${k}`);

/** Seed field: "" → random (undefined); otherwise a safe integer or null (invalid). */
export function parseSeed(s: string): number | undefined | null {
  const t = s.trim();
  if (t === "") return undefined;
  if (!/^-?\d{1,15}$/.test(t)) return null;
  return Number(t);
}

/** Size bounds per mode: team and base = per team 1–6, FFA = total 2–12. */
export function sizeRange(mode: Mode): { min: number; max: number; def: number } {
  return mode === "ffa" ? { min: 2, max: 12, def: 6 } : { min: 1, max: 6, def: 2 };
}

/** The create message for st, or the form error. */
export function createEntry(st: CreateState): Create | { error: string } {
  const seed = parseSeed(st.seed);
  if (seed === null) return { error: t("create.seedErr") };
  const e: Create = { t: "create", mode: st.mode, size: st.size, diff: st.diff, map: st.map, wx: st.wx, start: st.start, vis: st.vis };
  if (seed !== undefined) e.seed = seed;
  return e;
}

const options = <T extends string>(values: readonly T[], name: (v: T) => string): [T, string][] => values.map((v) => [v, name(v)]);

/** A row of toggle buttons; exactly one is pressed. cls adds layout classes (e.g. "grid3"). */
export function segmented<T extends string>(name: string, opts: [T, string][], value: T, onChange: (v: T) => void, cls = ""): HTMLElement {
  const box = h("div", { class: `seg ${cls}`.trim(), role: "group" });
  const buttons = opts.map(([v, label]) => {
    const b = h("button", { type: "button", class: "seg-btn", "data-v": v, "aria-pressed": String(v === value) }, label);
    b.addEventListener("click", () => {
      for (const o of buttons) o.setAttribute("aria-pressed", String(o === b));
      onChange(v);
    });
    return b;
  });
  box.setAttribute("aria-label", name);
  fill(box, ...buttons);
  return box;
}

function field(label: string, control: HTMLElement): HTMLElement {
  return h("div", { class: "field" }, h("span", {}, label), control);
}

export function createForm(onCreate: (entry: Create) => void): HTMLFormElement {
  const st: CreateState = { ...DEFAULT_CREATE };
  const size = h("input", { type: "range", class: "range", min: 1, max: 6, value: st.size, step: 1, "aria-label": t("create.size") });
  const sizeLabel = h("span", { class: "value" });
  const sizeHint = h("span", { class: "muted" });
  const syncSize = (reset: boolean) => {
    const r = sizeRange(st.mode);
    size.min = String(r.min);
    size.max = String(r.max);
    if (reset) size.value = String(r.def);
    st.size = Number(size.value);
    sizeLabel.textContent = size.value;
    sizeHint.textContent = t(st.mode === "ffa" ? "create.sizeTotal" : "create.sizeTeam", r);
  };
  size.addEventListener("input", () => syncSize(false));
  syncSize(true);
  const seed = h("input", { type: "text", class: "input", inputmode: "numeric", placeholder: t("create.seedPh"), maxlength: 16 });
  const err = h("div", { class: "form-error", role: "alert" });
  const form = h("form", { class: "panel card create-card" },
    h("h2", {}, t("create.title")),
    field(t("create.mode"), segmented(t("create.mode"), options(MODES, modeName), st.mode, (v) => { st.mode = v; syncSize(true); })),
    h("label", { class: "field" }, h("span", { class: "field-head" }, t("create.size"), sizeHint), h("div", { class: "range-row" }, size, sizeLabel)),
    field(t("create.diff"), segmented(t("create.diff"), options(DIFFS, (d) => t(`diff.${d}`)), st.diff, (v) => { st.diff = v; })),
    field(t("create.map"), segmented(t("create.map"), options(MAPS, mapName), st.map, (v) => { st.map = v; })),
    field(t("create.wx"), segmented(t("create.wx"), options(WEATHERS, weatherName), st.wx, (v) => { st.wx = v; }, "grid3")),
    h("div", { class: "field-pair" },
      field(t("create.start"), segmented(t("create.start"), options(STARTS, (k) => t(`start.${k}`)), st.start, (v) => { st.start = v; })),
      field(t("create.vis"), segmented(t("create.vis"), options(VISES, (k) => t(`vis.${k}`)), st.vis, (v) => { st.vis = v; }))),
    h("label", { class: "field" }, h("span", {}, t("create.seed")), seed),
    err, h("button", { type: "submit", class: "btn primary" }, t("create.title")));
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const entry = createEntry({ ...st, size: Number(size.value), seed: seed.value });
    if ("error" in entry) {
      err.textContent = entry.error;
      return;
    }
    err.textContent = "";
    onCreate(entry);
  });
  return form;
}
