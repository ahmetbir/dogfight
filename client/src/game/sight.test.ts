import { test } from "node:test";
import assert from "node:assert/strict";
import { enemyOnRadar, enemyTagVisible } from "./sight.ts";
import { v3 } from "../sim/vec.ts";

const me = { pos: v3(0, 1000, 0), fwd: v3(0, 0, -1) };
const cam = v3(0, 1007, 28);

test("enemy tags: within 1.2 km, or within 8° of the gun line under 3 km", () => {
  assert.ok(enemyTagVisible(me, cam, v3(1100, 1000, 0)), "close, abeam");
  assert.ok(!enemyTagVisible(me, cam, v3(1300, 1000, 0)), "1.3 km abeam");
  assert.ok(enemyTagVisible(me, cam, v3(200, 1000, -2500)), "4.6° off the nose at 2.5 km");
  assert.ok(!enemyTagVisible(me, cam, v3(500, 1000, -2500)), "11° off the nose");
  assert.ok(!enemyTagVisible(me, cam, v3(0, 1000, -3100)), "dead ahead beyond 3 km");
  assert.ok(enemyTagVisible(null, cam, v3(0, 1007, -1100)), "dead: near the camera");
  assert.ok(!enemyTagVisible(null, cam, v3(0, 1000, -2000)), "dead: no gun line");
});

test("enemy radar blips within 2.5 km only", () => {
  assert.ok(enemyOnRadar(v3(0, 0, 0), v3(2400, 500, 0)));
  assert.ok(!enemyOnRadar(v3(0, 0, 0), v3(2600, 0, 0)));
});
