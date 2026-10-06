import { test } from "node:test";
import assert from "node:assert/strict";
import { keyRows } from "../input/bindings.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { builtinAircraft } from "./aircraft.ts";
import { lastChapter, tabMove, trapIndex } from "./book.ts";
import { CHAPTERS } from "./chapters.ts";
import { dist, kmh, num, speed } from "./kit.ts";
import { RULES } from "./rules.ts";

// A minimal DOM: elements with attributes and children, text nodes; enough
// for h(), s() and the chapters (no innerHTML anywhere to support).
class FakeNode {
  children: FakeNode[] = [];
  attrs = new Map<string, string>();
  style: Record<string, string> = {};
  readonly tag: string;
  private text: string;
  constructor(tag: string, text = "") {
    this.tag = tag;
    this.text = text;
  }
  appendChild(c: FakeNode) { this.children.push(c); return c; }
  setAttribute(k: string, v: string) { this.attrs.set(k, v); }
  addEventListener() {}
  get textContent(): string { return this.text + this.children.map((c) => c.textContent).join(""); }
  set textContent(v: string) { this.children = []; this.text = v; }
}
Object.assign(globalThis, {
  document: {
    createElement: (t: string) => new FakeNode(t),
    createElementNS: (_ns: string, t: string) => new FakeNode(t),
    createTextNode: (t: string) => new FakeNode("#text", t),
  },
});

const PLANES: AircraftInfo[] = [
  { kind: "f16", name: "F-16", team: "nato", maxHP: 90, maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5,
    cornerSpeed: 170, lockRange: 900, missiles: 5, flares: 8, rotateSpeed: 78 },
  { kind: "mig29", name: "MiG-29", team: "soviet", maxHP: 100, maxSpeed: 225, maxSpeedAB: 285, accel: 46, rollRate: 3.4, pitchRate: 1.75,
    yawRate: 0.5, cornerSpeed: 150, lockRange: 950, missiles: 4, flares: 10, rotateSpeed: 75 },
];

const textOf = (id: string, aircraft: AircraftInfo[]) =>
  CHAPTERS.find((c) => c.id === id)!.render({ aircraft }).map((n) => n.textContent).join(" ");

test("every chapter renders with the live and the built-in aircraft table", () => {
  assert.equal(new Set(CHAPTERS.map((c) => c.id)).size, CHAPTERS.length);
  for (const c of CHAPTERS) for (const a of [PLANES, builtinAircraft()]) assert.ok(textOf(c.id, a).length > 200, c.id);
  const weapons = textOf("silahlar", builtinAircraft());
  for (const a of builtinAircraft()) assert.ok(weapons.includes(a.name) && weapons.includes(dist(a.lockRange)), a.name);
});

test("the built-in aircraft table comes from the Go-checked rules", () => {
  const t = builtinAircraft();
  assert.deepEqual(t.map((a) => a.kind), ["f16", "f15", "mig29", "su27"]);
  assert.equal(t[0]!.maxHP, RULES.f16MaxHP);
  assert.equal(t[3]!.rotateSpeed, RULES.su27RotateSpeed);
  assert.deepEqual(t.map((a) => a.team), ["nato", "nato", "soviet", "soviet"]);
});

test("focus trap: Tab and Shift+Tab wrap inside the book; outside focus enters at an end", () => {
  assert.equal(trapIndex(0, 3, false), 1);
  assert.equal(trapIndex(2, 3, false), 0);
  assert.equal(trapIndex(0, 3, true), 2);
  assert.equal(trapIndex(-1, 3, false), 0);
  assert.equal(trapIndex(-1, 3, true), 2);
});

test("numbers come from the rules and the aircraft table", () => {
  const ground = textOf("yer", PLANES);
  for (const a of PLANES) assert.ok(ground.includes(speed(a.rotateSpeed)), a.name);
  assert.ok(ground.includes(speed(RULES.taxiGovernor)) && ground.includes(`${RULES.maxSinkRate} m/s`));
  const weapons = textOf("silahlar", PLANES);
  assert.ok(weapons.includes(dist(RULES.flareRange)) && weapons.includes(dist(RULES.flareWarn)));
  const flight = textOf("ucus", PLANES);
  assert.ok(flight.includes(kmh(PLANES[1]!.cornerSpeed)) && flight.includes(`${num(RULES.abBurnS)} sn`));
  assert.ok(/−\d+ km\/h/.test(flight), "turn bleed computed by the flight model");
  const world = textOf("dunya", PLANES);
  assert.ok(world.includes(dist(PLANES[0]!.lockRange * RULES.lockMulSisli)), "fog lock range");
});

test("the controls chapter lists every binding of every scheme", () => {
  const t = textOf("kontroller", PLANES);
  for (const s of ["mouse", "keyboard", "touch"] as const) for (const [k, what] of keyRows(s)) assert.ok(t.includes(k) && t.includes(what), `${s} ${k}`);
});

test("tab keys wrap; the last chapter is remembered by id", () => {
  assert.equal(tabMove("ArrowDown", 8, 9), 0);
  assert.equal(tabMove("ArrowUp", 0, 9), 8);
  assert.equal(tabMove("End", 2, 9), 8);
  assert.equal(tabMove("Enter", 2, 9), null);
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "hud" }), CHAPTERS.findIndex((c) => c.id === "hud"));
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "nope" }), 0);
  assert.equal(lastChapter(CHAPTERS, { getItem: () => { throw new Error("blocked"); } }), 0);
});

test("the weapons chapter covers the missile loadouts with the Go-checked radar numbers", () => {
  const w = textOf("silahlar", PLANES);
  for (const s of ["IR (kısa menzil)", "Radar (orta menzil)", "Karışık", "DİK UÇ!", "2 IR + 1 R", `${RULES.radarLeashDeg}°`]) assert.ok(w.includes(s), s);
  assert.ok(w.includes(dist(PLANES[0]!.lockRange * RULES.radarRangeMul)), "radar lock range");
});
