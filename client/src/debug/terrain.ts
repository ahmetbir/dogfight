// ?debug=terrain: creates a room (seed 1), draws its island, sea, sky and
// clouds and orbits the camera around it. Debug builds only.
import * as THREE from "three";
import { openSocket, socketURL } from "../net/socket.ts";
import { Renderer } from "../render/renderer.ts";
import { buildClouds, buildSky } from "../render/sky.ts";
import { buildSea, buildTerrain, decodeHeights } from "../render/terrain.ts";

export function debugTerrain(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const r = new Renderer(canvas);
  const sky = buildSky(r.scene);
  r.scene.add(buildSea());
  let built = false;
  openSocket(socketURL(location), "debug", { t: "create", mode: "team", size: 2, diff: "easy", seed: 1 }, {
    onMsg: (m) => {
      if (m.t !== "welcome" || built) return;
      built = true;
      const t = m.terrain;
      r.scene.add(buildTerrain(decodeHeights(t.heights), t.size, t.res));
      r.scene.add(buildClouds(t.seed));
    },
    onStatus: () => {},
    onFatal: (msg) => console.info("debug=terrain fatal:", msg),
  });
  const low = params.get("cam") === "low"; // cruise altitude among the clouds
  const radius = low ? 3500 : 7000;
  const alt = low ? 1700 : 2600;
  const target = new THREE.Vector3(0, low ? 1500 : 200, 0);
  const t0 = performance.now();
  const frame = () => {
    const a = (performance.now() - t0) / 1000 * 0.05 + Number(params.get("ang") ?? 0);
    r.camera.position.set(Math.sin(a) * radius, alt, Math.cos(a) * radius);
    r.camera.lookAt(target);
    sky.update(r.camera.position);
    r.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r });
}
