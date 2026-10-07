import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaneJSON } from "../net/protocol.ts";
import { ReplayView } from "./replayview.ts";
import { GameState } from "./state.ts";

const plane = (ms: number, rm: number, a = true): PlaneJSON => ({
  id: 1, k: "f16", tm: "none", p: [0, 100, 0], q: [1, 0, 0, 0], v: [0, 0, -200], th: 1, hp: 100,
  a, ht: 0, oh: false, ms, rm, fl: 0, w: [0, 0, -4.2],
}) as PlaneJSON;

test("the replay draws the missiles left and the surfaces as recorded", () => {
  const s = new GameState();
  s.you = 1;
  s.aircraft.set("f16", { kind: "f16", maxHP: 100, pitchRate: 1.6, rollRate: 4.2, yawRate: 0.5 } as never);
  const rv = new ReplayView(s);
  for (const [tick, ms, rm] of [[0, 3, 2], [60, 1, 2], [120, 0, 1]]) {
    s.tick = tick;
    s.planes = new Map([[1, plane(ms, rm)]]);
    rv.record();
  }
  s.tick = 180;
  s.planes = new Map([[1, plane(5, 0, false)]]); // I am down (ready() needs it); the replay uses what was recorded
  rv.died(120);
  assert.ok(rv.start(0));
  const early = rv.scene(0)!.planes.get(1)!;
  assert.equal(early.msl, 5);
  assert.equal(early.ctl?.r, 1);
  const late = rv.scene(1500)!.planes.get(1)!;
  assert.ok(late.msl! < 5, `rails ${late.msl}`);
});

test("the replay draws each plane in the paint it wore then", () => {
  const s = new GameState();
  s.you = 1;
  s.aircraft.set("f16", { kind: "f16", maxHP: 100, pitchRate: 1.6, rollRate: 4.2, yawRate: 0.5 } as never);
  const rv = new ReplayView(s);
  s.players = new Map([[1, { id: 1, name: "a", team: "none", kind: "f16", bot: false, skin: "desert" }]]);
  for (const tick of [0, 60, 120]) {
    s.tick = tick;
    s.planes = new Map([[1, plane(2, 0)]]);
    rv.record();
  }
  s.players = new Map([[1, { id: 1, name: "a", team: "none", kind: "f16", bot: false, skin: "winter" }]]); // repainted since
  s.tick = 180;
  s.planes = new Map([[1, plane(2, 0, false)]]);
  rv.died(120);
  assert.ok(rv.start(0));
  assert.equal(rv.scene(0)!.planes.get(1)!.skin, "desert");
});
