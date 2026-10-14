import { test } from "node:test";
import assert from "node:assert/strict";
import type { PlaneJSON } from "../net/protocol.ts";
import { qIdentity, v3 } from "../sim/vec.ts";
import { InterpBuffer } from "../predict/interp.ts";
import { RemotePoses } from "./remote.ts";
import { GameState } from "./state.ts";
import { planeRenders } from "./view.ts";

// A remote plane at 200 m/s along +x with snapshots at 0 and 33 ms.
function stateWithRemote(): GameState {
  const s = new GameState();
  s.you = 1;
  s.planes.set(2, { id: 2, a: true, k: "f16", tm: "", hp: 90, p: [6.6, 1000, 0], q: [1, 0, 0, 0], v: [200, 0, 0], th: 1 } as unknown as PlaneJSON);
  const buf = new InterpBuffer();
  buf.push(0, { pos: v3(0, 1000, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 });
  buf.push(33, { pos: v3(6.6, 1000, 0), rot: qIdentity(), vel: v3(200, 0, 0), th: 1 });
  s.interp.set(2, buf);
  return s;
}

const poses = new RemotePoses(() => 0);
const drawnX = (s: GameState, rt: number, now = rt) =>
  planeRenders(s, poses.frame(s.interp, (id) => id !== s.you, rt, now), { fs: null, gForce: 1, ab: false }).get(2)!.pos.x;

test("a remote plane is drawn interpolated inside its snapshots", () => {
  assert.ok(Math.abs(drawnX(stateWithRemote(), 16.5) - 3.3) < 1e-9);
});

// A late snapshot used to leave the plane standing in the air at its newest
// snapshot until the next one arrived ("bots stop in mid-air"); it keeps
// flying along its velocity instead.
test("a late snapshot does not stop a remote plane in mid-air", () => {
  const s = stateWithRemote();
  let prev = drawnX(s, 33);
  for (let rt = 50; rt <= 233; rt += 1000 / 60) {
    const x = drawnX(s, rt);
    assert.ok((x - prev) / (1000 / 60 / 1000) > 190, `rt ${rt.toFixed(0)}: drawn speed ${((x - prev) * 60).toFixed(0)} m/s`);
    prev = x;
  }
});
