import { test } from "node:test";
import assert from "node:assert/strict";
import { AIRCRAFT } from "../book/rules.ts";
import { builtinAircraft } from "../book/aircraft.ts";
import { setLang, tIn } from "../i18n/index.ts";
import type { AircraftKind } from "../net/protocol.ts";
import { firstSelection, hangarStats, ROLE, roleLine, roleTag, step } from "./hangar.ts";
import { kindsFor } from "./pick.ts";

const ALL = builtinAircraft();
const KINDS = Object.keys(AIRCRAFT) as AircraftKind[];

test("every kind has a role, a role tag and a role line in both languages", () => {
  assert.deepEqual(Object.keys(ROLE).sort(), [...KINDS].sort());
  for (const lang of ["tr", "en"] as const) {
    for (const k of KINDS) {
      assert.ok(tIn(lang, `role.${k}` as never).length > 20, `${lang} role.${k}`);
      assert.ok(tIn(lang, `role.${ROLE[k]}` as never).length > 3, `${lang} role.${ROLE[k]}`);
    }
  }
  setLang("en");
  assert.equal(roleTag("mig31"), "Interceptor");
  assert.match(roleLine("a10"), /two extra bombs/);
  setLang("tr");
  assert.equal(roleTag("zeppelin"), "");
  assert.equal(roleLine("zeppelin"), "");
});

test("the hangar shows nine NATO and eight Soviet cards, in the table's order", () => {
  assert.deepEqual(kindsFor("nato", ALL).map((a) => a.kind), ["f16", "f15", "f22", "f14", "a10", "rafale", "typhoon", "f18", "f4"]);
  assert.deepEqual(kindsFor("soviet", ALL).map((a) => a.kind), ["mig29", "su27", "su57", "mig31", "su25", "mig21", "su30", "mig23"]);
  assert.equal(kindsFor("none", ALL).length, 17);
});

test("stat bars: speed, agility, toughness, missiles, lock range scaled over the whole table", () => {
  const bars = (k: string) => hangarStats(ALL.find((a) => a.kind === k)!, ALL);
  assert.deepEqual(bars("f16").map((b) => b.key), ["speed", "agility", "toughness", "missiles", "lock"]);
  const fill = (k: string, key: string) => bars(k).find((b) => b.key === key)!.fill;
  for (const k of KINDS) for (const b of bars(k)) assert.ok(b.fill >= 1 / 6 - 1e-9 && b.fill <= 1 + 1e-9, `${k} ${b.key} ${b.fill}`);
  assert.equal(fill("mig31", "speed"), 1);       // the fastest
  assert.equal(fill("mig31", "lock"), 1);        // the longest lock
  assert.equal(fill("a10", "speed"), 1 / 6);     // the slowest
  assert.equal(fill("su25", "toughness"), 1);    // the toughest
  assert.equal(fill("mig21", "toughness"), 1 / 6);
  assert.equal(fill("mig21", "missiles"), 1 / 6);
  assert.ok(fill("rafale", "agility") > fill("mig31", "agility"));
  assert.ok(fill("f16", "agility") > fill("f4", "agility"));
  assert.match(bars("f16").find((b) => b.key === "speed")!.value, /^\d+ km\/h$/);
});

test("arrow keys walk the grid, Home and End jump, other keys do nothing", () => {
  // 9 cards, 3 columns
  assert.equal(step(0, "ArrowRight", 3, 9), 1);
  assert.equal(step(8, "ArrowRight", 3, 9), 8);
  assert.equal(step(0, "ArrowLeft", 3, 9), 0);
  assert.equal(step(1, "ArrowDown", 3, 9), 4);
  assert.equal(step(7, "ArrowDown", 3, 9), 7);   // no row below
  assert.equal(step(4, "ArrowUp", 3, 9), 1);
  assert.equal(step(1, "ArrowUp", 3, 9), 1);
  assert.equal(step(6, "ArrowDown", 2, 8), 6);   // 8 cards, 2 columns: last row full
  assert.equal(step(5, "ArrowDown", 2, 8), 7);
  assert.equal(step(4, "Home", 3, 9), 0);
  assert.equal(step(4, "End", 3, 9), 8);
  assert.equal(step(4, "x", 3, 9), null);
  assert.equal(step(0, "ArrowRight", 0, 9), 1);  // no layout yet: one column
  assert.equal(step(0, "ArrowRight", 3, 0), null);
});

test("the selection opens on my last pick, else what I fly, else the first card", () => {
  const nato = kindsFor("nato", ALL).map((a) => a.kind);
  assert.equal(firstSelection(nato, "a10", "f16"), "a10");
  assert.equal(firstSelection(nato, null, "f14"), "f14");
  assert.equal(firstSelection(nato, "mig29", null), "f16"); // the other side's pick (switched teams)
  assert.equal(firstSelection([], null, null), null);
});
