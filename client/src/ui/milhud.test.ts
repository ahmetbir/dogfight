import { test } from "node:test";
import assert from "node:assert/strict";
import type { HudView } from "../game/events.ts";
import { v3 } from "../sim/vec.ts";
import { drawSymbology, layout, pipperMark, planeHole, readouts } from "./milhud.ts";
import { dirOf, fpmDir, headingDeg, ladderHeading } from "./milmath.ts";
import { leadMark, type ReticleView } from "./reticle.ts";

/** A HudView of a plane flying level and fast, nothing special going on. */
function view(over: Partial<HudView> = {}): HudView {
  return {
    alive: true, speed: 200, alt: 1500, hp: 100, maxHP: 100, th: 0.8, ab: false, heat: 0, overheated: false, missiles: 4, flares: 20,
    respawnS: 0, lockProgress: 0, locked: false, oobS: 0, scheme: "mouse", pointerLocked: true, invertY: false, rotateSpeed: 60,
    muzzle: 8, span: 10, gLoad: 1, gfx: false, protected: false, lockTarget: 0, lockRange: 6000, radars: 0, loadout: "ir", lockKind: "ir",
    damage: { engine: 0, controls: 0, avionics: 0 }, fires: "ir", picked: false, gear: false, gearWanted: false, brake: false,
    onGround: false, rearm: 0, bombs: 0, baseMode: false, abHeat: 0, abLocked: false,
    pos: v3(0, 1500, 0), vel: v3(0, 0, -200), fwd: v3(0, 0, -1), up: v3(0, 1, 0), aimDir: null, backdrop: null,
    project: (p) => ({ x: 640 + p.x, y: 360 - (p.y - 1500) }),
    planeAt: () => null, planeNow: () => null,
    ...over,
  } as HudView;
}

test("readouts: speed in the unit, altitude, heading", () => {
  const t = readouts(view(), "kmh");
  assert.equal(t.speed, "720");
  assert.equal(t.alt, "1500");
  assert.equal(t.heading, "000");
  assert.equal(readouts(view(), "kt").speed, "389");
  assert.equal(readouts(view({ alt: -3 }), "kmh").alt, "0");
});

test("readouts: left column G, Mach, throttle, then the afterburner row by state", () => {
  assert.deepEqual(readouts(view(), "kmh").left.map((r) => r.slice(0, 3)), ["G  ", "M  ", "THR"]);
  assert.equal(readouts(view({ ab: true, abHeat: 0.42 }), "kmh").left[3], "AB  42%");
  assert.equal(readouts(view({ ab: true, abLocked: true }), "kmh").left[3], "AB HOT");
  assert.equal(readouts(view({ abLocked: true }), "kmh").left[3], "AB HOT");
  assert.equal(readouts(view({ abHeat: 0.5 }), "kmh").left.length, 3, "AB off and not locked: no row");
});

test("readouts: GEAR while down or moving, BRAKE for the wheel brake and the parking brake", () => {
  const rows = (o: Partial<HudView>, parked = false) => readouts(view(o), "kmh", parked).right.slice(1);
  assert.deepEqual(rows({}), []);
  assert.deepEqual(rows({ gear: true, gearWanted: true }), ["GEAR"]);
  assert.deepEqual(rows({ gear: false, gearWanted: true }), ["GEAR .."]);
  assert.deepEqual(rows({ brake: true }), ["BRAKE"]);
  assert.deepEqual(rows({}, true), ["BRAKE"], "the runway-spawn parking brake shows too");
  assert.deepEqual(rows({ brake: true }, true), ["BRAKE"], "once");
  assert.equal(readouts(view({ vel: v3(0, 12.4, 0) }), "kmh").right[0].trim(), "VS   +12");
});

test("readouts: RNG row by loadout, pick and lock range", () => {
  const rng = (o: Partial<HudView>) => readouts(view(o), "kmh").weapons.find((w) => w.text.startsWith("RNG"))?.text;
  assert.equal(rng({ lockRange: 0 }), "RNG --");
  const ir = rng({ loadout: "ir" });
  const radar = rng({ loadout: "radar" });
  assert.notEqual(ir, radar, "radar reaches further");
  assert.equal(rng({ loadout: "mixed", picked: true, fires: "ir" }), ir);
  assert.equal(rng({ loadout: "mixed", picked: true, fires: "radar" }), radar);
  const both = rng({ loadout: "mixed", picked: false })!;
  assert.equal(both, `RNG ${ir!.slice(4)}/${radar!.slice(4)}`, "mixed and no pick: both ranges");
});

test("readouts: gun, HP and damage rows blink when they should", () => {
  const w = (o: Partial<HudView>) => readouts(view(o), "kmh").weapons;
  assert.deepEqual(w({ heat: 0.3 }).find((r) => r.text === "GUN")?.bar, 0.3);
  assert.equal(w({ overheated: true }).find((r) => r.text === "GUN HOT")?.blink, true);
  const hp = (hpv: number) => w({ hp: hpv }).find((r) => r.text.startsWith("HP"))!;
  assert.equal(hp(100).blink, false);
  assert.equal(hp(30).blink, true);
  assert.equal(hp(30).bar, 0.3);
  assert.equal(w({}).some((r) => r.text.startsWith("ENG") || r.text.includes("CTL")), false);
  const light = w({ damage: { engine: 1, controls: 0, avionics: 1 } }).at(-1)!;
  assert.deepEqual([light.text, light.blink], ["ENG AVN", false]);
  const bad = w({ damage: { engine: 2, controls: 1, avionics: 0 } }).at(-1)!;
  assert.deepEqual([bad.text, bad.blink], ["ENG! CTL", true]);
  assert.ok(w({ baseMode: true, bombs: 3 }).some((r) => r.text === "BOMB 3"));
  assert.ok(w({ rearm: 0.5 }).some((r) => r.text === "REARM 50%"));
});

test("readouts: the heading holds steady through a vertical climb (no spin)", () => {
  // nose straight up, canopy toward the south (the pilot pulled through north): heading = where the plane was heading
  const up = (eps: number) => readouts(view({ fwd: v3(eps, 1, -eps), up: v3(0, 0, 1) }), "kmh").heading;
  assert.equal(up(1e-12), up(-1e-12));
  assert.equal(up(1e-12), "000");
});

test("layout: the clip box stays inside the screen and between the boxes, on a phone and a desktop", () => {
  for (const [w, h, touch] of [[844, 390, true], [1440, 900, false], [390, 844, true], [1024, 600, false]] as const) {
    const L = layout(w, h, touch);
    assert.equal(L.cx, w / 2);
    assert.ok(L.clip.x >= 0 && L.clip.y >= 0 && L.clip.x + L.clip.w <= w && L.clip.y + L.clip.h <= h, `${w}x${h} clip inside`);
    assert.ok(L.clip.w > 0 && L.clip.h > 0, `${w}x${h} clip not empty`);
    assert.ok(L.clip.x + L.clip.w < L.cx + L.boxDx, "clip ends before the right box");
    assert.ok(L.clip.y > L.tapeY, "clip starts under the tape");
    assert.ok(L.fs >= 10 && L.fs <= 13);
    assert.ok(L.wpnX > L.cx, "weapons block on the right");
  }
  assert.equal(layout(1440, 900, false).wpnTop, null, "desktop: weapons sit at the bottom");
  assert.ok((layout(844, 390, true).wpnTop ?? 0) > 0, "touch: weapons hang from the top, under the kill feed");
  assert.ok(layout(844, 390, true).tapeY < layout(1440, 900, false).tapeY, "compact: the tape rides higher");
});

test("pipper: the lead mark uses my aircraft's muzzle, the same as the Classic lead circle", () => {
  const me = { pos: v3(0, 0, 0), vel: v3(0, 0, -200) };
  const lead = { pos: v3(0, 0, -1200), vel: v3(80, 0, 0) };
  const f16 = pipperMark(me, { lead, muzzle: 8 });
  const long = pipperMark(me, { lead, muzzle: 25 });
  assert.ok(f16 && long);
  assert.deepEqual(long, leadMark(me, lead, 25));
  assert.notDeepEqual(long, f16, "a different muzzle gives a different lead");
  assert.equal(pipperMark(me, { lead: null, muzzle: 8 }), null);
});

test("planeHole: sized from the airframe's own span, never below the approved 9 m half-span", () => {
  const proj = (p: { x: number; y: number; z: number }) => ({ x: 400 + p.x * 10, y: 300 - p.y * 10 });
  const hole = (span: number) => planeHole(view({ pos: v3(0, 0, 0), fwd: v3(0, 0, -1), up: v3(0, 1, 0), span, project: proj }), { x: 0, y: -1 }, 12)!;
  const small = hole(10), mid = hole(18), big = hole(24);
  assert.ok(Math.abs(small.rx - (9 * 10 * 1.25 + 12)) < 1e-9, "a small jet keeps the 9 m hole the look was approved with");
  assert.equal(small.rx, mid.rx);
  assert.ok(Math.abs(big.rx - (12 * 10 * 1.25 + 12)) < 1e-9, "a big jet: its half-span on screen × 1.25 + the font size");
  assert.equal(planeHole(view({ project: () => null }), { x: 0, y: -1 }, 12), null);
});

test("Classic does no Military work: the style decides which symbology draws", () => {
  const calls: string[] = [];
  const mil = { draw: () => void calls.push("mil") };
  const classic = { update: () => void calls.push("classic") };
  const rv = {} as ReticleView;
  drawSymbology(false, mil, classic, view(), rv, false);
  assert.deepEqual(calls, ["classic"]);
  calls.length = 0;
  drawSymbology(true, mil, classic, view(), rv, true);
  assert.deepEqual(calls, ["mil"]);
});

test("the FPM in level flight sits on the horizon rung's centre (the invariant the projection relies on)", () => {
  const vel = v3(30, 0, -200);
  const fd = fpmDir(vel)!;
  const az = ladderHeading(vel, v3(0, 0, -1), v3(0, 1, 0));
  const c = dirOf(az, 0);
  assert.ok(Math.abs(fd.x - c.x) + Math.abs(fd.y - c.y) + Math.abs(fd.z - c.z) < 1e-12);
  assert.ok(Math.abs(headingDeg(fd) - az) < 1e-9);
});
