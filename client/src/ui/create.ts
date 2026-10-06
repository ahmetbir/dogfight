// Create-room form: every room setting (mode, size, bots, map, weather,
// start, visibility, seed) and the create message it sends.
import type { Create, Difficulty, MapKind, Mode, StartKind, Visibility, WeatherKind } from "../net/protocol.ts";
import { fill, h } from "./dom.ts";

export type CreateState = {
  mode: Mode; size: number; diff: Difficulty; map: MapKind; wx: WeatherKind;
  start: StartKind; vis: Visibility; seed: string;
};

export const DEFAULT_CREATE: CreateState = {
  mode: "team", size: 2, diff: "normal", map: "ada", wx: "acik", start: "hava", vis: "acik", seed: "",
};

export const MODE_NAMES: Record<Mode, string> = { team: "Takımlı", ffa: "Herkes Herkese", base: "Üs Saldırısı" };
export const MAP_NAMES: Record<MapKind, string> = { ada: "Ada", sehir: "Şehir", col: "Çöl", dag: "Dağ" };
export const WEATHER_NAMES: Record<WeatherKind, string> = {
  acik: "Açık", bulutlu: "Bulutlu", sisli: "Sisli", yagmurlu: "Yağmurlu", firtina: "Fırtına", gece: "Gece",
};
const DIFF_NAMES: Record<Difficulty, string> = { easy: "Kolay", normal: "Normal", hard: "Zor" };
const START_NAMES: Record<StartKind, string> = { pist: "Pist", hava: "Havada" };
const VIS_NAMES: Record<Visibility, string> = { acik: "Açık", ozel: "Özel" };

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
  if (seed === null) return { error: "Seed bir tam sayı olmalı." };
  const e: Create = { t: "create", mode: st.mode, size: st.size, diff: st.diff, map: st.map, wx: st.wx, start: st.start, vis: st.vis };
  if (seed !== undefined) e.seed = seed;
  return e;
}

const options = <T extends string>(names: Record<T, string>): [T, string][] => Object.entries(names) as [T, string][];

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
  const size = h("input", { type: "range", class: "range", min: 1, max: 6, value: st.size, step: 1, "aria-label": "Boyut" });
  const sizeLabel = h("span", { class: "value" });
  const sizeHint = h("span", { class: "muted" });
  const syncSize = (reset: boolean) => {
    const r = sizeRange(st.mode);
    size.min = String(r.min);
    size.max = String(r.max);
    if (reset) size.value = String(r.def);
    st.size = Number(size.value);
    sizeLabel.textContent = size.value;
    sizeHint.textContent = st.mode === "ffa" ? `toplam ${r.min}–${r.max}` : `takım başına ${r.min}–${r.max}`;
  };
  size.addEventListener("input", () => syncSize(false));
  syncSize(true);
  const seed = h("input", { type: "text", class: "input", inputmode: "numeric", placeholder: "boş = rastgele", maxlength: 16 });
  const err = h("div", { class: "form-error", role: "alert" });
  const form = h("form", { class: "panel card create-card" },
    h("h2", {}, "Oda Kur"),
    field("Mod", segmented("Mod", options(MODE_NAMES), st.mode, (v) => { st.mode = v; syncSize(true); })),
    h("label", { class: "field" }, h("span", { class: "field-head" }, "Boyut", sizeHint), h("div", { class: "range-row" }, size, sizeLabel)),
    field("Bot zorluğu", segmented("Bot zorluğu", options(DIFF_NAMES), st.diff, (v) => { st.diff = v; })),
    field("Harita", segmented("Harita", options(MAP_NAMES), st.map, (v) => { st.map = v; })),
    field("Hava", segmented("Hava", options(WEATHER_NAMES), st.wx, (v) => { st.wx = v; }, "grid3")),
    h("div", { class: "field-pair" },
      field("Kalkış", segmented("Kalkış", options(START_NAMES), st.start, (v) => { st.start = v; })),
      field("Görünürlük", segmented("Görünürlük", options(VIS_NAMES), st.vis, (v) => { st.vis = v; }))),
    h("label", { class: "field" }, h("span", {}, "Harita seed'i"), seed),
    err, h("button", { type: "submit", class: "btn primary" }, "Oda Kur"));
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
