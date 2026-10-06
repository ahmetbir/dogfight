// ?debug=world&map=sehir&wx=gece&cam=base|runway|plane|hangar|city|high|low&side=0|1: builds a
// room's world (terrain, bases, city, weather) with parked and flying planes
// and holds the camera on a vantage point. globalThis.debugFps reports the
// frame rate. Debug builds only.
import * as THREE from "three";
import type { BaseInfo, Create } from "../net/protocol.ts";
import { Socket, socketURL } from "../net/socket.ts";
import { Effects } from "../render/effects.ts";
import { PlaneViews, type PlaneRender } from "../render/planes.ts";
import { Renderer } from "../render/renderer.ts";
import { qAxisAngle } from "../sim/vec.ts";
import { buildWorld, type World } from "../game/world.ts";
import { debugRoomParams } from "./room.ts";

const GEAR_HEIGHT = 2.5;

const local = (b: BaseInfo, u: number, v: number, y: number) =>
  new THREE.Vector3(b.c[0] + b.axis[0] * u + b.inner[0] * v, b.c[1] + y, b.c[2] + b.axis[1] * u + b.inner[1] * v);

/** Heading ψ: fwd = (−sin ψ, 0, −cos ψ). */
const headingOf = (dx: number, dz: number) => Math.atan2(-dx, -dz);

export function debugWorld(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const r = new Renderer(canvas);
  const fx = new Effects(r.scene);
  const views = new PlaneViews(r.scene, r.camera, fx);
  const planes = new Map<number, PlaneRender>();
  let world: World | null = null;
  const camAt = new THREE.Vector3(0, 3000, 6000);
  const lookAt = new THREE.Vector3();
  const entry = { t: "create", mode: "team", size: 2, diff: "easy", seed: Number(params.get("seed") ?? 1), ...debugRoomParams(params) };
  new Socket(socketURL(location), "debug", entry as Create, {
    onMsg: (m) => {
      if (m.t !== "welcome" || world) return;
      world = buildWorld(r.scene, m.terrain, m.map, m.weather);
      const b = m.map.bases[Number(params.get("side") ?? 0)] ?? m.map.bases[0];
      if (!b) return;
      const plane = (id: number, kind: string, pos: THREE.Vector3, psi: number, gear: boolean): PlaneRender => ({
        id, kind, team: b.side, name: `P${id}`, pos, rot: qAxisAngle({ x: 0, y: 1, z: 0 }, psi), alive: true,
        hp: 100, maxHP: 100, ab: false, gForce: 1, isMe: id === 1, gear,
      });
      const kinds = b.side === "nato" ? ["f16", "f15"] : ["mig29", "su27"];
      b.hangars.slice(0, 3).forEach((h, i) => planes.set(i + 1, plane(i + 1, kinds[i % 2], new THREE.Vector3(h[0], h[1] + GEAR_HEIGHT, h[2]), h[3], true)));
      const rw = local(b, -700, 0, GEAR_HEIGHT);
      planes.set(4, plane(4, kinds[1], rw, headingOf(b.axis[0], b.axis[1]), true));
      planes.set(5, plane(5, kinds[0], local(b, 200, -60, 120), headingOf(b.axis[0], b.axis[1]), false));
      const cam = params.get("cam") ?? "base";
      const presets: Record<string, [THREE.Vector3, THREE.Vector3]> = {
        base: [local(b, -360, 120, 30), local(b, -180, 228, 4)],
        runway: [local(b, -1150, -25, 25), local(b, 0, 60, 0)],
        high: [local(b, -1100, -500, 450), local(b, -200, 150, 0)],
        city: [new THREE.Vector3(0, 650, 2600), new THREE.Vector3(0, 0, 0)],
        plane: [local(b, -722, -16, 5), local(b, -700, 0, 2)],
        hangar: [local(b, -215, 165, 9), local(b, -250, 226, 4)],
        low: [local(b, -800, -1500, 1400), local(b, 1500, 1500, 300)],
      };
      const [p, t] = presets[cam] ?? presets.base;
      camAt.copy(p);
      lookAt.copy(t);
    },
    onStatus: () => {},
    onFatal: (msg) => console.info("debug=world fatal:", msg),
  });
  let last = performance.now();
  const times: number[] = [];
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    times.push(now);
    while (times.length > 0 && now - times[0] > 2000) times.shift();
    (globalThis as { debugFps?: number }).debugFps = times.length / 2;
    r.camera.position.copy(camAt);
    r.camera.lookAt(lookAt);
    views.sync(planes);
    fx.update(dt);
    world?.update(dt, r.camera.position);
    r.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r });
}
