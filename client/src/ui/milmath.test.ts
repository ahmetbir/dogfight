import { test } from "node:test";
import assert from "node:assert/strict";
import { dot, len, norm, v3, type V3 } from "../sim/vec.ts";
import {
  coneRing, dirOf, fpmDir, gText, headingDeg, headingText, kmText, ladderHeading, ladderPitches, rungFade, machText, pitchDeg,
  rangeArc, rung, RUNG, steadyHeading, inkFor, hexA, contrast, brightness, MIL_PALETTE, rungLabel, soundSpeed, speedIn, tapeMarks, vsText,
} from "./milmath.ts";

const near = (a: number, b: number, eps = 1e-9, msg?: string) => assert.ok(Math.abs(a - b) <= eps, msg ?? `${a} ≉ ${b}`);
const angle = (a: V3, b: V3) => (Math.acos(Math.max(-1, Math.min(1, dot(norm(a), norm(b))))) * 180) / Math.PI;

test("heading: north 0, east 90, south 180, west 270 (north is −Z)", () => {
  near(headingDeg(v3(0, 0, -1)), 0);
  near(headingDeg(v3(1, 0, 0)), 90);
  near(headingDeg(v3(0, 0, 1)), 180);
  near(headingDeg(v3(-1, 0, 0)), 270);
  near(headingDeg(v3(1, 5, -1)), 45, 1e-9, "climbing does not change the heading");
  assert.equal(headingText(7.4), "007");
  assert.equal(headingText(359.6), "000");
});

test("pitch and dirOf are inverse", () => {
  for (const [h, p] of [[0, 0], [90, 30], [225, -45], [10, 80]]) {
    const d = dirOf(h, p);
    near(len(d), 1, 1e-12);
    near(pitchDeg(d), p, 1e-9);
    near(headingDeg(d), h, 1e-9);
  }
  near(pitchDeg(v3(0, 0, 0)), 0);
});

test("heading tape: marks every 5°, majors on tens with two-digit labels, wrapping through north", () => {
  const m = tapeMarks(352, 20);
  assert.deepEqual(m.map((k) => k.deg), [335, 340, 345, 350, 355, 0, 5, 10]);
  assert.deepEqual(m.map((k) => k.off), [-17, -12, -7, -2, 3, 8, 13, 18]);
  assert.deepEqual(m.filter((k) => k.major).map((k) => k.label), ["34", "35", "00", "01"]);
  const at = tapeMarks(90, 10);
  assert.deepEqual(at.map((k) => [k.deg, k.off, k.label]), [[80, -10, "08"], [85, -5, ""], [90, 0, "09"], [95, 5, ""], [100, 10, "10"]]);
  assert.ok(tapeMarks(3, 30).every((k) => k.deg >= 0 && k.deg < 360));
});

test("flight path marker: along the velocity, none when stopped", () => {
  assert.equal(fpmDir(v3(0, 0, 0)), null);
  assert.equal(fpmDir(v3(1, 0, 2)), null, "under 5 m/s");
  const d = fpmDir(v3(0, -20, -200))!;
  near(len(d), 1, 1e-12);
  near(pitchDeg(d), (Math.atan2(-20, 200) * 180) / Math.PI, 1e-9, "a descent puts the FPM below the horizon");
});

test("ladder azimuth: the flight path's, the nose's when slow, the pulled-through heading when vertical", () => {
  near(ladderHeading(v3(200, 0, 0), v3(0, 0, -1), v3(0, 1, 0)), 90, 1e-9, "the velocity wins");
  near(ladderHeading(v3(0, 0, 0), v3(0, 0, 1), v3(0, 1, 0)), 180, 1e-9, "parked: the nose");
  // Pulled straight up from heading north: the canopy faces south, the ladder still hangs on north.
  near(ladderHeading(v3(0, 150, 0), v3(0, 1, 0), v3(0, 0, 1)), 0, 1e-9);
  // Pushed straight down from heading east: the canopy faces east.
  near(ladderHeading(v3(0, -150, 0), v3(0, -1, 0), v3(1, 0, 0)), 90, 1e-9);
});

test("ladder rungs: 5° near the horizon, 10° beyond, within the window, none near the poles", () => {
  assert.deepEqual(ladderPitches(0, 12), [-10, -5, 0, 5, 10]);
  assert.deepEqual(ladderPitches(30, 12), [20, 30, 40]);
  assert.deepEqual(ladderPitches(14, 6), [10, 20]);
  assert.deepEqual(ladderPitches(83, 10), [80]);
  assert.deepEqual(ladderPitches(-3, 4), [-5, 0]);
  assert.equal(rungFade(10, 10, 12), 1);
  assert.equal(rungFade(4, 10, 12), 0.5);
  assert.equal(rungFade(-5, 10, 12), 0);
  assert.ok(!Object.is(ladderPitches(0, 2)[0], -0));
  assert.equal(rungLabel(-5), "-5");
  assert.equal(rungLabel(10), "10");
});

test("rung geometry: bars level at their pitch, the gap and width in degrees, ticks toward the horizon", () => {
  for (const [h, p] of [[0, 10], [135, -20], [300, 60]]) {
    const r = rung(h, p);
    const c = dirOf(h, p);
    // the bar ends sit at the rung's angular offsets from its centre
    near(angle(r.left[0], c), RUNG.gap, 1e-9);
    near(angle(r.left[1], c), RUNG.half, 1e-9);
    near(angle(r.right[1], c), RUNG.half, 1e-9);
    // left is left: west of the centre when facing north
    const right = dirOf(h + 90, 0);
    assert.ok(dot(r.right[1], right) > 0 && dot(r.left[1], right) < 0);
    // symmetric about the azimuth, the same elevation on both sides
    near(pitchDeg(r.left[1]), pitchDeg(r.right[1]), 1e-9);
    // ticks point toward the horizon
    assert.ok(Math.abs(pitchDeg(r.tickL)) < Math.abs(pitchDeg(r.left[1])));
    assert.ok(Math.abs(pitchDeg(r.tickR)) < Math.abs(pitchDeg(r.right[1])));
  }
  const hz = rung(0, 0);
  near(angle(hz.right[1], dirOf(0, 0)), RUNG.horizonHalf, 1e-9, "the horizon line is wider");
  near(pitchDeg(hz.right[1]), 0, 1e-12, "and lies on the horizon");
});

test("missile cone ring: every point at the cone's half angle", () => {
  const axis = v3(0.3, 0.2, -1);
  const ring = coneRing(axis, (10 * Math.PI) / 180, 16);
  assert.equal(ring.length, 16);
  for (const d of ring) near(angle(d, axis), 10, 1e-9);
  for (const d of coneRing(v3(0, 1, 0), 0.2, 8)) near(angle(d, v3(0, 1, 0)), (0.2 * 180) / Math.PI, 1e-9, "straight up too");
});

test("readouts: Mach, speed units, vertical speed, G, range", () => {
  near(soundSpeed(0), 340.29, 0.01);
  near(soundSpeed(20000), soundSpeed(11000), 1e-9, "isothermal above 11 km");
  assert.equal(machText(340.29, 0), "1.00");
  assert.equal(machText(250, 3000), (250 / soundSpeed(3000)).toFixed(2));
  assert.equal(speedIn(100, "kmh"), 360);
  assert.equal(speedIn(100, "kt"), 194);
  assert.equal(vsText(12.4), "+12");
  assert.equal(vsText(-3.6), "-4");
  assert.equal(vsText(0.2), "0");
  assert.equal(gText(4.25), "4.3");
  assert.equal(rangeArc(500, 2000), 0.25);
  assert.equal(rangeArc(5000, 2000), 1);
  assert.equal(rangeArc(100, 0), 0);
  assert.equal(kmText(1234), "1.2");
  assert.equal(kmText(12600), "13");
});

test("ink: the core never changes; the shadow and backing adapt to the backdrop", () => {
  const dark = inkFor("green", 0.15), bright = inkFor("green", 0.85), unknown = inkFor("green", null);
  for (const k of [dark, bright, unknown, inkFor("green", 0.5)]) assert.equal(k.core, MIL_PALETTE.green);
  assert.equal(inkFor("amber", 0.9).core, MIL_PALETTE.amber);
  assert.deepEqual(unknown, dark, "no sample yet: the night look");
  assert.match(dark.shadow, /^rgba\(109,255,154,/, "a glow of the core colour over dark");
  assert.equal(dark.backing, 0);
  assert.match(bright.shadow, /^rgba\(0,0,0,0\.4/, "a soft dark shadow over bright, under half opacity");
  assert.ok(bright.backing > 0 && bright.backing <= 0.2, "a faint backing, never a solid panel");
  assert.ok(bright.blur >= 3 && bright.blur <= 6);
  assert.equal(hexA("#ff8000", 0.5), "rgba(255,128,0,0.50)");
  assert.equal(brightness(0.3), 0);
  assert.equal(brightness(0.7), 1);
  // the luminous core stays clearly brighter than sea and night (the HUD look); over sky the shadow carries it
  for (const bg of ["#0b4f86", "#0a1026"]) assert.ok(contrast(MIL_PALETTE.green, bg) >= 4.5 && contrast(MIL_PALETTE.amber, bg) >= 4.5);
});

test("steadyHeading: near vertical it follows the body's up axis instead of spinning", () => {
  const up = v3(0, 0, 1); // climbing straight up, canopy to the south: pulled through north
  near(steadyHeading(v3(1e-12, 1, -1e-12), up), 0);
  near(steadyHeading(v3(-1e-12, 1, 1e-12), up), 0);
  near(steadyHeading(v3(0, -1, 0), v3(1, 0, 0)), 90, 1e-9, "diving: the heading ahead of the canopy");
  near(steadyHeading(v3(1, 0, -1), v3(0, 1, 0)), 45, 1e-9, "not vertical: the plain heading");
});

test("the allocation-free forms give the same marks as the plain ones", () => {
  const marks: ReturnType<typeof tapeMarks> = [];
  for (const h of [0, 3.3, 352.4, 359.9, 180]) {
    assert.deepEqual(tapeMarks(h, 25, 5, marks), tapeMarks(h, 25));
  }
  assert.equal(marks.length, tapeMarks(180, 25).length, "length follows the latest call");
  const buf = rung(0, 0);
  for (const [h, p] of [[0, 0], [37, 15], [200, -30], [90, 80], [359, -10]]) {
    assert.deepEqual(rung(h, p, buf), rung(h, p));
    assert.equal(rung(h, p, buf), buf);
  }
  const ring: V3[] = [];
  assert.deepEqual(coneRing(v3(0, 0, -1), 0.17, 32, ring), coneRing(v3(0, 0, -1), 0.17));
  assert.equal(coneRing(v3(0, 1, 0), 0.17, 8, ring).length, 8);
});
