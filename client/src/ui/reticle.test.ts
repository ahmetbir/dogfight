import { test } from "node:test";
import assert from "node:assert/strict";
import { leadDir, leadMark, noseMark, type Body } from "./reticle.ts";
import { add, dist, dot, len, norm, scale, sub, v3, type V3 } from "../sim/vec.ts";

// internal/sim/cannon.go: muzzle 8 m ahead, BulletSpeed 900 on top of the
// shooter's velocity, BulletLife 72 ticks, no gravity; each tick planes step
// first, then a bullet sweeps the segment to its next position against the
// target's position of that tick (segmentSphereT).
const DT = 1 / 60;
function closest(me: Body, dir: V3, target: Body): number {
  let pos = add(me.pos, scale(dir, 8));
  const vel = add(me.vel, scale(dir, 900));
  let best = Infinity;
  for (let n = 0; n < 72; n++) {
    const tp = add(target.pos, scale(target.vel, n * DT));
    const end = add(pos, scale(vel, DT));
    const ab = sub(end, pos);
    const t = Math.max(0, Math.min(1, dot(sub(tp, pos), ab) / dot(ab, ab)));
    best = Math.min(best, dist(add(pos, scale(ab, t)), tp));
    pos = end;
  }
  return best;
}

const cases: [string, Body, Body][] = [
  ["tail chase", { pos: v3(0, 1000, 0), vel: v3(0, 0, -220) }, { pos: v3(30, 1010, -600), vel: v3(0, 0, -200) }],
  ["crossing", { pos: v3(0, 1000, 0), vel: v3(0, 0, -200) }, { pos: v3(-150, 1000, -700), vel: v3(250, 0, -50) }],
  ["climbing turn", { pos: v3(0, 1000, 0), vel: v3(40, 30, -230) }, { pos: v3(200, 1150, -800), vel: v3(-120, 80, -180) }],
  ["head-on", { pos: v3(0, 1000, 0), vel: v3(0, 0, -250) }, { pos: v3(20, 1000, -1500), vel: v3(0, 0, 250) }],
  ["fast sideways shooter", { pos: v3(0, 1000, 0), vel: v3(150, 0, -150) }, { pos: v3(0, 1000, -500), vel: v3(0, 0, -150) }],
];

test("a round fired along the lead direction meets the target (sim kinematics)", () => {
  for (const [name, me, target] of cases) {
    const d = leadDir(me, target);
    assert.ok(d, `${name}: in range`);
    assert.ok(Math.abs(len(d) - 1) < 1e-9);
    const miss = closest(me, d, target);
    assert.ok(miss < 2, `${name}: misses by ${miss.toFixed(2)} m (hit radius 7)`);
  }
});

test("no lead beyond the bullet's 1.2 s life", () => {
  assert.equal(leadDir({ pos: v3(0, 0, 0), vel: v3(0, 0, -200) }, { pos: v3(0, 0, -2500), vel: v3(0, 0, -250) }), null);
});

/** Camera 28 m behind and 7 m above a plane flying −Z: a pinhole projection (1000 px focal). */
function chaseProject(plane: V3) {
  const cam = add(plane, v3(0, 7, 28));
  return (p: V3) => {
    const r = sub(p, cam);
    return r.z >= -1 ? null : { x: (1000 * r.x) / -r.z, y: (-1000 * r.y) / -r.z };
  };
}

test("lead mark sits on the nose cross when the nose points along the lead (no parallax)", () => {
  for (const [name, me, target] of cases) {
    const project = chaseProject(me.pos);
    const lead = project(leadMark(me, target)!)!;
    const nose = project(noseMark(me.pos, leadDir(me, target)!))!;
    assert.ok(Math.hypot(lead.x - nose.x, lead.y - nose.y) < 1e-6, `${name}: ${JSON.stringify([lead, nose])}`);
  }
});
