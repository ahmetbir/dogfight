import { test } from "node:test";
import assert from "node:assert/strict";
import type { AircraftInfo, MissileJSON, PlayerJSON, StructInfo } from "../net/protocol.ts";
import { enemyTargets, objFrac } from "./objective.ts";
import { v3 } from "../sim/vec.ts";
import { ChatThrottle, chatId, chatText } from "./chat.ts";
import { effectiveRange, incomingDistance, outOfRange, rangeFill } from "./lockinfo.ts";
import { mergeHooks } from "../game/events.ts";
import { clock } from "./dom.ts";
import { createEntry, DEFAULT_CREATE, mapName, parseSeed, sizeRange, weatherName } from "./create.ts";
import { normalizeCode } from "../net/code.ts";
import { Refresher, roomLabel } from "./rooms.ts";
import { gearLight, ParkBrake, rearmText } from "./flightlights.ts";
import { loadToken, storeToken } from "../net/pilot.ts";
import { favoriteName, formatFlight } from "./leaderboard.ts";
import { kindsFor, PICK_TIMEOUT_S, pickKey, pickNote, statFill, waitLeft, waitWhen } from "./pick.ts";
import { radarPoint } from "./radar.ts";
import { boxSize, formatDist, inCone, leadDir } from "./reticle.ts";
import { boardRows, scoreLine } from "./scoreboard.ts";
import { keyRows } from "../input/bindings.ts";

/** The settings menu's key lists (Turkish, the default language). */
const KEYS = { mouse: keyRows("mouse"), keyboard: keyRows("keyboard"), touch: keyRows("touch") };

const player = (id: number, name: string, team: PlayerJSON["team"], bot = false): PlayerJSON => ({ id, name, team, kind: "f16", bot });

test("board lists every roster player, zero rows included, best first", () => {
  const players = [player(1, "Ben", "nato"), player(2, "Viper", "soviet", true), player(3, "Ghost", "nato", true)];
  const rows = boardRows(players, [{ id: 2, k: 3, d: 1, s: 3 }], 1);
  assert.deepEqual(rows.map((r) => [r.id, r.k, r.d, r.s, r.me]), [[2, 3, 1, 3, false], [1, 0, 0, 0, true], [3, 0, 0, 0, false]]);
  assert.equal(rows[0].bot, true);
});

test("score line: team and FFA formats", () => {
  const team = { mode: "team", rows: [], nato: 12, soviet: 9 };
  assert.equal(scoreLine(team, 402), "NATO 12 – 9 SOVYET  6:42");
  assert.equal(scoreLine({ ...team, mode: "base" }, 402), "NATO 12 – 9 SOVYET  6:42", "base attack scores by side");
  const rows = boardRows([player(1, "Ben", "none"), player(2, "Viper", "none")], [{ id: 2, k: 8, d: 0, s: 8 }, { id: 1, k: 5, d: 2, s: 5 }], 1);
  assert.equal(scoreLine({ mode: "ffa", rows, nato: 0, soviet: 0 }, 402), "1. Viper 8  •  Sen 5  6:42");
  const lead = boardRows([player(1, "Ben", "none")], [{ id: 1, k: 2, d: 0, s: 2 }], 1);
  assert.equal(scoreLine({ mode: "ffa", rows: lead, nato: 0, soviet: 0 }, 59.2), "1. Sen 2  1:00");
});

test("clock and distance formats", () => {
  assert.equal(clock(0), "0:00");
  assert.equal(clock(61), "1:01");
  assert.equal(formatDist(843), "840 m");
  assert.equal(formatDist(1260), "1,3 km", "Turkish decimal comma");
});

test("home: room code, seed and size rules", () => {
  assert.equal(normalizeCode(" k7qx "), "K7QX");
  assert.equal(normalizeCode("K7Q"), "");
  assert.equal(normalizeCode("KOQX"), ""); // O is not in the alphabet
  assert.equal(parseSeed(""), undefined);
  assert.equal(parseSeed("42"), 42);
  assert.equal(parseSeed("-7"), -7);
  assert.equal(parseSeed("4.2"), null);
  assert.deepEqual(sizeRange("team"), { min: 1, max: 6, def: 2 });
  assert.deepEqual(sizeRange("ffa"), { min: 2, max: 12, def: 6 });
});

test("pick: team kinds and stat bars", () => {
  const a = (kind: AircraftInfo["kind"], team: AircraftInfo["team"], maxHP: number) =>
    ({ kind, team, maxHP, name: kind, maxSpeed: 1, maxSpeedAB: 1, accel: 1, rollRate: 1, pitchRate: 1, yawRate: 1, cornerSpeed: 1, lockRange: 1, missiles: 2, flares: 6, rotateSpeed: 1 });
  const all = [a("f16", "nato", 90), a("f15", "nato", 120), a("mig29", "soviet", 100), a("su27", "soviet", 110)];
  assert.deepEqual(kindsFor("soviet", all).map((x) => x.kind), ["mig29", "su27"]);
  assert.equal(kindsFor("none", all).length, 4);
  assert.equal(statFill(all[1], all, (x) => x.maxHP), 1);
  assert.equal(statFill(all[0], all, (x) => x.maxHP), 0.75);
});

test("radar: north up, east right, clamped to the rim", () => {
  const me = { x: 100, y: 0, z: 100 };
  assert.deepEqual(radarPoint(me, { x: 100, y: 0, z: -1900 }, 4000, 80), { x: 0, y: -40, edge: false });
  const far = radarPoint(me, { x: 10100, y: 0, z: 100 }, 4000, 80);
  assert.ok(far.edge && Math.abs(far.x - 80) < 1e-9 && far.y === 0);
});

test("reticle: lead, lock box, cone", () => {
  const me = { pos: { x: 0, y: 0, z: 0 }, vel: { x: 0, y: 0, z: -200 } };
  const still = leadDir(me, { pos: { x: 0, y: 0, z: -900 }, vel: { x: 0, y: 0, z: -200 } })!;
  assert.ok(Math.abs(still.x) < 1e-12 && Math.abs(still.z + 1) < 1e-12); // same velocity: aim straight at it
  const crossing = leadDir(me, { pos: { x: 0, y: 0, z: -900 }, vel: { x: 100, y: 0, z: -200 } })!;
  assert.ok(crossing.x > 0.09 && crossing.x < 0.12, `${crossing.x}`); // ~1 s of flight at 900 m/s
  assert.equal(boxSize(0), 140);
  assert.equal(boxSize(1), 46);
  assert.ok(inCone(me.pos, { x: 0, y: 0, z: -1 }, { x: 100, y: 0, z: -1000 }, Math.PI / 6));
  assert.ok(!inCone(me.pos, { x: 0, y: 0, z: -1 }, { x: 0, y: 0, z: 1000 }, Math.PI / 6));
});

test("settings key list names the scheme bindings", () => {
  const keys = (s: "mouse" | "keyboard") => KEYS[s].map(([k]) => k).join(" ");
  for (const k of ["W / S", "Shift", "A / D", "Sol tık", "Sağ tık / E", "Space", "C", "Tab", "P", "Esc"]) assert.ok(keys("mouse").includes(k), k);
  for (const k of ["W / S", "A / D", "Q / E", "R / F", "X", "Space", "V", "G", "C", "Tab"]) assert.ok(keys("keyboard").includes(k), k);
  for (const s of ["mouse", "keyboard"] as const) {
    for (const k of ["L", "B", "H"]) assert.ok(KEYS[s].some(([key]) => key.split(" / ").includes(k)), `${s} ${k}`);
  }
});

test("mergeHooks calls every set in order", () => {
  const calls: string[] = [];
  const h = mergeHooks({ hurt: () => calls.push("a") }, { hurt: () => calls.push("b"), hitConfirm: () => calls.push("c") });
  h.hurt?.(5);
  h.hitConfirm?.();
  assert.deepEqual(calls, ["a", "b", "c"]);
});

test("pick screen rebuilds only when room, team or aircraft change", () => {
  const ac = (kind: AircraftInfo["kind"]) => ({ kind, team: "nato", name: kind } as AircraftInfo);
  const v = { code: "K7QX", team: "nato" as const, aircraft: [ac("f16"), ac("f15")], current: "f16" as const, chosen: null, protectedNow: true, waiting: false, waitLeft: 0 };
  const k = pickKey(v);
  assert.equal(pickKey({ ...v, chosen: "f15", current: "f15", protectedNow: false }), k, "selection and protection update in place");
  assert.notEqual(pickKey({ ...v, team: "soviet" }), k);
  assert.notEqual(pickKey({ ...v, aircraft: [ac("f16")] }), k);
  assert.notEqual(pickNote(v), pickNote({ ...v, protectedNow: false }));
  assert.match(pickNote({ ...v, waiting: true, waitLeft: 9 }), /9 sn içinde/);
  assert.match(pickNote({ ...v, waiting: true, waitLeft: 0 }), /birazdan/);
});

test("pick timeout counts down from the welcome", () => {
  assert.equal(waitLeft(1000, 1000), PICK_TIMEOUT_S);
  assert.equal(waitLeft(1000, 1000 + 4200), 11);
  assert.equal(waitLeft(1000, 1000 + 14_999), 1);
  assert.equal(waitLeft(1000, 1000 + 15_000), 0);
  assert.equal(waitLeft(1000, 1000 + 99_000), 0);
  assert.equal(waitWhen(3), "3 sn içinde");
});

test("create entry: every setting on the wire, seed optional", () => {
  assert.deepEqual(createEntry(DEFAULT_CREATE), { t: "create", mode: "team", size: 2, diff: "normal", map: "ada", wx: "acik", start: "hava", vis: "acik" });
  const e = createEntry({ ...DEFAULT_CREATE, mode: "base", size: 3, map: "dag", wx: "gece", start: "hava", vis: "ozel", seed: "42" });
  assert.deepEqual(e, { t: "create", mode: "base", size: 3, diff: "normal", map: "dag", wx: "gece", start: "hava", vis: "ozel", seed: 42 });
  assert.deepEqual(createEntry({ ...DEFAULT_CREATE, seed: "abc" }), { error: "Seed bir tam sayı olmalı." });
  assert.deepEqual(sizeRange("base"), sizeRange("team"));
  assert.equal(mapName("col"), "Çöl");
  assert.equal(weatherName("firtina"), "Fırtına");
});

test("room list label", () => {
  assert.equal(roomLabel({ code: "K7QX", mode: "base", map: "col", wx: "firtina", humans: 2, seats: 6, phase: "playing", left: 312 }), "2/6 · Üs Saldırısı · Çöl · Fırtına");
});

test("pilot token storage and card formats", () => {
  const mem = new Map<string, string>();
  const store = { getItem: (k: string) => mem.get(k) ?? null, setItem: (k: string, v: string) => void mem.set(k, v) };
  assert.equal(loadToken(store), "");
  storeToken("bad token", store);
  assert.equal(loadToken(store), "");
  storeToken("AAAAAAAAAAAAAAAAAAAAAA", store);
  assert.equal(loadToken(store), "AAAAAAAAAAAAAAAAAAAAAA");
  assert.equal(formatFlight(60 * 60 * 12), "12 dk");
  assert.equal(formatFlight(60 * 60 * 192), "3 sa 12 dk");
  assert.equal(favoriteName("mig29"), "MiG-29");
  assert.equal(favoriteName(""), "—");
});

test("flight lights", () => {
  assert.equal(gearLight(true, true), "on");
  assert.equal(gearLight(false, false), "off");
  assert.equal(gearLight(false, true), "blink");
  assert.equal(gearLight(true, false), "blink");
  assert.equal(rearmText(0), "");
  assert.equal(rearmText(0.456), "İKMAL %46");
});

test("lock readouts", () => {
  assert.equal(effectiveRange(1000, 0.6), 600);
  assert.equal(rangeFill(450, 900), 0.5);
  assert.equal(rangeFill(2000, 900), 1);
  const me = v3(0, 1000, 0), fwd = v3(0, 0, -1);
  assert.equal(outOfRange(me, fwd, [v3(0, 1000, -1500)], 900), true);
  assert.equal(outOfRange(me, fwd, [v3(0, 1000, -800)], 900), false);
  assert.equal(outOfRange(me, fwd, [v3(800, 1000, -1500)], 900), false, "outside the 10° cone");
  assert.equal(outOfRange(me, fwd, [v3(0, 1000, -5000)], 900), false, "too far to matter");
  const ms = [{ id: 1, tg: 7, p: [0, 1000, 1200], v: [0, 0, -400] }, { id: 2, tg: 9, p: [0, 1000, 100], v: [0, 0, 0] }] as MissileJSON[];
  assert.equal(incomingDistance(me, ms, 7), 1200);
  assert.equal(incomingDistance(me, ms, 8), null);
});

test("quick chat keys, texts and throttle", () => {
  assert.equal(chatText(0), undefined);
  assert.equal(chatText(7), undefined);
  assert.equal(chatText(1), "Arkandayım!");
  assert.equal(chatText(6), "Teşekkürler");
  assert.equal(chatId("Digit3"), 3);
  assert.equal(chatId("Numpad6"), 6);
  assert.equal(chatId("Digit7"), 0);
  assert.equal(chatId("KeyA"), 0);
  const th = new ChatThrottle();
  assert.equal(th.ok(0), true);
  assert.equal(th.ok(1500), false);
  assert.equal(th.ok(2000), false, "server-cooldown edge keeps a jitter margin");
  assert.equal(th.ok(2100), true);
});

test("key lists cover gear, brakes, bombs and chat in every scheme", () => {
  for (const s of ["mouse", "keyboard"] as const) {
    const keys = KEYS[s].map(([k]) => k);
    for (const k of ["L", "B", "1–6"]) assert.ok(keys.includes(k), `${s} ${k}`);
    assert.ok(keys.some((k) => k.startsWith("H")), `${s} H`);
  }
  assert.ok(KEYS.touch.length > 0);
  assert.ok(!KEYS.mouse.some(([, what]) => /Düşünce|düşünce/.test(what)), "R reads 'Ölünce'");
});

test("objective bar and radar targets", () => {
  assert.equal(objFrac(975), 0.5);
  assert.equal(objFrac(-5), 0);
  const structs = [
    { id: 1, k: "fuel", tm: "soviet", box: [0, 0, 0, 10, 10, 10] },
    { id: 2, k: "aa", tm: "soviet", box: [100, 0, 100, 110, 5, 110] },
    { id: 3, k: "radar", tm: "nato", box: [0, 0, 0, 1, 1, 1] },
  ] as StructInfo[];
  const t = enemyTargets(structs, new Map([[1, 250], [2, 0], [3, 300]]), "nato");
  assert.deepEqual(t, [{ x: 5, y: 5, z: 5 }]);
});

test("FREN shows the runway-spawn parking brake until the first throttle", () => {
  const p = new ParkBrake();
  assert.equal(p.update(false, false, 0, false), false, "dead");
  assert.equal(p.update(true, true, 0.8, false), true, "spawned parked; the last life's throttle is ignored at first");
  for (let i = 1; i < ParkBrake.GRACE; i++) p.update(true, true, 0.8, false);
  assert.equal(p.update(true, true, 0, false), true, "held");
  assert.equal(p.update(true, true, 0.1, false), false, "throttle releases it");
  assert.equal(p.update(true, true, 0, false), false, "for the rest of the life");
  assert.equal(p.update(false, false, 0, false), false);
  assert.equal(p.update(true, true, 0, false), true, "next life parked again");
  for (let i = 1; i < ParkBrake.GRACE; i++) p.update(true, true, 0, false);
  assert.equal(p.update(true, true, 0, true), false, "afterburner releases it");
  const air = new ParkBrake();
  assert.equal(air.update(true, false, 0, false), false, "air start");
  assert.equal(air.update(true, true, 0, false), false, "a landing is not a parked spawn");
});

test("room list refresher: one fetch at a time, survives a rejected fetch, drops answers after stop", async () => {
  const got: (number | null)[] = [];
  let calls = 0;
  let release: (v: number) => void = () => {};
  let mode: "reject" | "hold" | "ok" = "reject";
  const r = new Refresher<number>(() => {
    calls++;
    if (mode === "reject") return Promise.reject(new Error("boom"));
    if (mode === "hold") return new Promise<number>((res) => { release = res; });
    return Promise.resolve(7);
  }, (v) => got.push(v));
  await r.run();
  assert.deepEqual(got, [null], "a rejected fetch reads as a failed one");
  mode = "ok";
  await r.run();
  assert.deepEqual(got, [null, 7], "busy was reset after the rejection");
  mode = "hold";
  const slow = r.run();
  await r.run(); // overlapping: skipped
  assert.equal(calls, 3);
  r.stop();
  release(9);
  await slow;
  assert.deepEqual(got, [null, 7], "late answer after stop() dropped");
  mode = "ok";
  await r.run();
  assert.deepEqual(got, [null, 7, 7]);
});


test("key lists name replay and spectate controls per scheme", () => {
  assert.ok(KEYS.touch.some(([k]) => k === "TEKRAR / GEÇ"));
  for (const s of ["mouse", "keyboard"] as const) assert.ok(KEYS[s].some(([k]) => k === "← / →"), s);
});
