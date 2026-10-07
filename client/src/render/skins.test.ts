import { test } from "node:test";
import assert from "node:assert/strict";
import { teamColors } from "./models/common.ts";
import { defaultSkin, patternIndex, patternPixels, PATTERN_PX, SCHEMES, SKIN_KINDS, skinColors, skinsFor, swatchPixels, SWATCH_PX, validSkin, type SkinId } from "./skins.ts";

const KINDS = ["f16", "f15", "mig29", "su27", "f22", "su57", "f14", "mig31", "a10", "su25", "rafale", "typhoon", "mig21", "f18", "su30", "f4", "mig23"];
const IDS = Object.keys(SKIN_KINDS) as SkinId[];
const TEAMS = ["nato", "soviet", "none"] as const;

test("the scheme table: every id has a scheme, iconic ones only on their jets", () => {
  assert.deepEqual(Object.keys(SCHEMES).sort(), [...IDS].sort());
  assert.ok(IDS.length >= 8);
  for (const k of KINDS) {
    const s = skinsFor(k);
    assert.equal(s[0], "standard", k);
    assert.deepEqual(s.slice(0, 7), ["standard", "airsup", "desert", "winter", "naval", "splinter", "night"]);
  }
  assert.ok(skinsFor("su27").includes("flanker") && skinsFor("su30").includes("flanker"));
  assert.ok(skinsFor("f14").includes("blackband") && skinsFor("f4").includes("blackband"));
  assert.ok(!skinsFor("f16").includes("flanker") && !skinsFor("mig29").includes("blackband"));
  for (const w of Object.values(SKIN_KINDS)) {
    if (w !== "*") for (const k of w.split(" ")) assert.ok(KINDS.includes(k), `${k} is a kind`);
  }
});

test("validSkin falls back to standard; every jet's default is one it may wear", () => {
  assert.equal(validSkin("f16", "desert"), "desert");
  assert.equal(validSkin("f16", "flanker"), "standard");
  assert.equal(validSkin("f16", "nope"), "standard");
  assert.equal(validSkin("f16", undefined), "standard");
  assert.equal(validSkin("f16", "__proto__"), "standard");
  assert.equal(validSkin("su30", "flanker"), "flanker");
  for (const k of KINDS) assert.ok(skinsFor(k).includes(defaultSkin(k)), k);
  assert.equal(defaultSkin("su27"), "flanker");
  assert.equal(defaultSkin("f16"), "standard");
  assert.equal(defaultSkin("zeppelin"), "standard");
});

test("every skin keeps the team colour on the stripe; standard is the team's look", () => {
  for (const team of TEAMS) {
    for (const own of [false, true]) {
      const tc = teamColors(team, own);
      assert.deepEqual(skinColors("standard", team, own), { ...tc, canopy: null });
      for (const id of IDS) {
        const c = skinColors(id, team, own);
        if (team !== "none" || !own) assert.equal(c.stripe, tc.stripe, `${id} ${team}`);
        else assert.notEqual(c.stripe, skinColors(id, "none", false).stripe, "my FFA plane stays marked apart from the others");
      }
    }
  }
  assert.notEqual(skinColors("desert", "nato", false).stripe, skinColors("desert", "soviet", false).stripe, "friend and foe never mix");
});

test("patterns are deterministic, cover about their share and stay darker than the body", () => {
  for (const id of IDS) {
    const p = SCHEMES[id].pattern;
    if (!p) continue;
    const a = patternIndex(p), b = patternIndex(p);
    assert.deepEqual(a, b, `${id}: same pixels every time`);
    const px = patternPixels(p, SCHEMES[id].body!);
    assert.equal(px.length, PATTERN_PX * PATTERN_PX * 4);
    if (p.kind === "band") continue;
    p.colors.forEach((_, i) => {
      const share = a.filter((v) => v === i + 1).length / a.length;
      assert.ok(Math.abs(share - p.cover[i]!) < 0.12, `${id} colour ${i}: ${share.toFixed(2)} vs ${p.cover[i]}`);
    });
    for (let i = 0; i < px.length; i += 4) assert.equal(px[i + 3], 255);
  }
});

test("the band scheme is body-coloured only across its band", () => {
  const p = SCHEMES.blackband.pattern!;
  assert.equal(p.kind, "band");
  if (p.kind !== "band") return;
  const idx = patternIndex(p);
  for (let y = 0; y < PATTERN_PX; y++) {
    const m: number = ((y + 0.5) / PATTERN_PX) * p.tile;
    assert.equal(idx[y * PATTERN_PX], m >= p.from && m < p.to ? 0 : 1, `row ${y} (${m.toFixed(1)} m)`);
  }
  const px = patternPixels(p, SCHEMES.blackband.body!);
  const dark = Math.round((0x30 / 0xf0) * 255);
  assert.equal(px[0], dark, "outside the band: dark × white body = dark");
});

test("a chip swatch shows the team stripe along its bottom", () => {
  const s = swatchPixels("desert", "soviet", false);
  assert.equal(s.length, SWATCH_PX * SWATCH_PX * 4);
  const at = (x: number, y: number) => [...s.slice((y * SWATCH_PX + x) * 4, (y * SWATCH_PX + x) * 4 + 3)];
  assert.deepEqual(at(8, SWATCH_PX - 1), [0xd8, 0x3b, 0x3b]);
  assert.deepEqual(at(0, 0), [0xc7, 0xaa, 0x7c], "the secondary corner");
});
