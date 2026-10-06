// ?debug=fx: explosions every second, a steady tracer stream, a circling
// missile with its trail, flares, sparks and three planes exercising
// PlaneViews (afterburner + wingtip trails, damage smoke, name tags).
// Debug builds only.
import * as THREE from "three";
import { qAxisAngle, qMul, type V3 } from "../sim/vec.ts";
import { Effects } from "../render/effects.ts";
import { PlaneViews, type PlaneRender } from "../render/planes.ts";
import { Renderer } from "../render/renderer.ts";
import { buildSky } from "../render/sky.ts";
import { buildSea } from "../render/terrain.ts";

const ALT = 1500;

export function debugFx(canvas: HTMLCanvasElement): void {
  const r = new Renderer(canvas);
  const sky = buildSky(r.scene);
  r.scene.add(buildSea());
  const fx = new Effects(r.scene);
  const views = new PlaneViews(r.scene, r.camera, fx);
  r.camera.position.set(0, ALT + 45, 170);
  r.camera.lookAt(0, ALT + 15, 0);

  const plane = (id: number, kind: string, team: string, name: string, extra: Partial<PlaneRender>): PlaneRender => ({
    id, kind, team, name, pos: { x: 0, y: ALT, z: 0 }, rot: { w: 1, x: 0, y: 0, z: 0 }, alive: true,
    hp: 100, maxHP: 100, ab: false, gForce: 1, isMe: false, gear: false, ...extra,
  });
  const planes = new Map<number, PlaneRender>([
    [1, plane(1, "f16", "nato", "me", { isMe: true, ab: true, gForce: 6 })],
    [2, plane(2, "mig29", "soviet", "Ivan", { hp: 25 })],
    [3, plane(3, "f15", "nato", "Wingman", { ab: true })],
  ]);

  let last = performance.now();
  let nextBoom = 0;
  let nextFlare = 0;
  let nextSpark = 0;
  let nextShot = 0;
  let t = 0;
  const frame = () => {
    const now = performance.now();
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    t += dt;
    // Plane 1 turns hard in a circle (banked), 2 and 3 fly slow straight passes.
    const a = t * 0.5;
    const p1 = planes.get(1)!;
    p1.pos = { x: Math.cos(a) * 90, y: ALT + 10, z: Math.sin(a) * 90 };
    const heading = qAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI - a); // nose along the circle
    p1.rot = qMul(heading, qAxisAngle({ x: 0, y: 0, z: 1 }, -1.1));
    const p2 = planes.get(2)!;
    p2.pos = { x: ((t * 25) % 300) - 150, y: ALT - 20, z: -60 };
    p2.rot = qAxisAngle({ x: 0, y: 1, z: 0 }, -Math.PI / 2);
    const p3 = planes.get(3)!;
    p3.pos = { x: 150 - ((t * 20) % 300), y: ALT + 40, z: 40 };
    p3.rot = qAxisAngle({ x: 0, y: 1, z: 0 }, Math.PI / 2);
    views.sync(planes);

    if (t >= nextShot) {
      nextShot = t + 0.06;
      const from: V3 = { x: -120, y: ALT + 5, z: 80 };
      const dir = new THREE.Vector3(1, 0.05, -0.6).normalize().multiplyScalar(900);
      fx.tracer(from, { x: dir.x, y: dir.y, z: dir.z }, 0.35, Math.floor(t * 2) % 2 === 0);
    }
    if (t >= nextBoom) {
      nextBoom = t + 1;
      const big = Math.floor(t) % 2 === 0;
      fx.explosion({ x: big ? 60 : -60, y: ALT + 20, z: -20 }, big);
    }
    if (t >= nextSpark) {
      nextSpark = t + 0.5;
      fx.sparks({ x: 0, y: ALT + 30, z: 30 });
    }
    if (t >= nextFlare) nextFlare = t + 3;
    const age = t - (nextFlare - 3); // two flares burning 2.5 s of every 3, drifting apart and falling
    fx.flares(age < 2.5 ? [-1, 1].map((i) => ({ id: i, pos: { x: 20 + i * 25 * age, y: ALT + 50 - 7 * age * age, z: 30 * age } })) : [], dt);
    if (Math.abs(age - 1.5) < dt / 2) fx.puff({ x: -20, y: ALT + 50, z: 0 });
    const m = t * 1.4;
    fx.missileTrail(99, { x: Math.cos(m) * 140, y: ALT + 70 + Math.sin(m * 2) * 15, z: Math.sin(m) * 140 - 40 });
    fx.update(dt);
    sky.update(r.camera.position);
    r.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r });
}
