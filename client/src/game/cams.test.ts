import { test } from "node:test";
import assert from "node:assert/strict";
import * as THREE from "three";
import type { Settings } from "../input/schemes.ts";
import type { PlaneJSON } from "../net/protocol.ts";
import type { Renderer } from "../render/renderer.ts";
import { InterpBuffer } from "../predict/interp.ts";
import { qIdentity, v3 } from "../sim/vec.ts";
import { Cams } from "./cams.ts";
import type { RemotePose } from "./remote.ts";
import { GameState } from "./state.ts";

// Spectating plane 2: its buffer says x = 0, the frame's shared pose says
// x = 500 (carried on past a late snapshot). Camera and sound follow the pose.
test("the follow camera and the engine sound use the frame's shared pose", () => {
  const s = new GameState();
  s.you = 1;
  s.planes.set(2, { id: 2, a: true, k: "f16", tm: "", hp: 90, p: [0, 1000, 0], q: [1, 0, 0, 0], v: [200, 0, 0], th: 1 } as unknown as PlaneJSON);
  const buf = new InterpBuffer();
  buf.push(0, { pos: v3(0, 1000, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 });
  s.interp.set(2, buf);
  const camera = new THREE.PerspectiveCamera();
  const cams = new Cams({
    renderer: { camera } as unknown as Renderer, state: s, settings: { missileCam: false } as Settings, solids: [],
    ground: () => 0, spectate: () => 2,
  });
  const others = new Map<number, RemotePose>([[2, { fs: { pos: v3(500, 1000, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 }, g: 1 }]]);
  const view = cams.place(1 / 60, 0, others, { fs: null, live: false, lookBack: false, aimDir: null }, null);
  assert.ok(Math.abs(camera.position.x - 500) < 100, `camera at x ${camera.position.x.toFixed(1)}, near the pose (500), not the buffer (0)`);
  assert.equal(view.planes.length, 1);
  assert.equal(view.planes[0].pos.x, 500);
});
