import { test } from "node:test";
import assert from "node:assert/strict";
import { EN, EN_AREAS } from "./en/index.ts";
import { dist, num, pct, sec } from "./format.ts";
import { detectLang, initialLang, lang, lattr, lt, onLang, setLang, t, tIn, type Key } from "./index.ts";
import { liveCount } from "./live.ts";
import { TR, TR_AREAS } from "./tr/index.ts";
import type { Msg } from "./types.ts";

// Just enough DOM for text nodes and attributes (lt / lattr).
class FakeText {
  data: string;
  constructor(s: string) { this.data = s; }
}
class FakeEl {
  attrs = new Map<string, string>();
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
}
const html = { lang: "tr" };
Object.assign(globalThis, { document: { createTextNode: (s: string) => new FakeText(s), documentElement: html } });

const memStore = () => {
  const m = new Map<string, string>();
  return { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v), m };
};

/** The {name} placeholders of a text (both plural forms together). */
const holes = (m: Msg) => [...new Set([...(typeof m === "string" ? m : m.one + m.other).matchAll(/\{(\w+)\}/g)].map((x) => x[1]))].sort();

test("every Turkish key has an English text and vice versa, area by area, with the same placeholders", () => {
  assert.deepEqual(Object.keys(EN_AREAS).sort(), Object.keys(TR_AREAS).sort());
  for (const [area, tr] of Object.entries(TR_AREAS)) {
    const en = EN_AREAS[area as keyof typeof EN_AREAS];
    assert.deepEqual(Object.keys(en).sort(), Object.keys(tr).sort(), area);
  }
  assert.deepEqual(Object.keys(EN).sort(), Object.keys(TR).sort());
  for (const k of Object.keys(TR) as Key[]) {
    assert.deepEqual(holes(EN[k]), holes(TR[k]), k);
    const texts = [TR[k], EN[k]].flatMap((m) => (typeof m === "string" ? [m] : [m.one, m.other]));
    for (const s of texts) assert.ok(s.trim() !== "", `${k} is empty`);
  }
});

test("areas never share a key (a later spread would silently win)", () => {
  const seen = new Map<string, string>();
  for (const [area, dict] of Object.entries(TR_AREAS)) {
    for (const k of Object.keys(dict)) {
      assert.ok(!seen.has(k), `${k} in ${seen.get(k)} and ${area}`);
      seen.set(k, area);
    }
  }
});

test("detection: a Turkish first preference is Turkish, anything else English", () => {
  assert.equal(detectLang(["tr-TR", "en-US"]), "tr");
  assert.equal(detectLang(["tr"]), "tr");
  assert.equal(detectLang(["en-US", "tr-TR"]), "en");
  assert.equal(detectLang(["de-DE"]), "en");
  assert.equal(detectLang([]), "en");
  assert.equal(detectLang(["trk"]), "en", "only the tr language tag");
});

test("the stored choice wins over detection; blocked storage falls back to detection", () => {
  const s = memStore();
  assert.equal(initialLang(["tr-TR"], s), "tr");
  s.setItem("dogfight.lang", "en");
  assert.equal(initialLang(["tr-TR"], s), "en");
  s.setItem("dogfight.lang", "xx");
  assert.equal(initialLang(["de"], s), "en");
  const blocked = { getItem: () => { throw new Error("blocked"); }, setItem: () => { throw new Error("blocked"); } };
  assert.equal(initialLang(["tr"], blocked), "tr");
  assert.equal(initialLang(["tr"], null), "tr");
  setLang("tr", blocked); // a blocked store never throws
});

test("t: params, plurals and the language in use", () => {
  assert.equal(lang(), "tr");
  assert.equal(t("watch.label", { name: "Viper" }), "İzliyorsun: Viper");
  assert.equal(t("pc.crashes", { n: 1 }), "1 kaza");
  assert.equal(t("hud.oob", {}), "SAVAŞ ALANINA DÖN {n}", "a missing param stays visible");
  setLang("en", null);
  try {
    assert.equal(t("watch.label", { name: "Viper" }), "Watching: Viper");
    assert.equal(t("pc.crashes", { n: 1 }), "1 crash");
    assert.equal(t("pc.crashes", { n: 3 }), "3 crashes");
    assert.equal(tIn("tr", "home.quick"), "Hızlı Oyna");
  } finally {
    setLang("tr", null);
  }
});

test("numbers and units follow the language", () => {
  assert.deepEqual([num(0.55, 2), sec(2.5), pct(0.55), dist(1500), dist(900)], ["0,55", "2,5 sn", "%55", "1,5 km", "900 m"]);
  setLang("en", null);
  try {
    assert.deepEqual([num(0.55, 2), sec(2.5), pct(0.55), dist(1500), dist(900)], ["0.55", "2.5 s", "55%", "1.5 km", "900 m"]);
  } finally {
    setLang("tr", null);
  }
});

test("a switch relabels live text nodes and attributes, sets <html lang>, stores the choice and tells listeners", () => {
  const s = memStore();
  const label = lt("hud.prot") as unknown as FakeText;
  const el = lattr(new FakeEl() as unknown as Element, "aria-label", "chat.aria") as unknown as FakeEl;
  let heard = 0;
  const off = onLang(() => heard++);
  assert.equal(label.data, "KORUMA");
  assert.equal(el.attrs.get("aria-label"), "Hızlı sohbet");
  setLang("en", s);
  assert.deepEqual([label.data, el.attrs.get("aria-label"), html.lang, s.m.get("dogfight.lang"), heard], ["PROTECTED", "Quick chat", "en", "en", 1]);
  setLang("en", s);
  assert.equal(heard, 1, "no-op when unchanged");
  setLang("tr", s);
  off();
  setLang("en", s);
  setLang("tr", s);
  assert.deepEqual([label.data, html.lang, heard], ["KORUMA", "tr", 2]);
  assert.ok(liveCount() >= 2);
});
