// ?debug=fly: local flight over flat ground without a server (stepFlight +
// chase camera + the configured control scheme). &scheme=mouse|keyboard
// overrides the saved setting; &kind=f15|mig29|su27 flies another jet's
// model (the F-16's flight model); &skin=<id> paints it, &team=nato|soviet
// colours it (default FFA, own). Debug builds only.
import * as THREE from "three";
import { InputState } from "../input/input.ts";
import { loadSettings, makeScheme } from "../input/schemes.ts";
import { airframe } from "../game/airframe.ts";
import { ChaseCam } from "../render/camera.ts";
import { Effects } from "../render/effects.ts";
import { PlaneViews, type PlaneRender } from "../render/planes.ts";
import { Renderer } from "../render/renderer.ts";
import { buildSky } from "../render/sky.ts";
import { DT, stepFlight, type FlightState, type Spec } from "../sim/flight.ts";
import { add, len, qForward, qIdentity, scale, v3 } from "../sim/vec.ts";

const F16: Spec = { maxSpeed: 230, maxSpeedAB: 290, accel: 48, rollRate: 4.2, pitchRate: 1.6, yawRate: 0.5, cornerSpeed: 170, rotateSpeed: 78 };
const start = (): FlightState => ({ pos: v3(0, 1500, 0), rot: qIdentity(), vel: v3(0, 0, -200), th: 0.8 });

export function debugFly(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const r = new Renderer(canvas);
  const sky = buildSky(r.scene);
  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000, 80, 80).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: "#5d8a3a", }),
  );
  const grid = new THREE.GridHelper(40000, 200, 0x3c5a26, 0x3c5a26);
  grid.position.y = 0.5;
  r.scene.add(ground, grid);
  const fx = new Effects(r.scene);
  const views = new PlaneViews(r.scene, r.camera, fx);
  const settings = loadSettings();
  const s = params.get("scheme");
  if (s === "mouse" || s === "keyboard") settings.scheme = s;
  const scheme = makeScheme(settings);
  const input = new InputState(canvas);
  input.playing = true;
  const cam = new ChaseCam(r.camera);
  const kind = params.get("kind") ?? "f16";
  const jet = airframe(kind);
  const hud = document.createElement("pre");
  hud.style.cssText = "position:fixed;left:12px;top:8px;margin:0;font:14px monospace;text-shadow:0 0 3px #000";
  document.getElementById("ui")?.append(hud);

  let fs = start();
  let acc = 0;
  let last = performance.now();
  let tick = 0;
  let lastShot = -99;
  let out = scheme.frame(input, fs, 0); // last tick's controls (camera, AB flame)
  const frame = (now: number) => {
    const dt = Math.min((now - last) / 1000, 0.1);
    last = now;
    acc += dt;
    while (acc >= DT) {
      acc -= DT;
      tick++;
      out = scheme.frame(input, fs, DT);
      fs = stepFlight(fs, out.stick, F16, { turbo: false });
      if (out.fire && tick - lastShot >= 4) {
        lastShot = tick;
        const fwd = qForward(fs.rot);
        fx.tracer(add(fs.pos, scale(fwd, jet.muzzle)), add(fs.vel, scale(fwd, 900)), 1.2, true);
      }
      if (fs.pos.y < 2) { // crashed: boom and restart
        fx.explosion(fs.pos, true);
        fs = start();
        scheme.reset();
        cam.snap();
      }
    }
    const me: PlaneRender = {
      id: 1, kind, team: params.get("team") ?? "none", skin: params.get("skin") ?? undefined, pos: fs.pos, rot: fs.rot, alive: true, hp: 100, maxHP: 100,
      ab: out.stick.ab, gForce: 1, name: "me", isMe: true, gear: !!fs.gear, ctl: out.stick,
    };
    views.sync(new Map([[1, me]]));
    cam.update(dt, fs.pos, fs.rot, len(fs.vel), out.lookBack, out.aimDir, jet.length);
    fx.update(dt);
    sky.update(r.camera.position);
    r.render();
    hud.textContent = `${settings.scheme}  speed ${len(fs.vel).toFixed(0)} m/s  alt ${fs.pos.y.toFixed(0)} m  throttle ${(out.stick.th * 100).toFixed(0)}%${out.stick.ab ? " AB" : ""}\n` +
      (settings.scheme === "mouse" && !input.locked() ? "click to lock the mouse" : "");
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r, debugFly: { state: () => fs, input } });
}
