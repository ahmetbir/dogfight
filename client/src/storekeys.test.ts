import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { initialLang } from "./i18n/index.ts";
import { loadToken } from "./net/pilot.ts";
import { lastChapter } from "./book/book.ts";
import { CHAPTERS } from "./book/chapters.ts";

const KEYS = ["dogfight.lang", "dogfight.name", "dogfight.pilot", "dogfight.settings", "dogfight.book.chapter",
  "dogfight.hint.ground", "dogfight.coach.takeoff"];

test("stored user data keeps its localStorage keys", () => {
  const m = new Map<string, string>([["dogfight.lang", "en"], ["dogfight.pilot", "AAAAAAAAAAAAAAAAAAAAA1"],
    ["dogfight.book.chapter", CHAPTERS[1].id]]);
  const st = { getItem: (k: string) => m.get(k) ?? null, setItem: (k: string, v: string) => void m.set(k, v) };
  assert.equal(initialLang(["tr-TR"], st), "en");
  assert.equal(loadToken(st), "AAAAAAAAAAAAAAAAAAAAA1");
  assert.equal(lastChapter(CHAPTERS, st), 1);
  // Every key is still spelled out once in the sources (settings, name, coach hints included).
  const src = ["ui/dom.ts", "ui/coach.ts", "net/pilot.ts", "input/schemes.ts", "book/book.ts", "i18n/index.ts"]
    .map((f) => readFileSync(new URL(f, import.meta.url), "utf8")).join("\n");
  for (const k of KEYS) assert.ok(src.includes(`"${k}"`), `${k} missing from the sources`);
});
