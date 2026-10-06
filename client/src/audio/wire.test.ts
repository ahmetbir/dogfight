import { test } from "node:test";
import assert from "node:assert/strict";
import type { CamView } from "../game/events.ts";
import { GameState } from "../game/state.ts";
import type { Ear, FlySource } from "./flyby.ts";
import { audioHooks } from "./wire.ts";

function fakeAudio() {
  const log: { ear?: Ear; sources?: readonly FlySource[]; explosion?: number } = {};
  const nop = () => {};
  return {
    log,
    a: {
      engine: nop, engineOff: nop, lockTone: nop, missileWarning: nop, hurt: nop, hit: nop, pickup: nop,
      cannon: nop, missileLaunch: nop, flare: nop, evaded: nop,
      flyby: (ear: Ear, s: readonly FlySource[]) => { log.ear = ear; log.sources = s; },
      explosion: (d: number) => { log.explosion = d; },
    },
  };
}

const view = (over: Partial<CamView> = {}): CamView => ({
  pos: { x: 0, y: 100, z: 28 }, vel: { x: 0, y: 0, z: -200 }, fwd: { x: 0, y: 0, z: 1 }, label: "",
  planes: [{ id: 2, pos: { x: 50, y: 100, z: 0 }, vel: { x: 0, y: 0, z: 0 }, th: 1, ab: false }],
  replay: false, canReplay: false, ...over,
});

test("the listener rides the camera: look-back faces it backward", () => {
  const { a, log } = fakeAudio();
  const h = audioHooks(a, new GameState(), () => false);
  h.camera!(view());
  assert.deepEqual(log.ear, { pos: { x: 0, y: 100, z: 28 }, vel: { x: 0, y: 0, z: -200 }, fwd: { x: 0, y: 0, z: 1 } });
  assert.equal(log.sources!.length, 1);
  h.sound!("explosion", { x: 0, y: 100, z: 128 });
  assert.equal(log.explosion, 100); // heard from the camera, not the plane
});

test("menus silence the flybys", () => {
  const { a, log } = fakeAudio();
  audioHooks(a, new GameState(), () => true).camera!(view());
  assert.equal(log.sources!.length, 0);
});
