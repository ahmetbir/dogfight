import { test } from "node:test";
import assert from "node:assert/strict";
import { keyRows } from "../input/bindings.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { builtinAircraft } from "./aircraft.ts";
import { lastChapter } from "./book.ts";
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
  assert.deepEqual(t.map((a) => a.kind).slice(0, 5), ["f16", "f15", "mig29", "su27", "f22"]);
  assert.equal(t.length, 17);
  assert.equal(t[0]!.maxHP, RULES.f16MaxHP);
  assert.equal(t[3]!.rotateSpeed, RULES.su27RotateSpeed);
  assert.equal(t[16]!.lockRange, RULES.mig23LockRange);
  assert.equal(t.filter((a) => a.team === "nato").length, 9);
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

test("the last chapter is remembered by id", () => {
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "hud" }), CHAPTERS.findIndex((c) => c.id === "hud"));
  assert.equal(lastChapter(CHAPTERS, { getItem: () => "nope" }), 0);
  assert.equal(lastChapter(CHAPTERS, { getItem: () => { throw new Error("blocked"); } }), 0);
});

test("the weapons chapter covers the missile loadouts with the Go-checked radar numbers", () => {
  const w = textOf("silahlar", PLANES);
  for (const s of ["IR (kısa menzil)", "Radar (orta menzil)", "Karışık", "DİK UÇ!", "2 IR + 1 R", `${RULES.radarLeashDeg}°`]) assert.ok(w.includes(s), s);
  assert.ok(w.includes(dist(PLANES[0]!.lockRange * RULES.radarRangeMul)), "radar lock range");
});

test("every chapter has an English version with the same structure and no Turkish left", async () => {
  const { setLang } = await import("../i18n/index.ts");
  const shape = (nodes: Node[]) => {
    const count: Record<string, number> = {};
    const walk = (n: FakeNode) => {
      if (["h3", "figure", "table", "ul", "ol", "li", "svg"].includes(n.tag)) count[n.tag] = (count[n.tag] ?? 0) + 1;
      n.children.forEach(walk);
    };
    (nodes as unknown as FakeNode[]).forEach(walk);
    return count;
  };
  const tr = CHAPTERS.map((c) => [c.title(), shape(c.render({ aircraft: PLANES }))] as const);
  setLang("en", null);
  try {
    CHAPTERS.forEach((c, i) => {
      assert.notEqual(c.title(), tr[i]![0], `${c.id} title`);
      assert.deepEqual(shape(c.render({ aircraft: PLANES })), tr[i]![1], c.id);
      const text = textOf(c.id, PLANES).replaceAll("Türkçe", ""); // the language's own name
      assert.ok(!/[çğıİöşüÇĞÖŞÜ]/.test(text), `${c.id}: ${text.match(/.{0,30}[çğıİöşüÇĞÖŞÜ].{0,30}/)?.[0]}`);
    });
    const weapons = textOf("silahlar", PLANES);
    for (const s of ["IR (short range)", "Radar (medium range)", "Mixed", "BEAM IT!", "2 IR + 1 R", dist(RULES.flareRange)]) assert.ok(weapons.includes(s), s);
    assert.ok(textOf("ucus", PLANES).includes(`${num(RULES.abBurnS)} s`) && num(1.5) === "1.5", "English decimal point and seconds");
    for (const [k, what] of keyRows("touch")) assert.ok(textOf("kontroller", PLANES).includes(k) && textOf("kontroller", PLANES).includes(what), k);
  } finally {
    setLang("tr", null);
  }
});

test("the aircraft chapter lists all seventeen with their roles, by side", () => {
  const all = builtinAircraft();
  const text = textOf("ucaklar", all);
  for (const a of all) assert.ok(text.includes(a.name) && text.includes(kmh(a.maxSpeedAB)), a.name);
  for (const tag of ["Hafif, çevik", "Çok amaçlı", "Gizli, 5. nesil", "Önleme", "Taarruz", "Ucuz, hafif", "Eski, hızlı"]) assert.ok(text.includes(tag), tag);
  assert.ok(text.includes("(F-14, MiG-31)") && text.includes("(A-10, Su-25)"), "role groups name their aircraft");
  const tables = (CHAPTERS.find((c) => c.id === "ucaklar")!.render({ aircraft: all }) as unknown as { tag: string }[]).filter((n) => n.tag === "div");
  assert.ok(tables.length >= 2, "a table per side");
});

test("the authority drawing keeps at most four curves: the corner and top speed extremes", async () => {
  const { authKinds } = await import("./ch-flight.ts");
  const all = builtinAircraft();
  const pick = authKinds(all).map((a) => a.kind);
  assert.ok(pick.length >= 2 && pick.length <= 4, pick.join());
  assert.ok(pick.includes("mig31"), "fastest and highest corner speed");
  assert.ok(pick.includes("a10"), "slowest");
  assert.deepEqual(authKinds(PLANES), PLANES);
});

test("the bombs line gives the attack jets' own load from the rules", async () => {
  const { extraBombs } = await import("./ch-aircraft.ts");
  assert.equal(extraBombs(), ` (A-10, Su-25: ${RULES.bombs + RULES.a10ExtraBombs})`);
  const text = textOf("silahlar", builtinAircraft());
  assert.ok(text.includes(`bomba (A-10, Su-25: 4)`), "tr weapons chapter");
});
