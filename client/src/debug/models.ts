// ?debug=models: the four aircraft side by side, turning. Debug builds only.
// &view=top|side|front|quarter freezes them; &team=nato|soviet|none|own; &ab=1 lights afterburners.
import * as THREE from "three";
import { buildModel } from "../render/models.ts";
import { Renderer } from "../render/renderer.ts";
import { buildSky } from "../render/sky.ts";

const KINDS = ["f16", "f15", "mig29", "su27"];
const GAP = 17;

export function debugModels(canvas: HTMLCanvasElement, params: URLSearchParams): void {
  const r = new Renderer(canvas);
  const sky = buildSky(r.scene);
  const team = params.get("team") ?? "nato";
  const view = params.get("view");
  const ab = params.get("ab") === "1";
  const models = KINDS.map((k, i) => {
    const m = buildModel(k, team === "own" ? "none" : (team as "nato" | "soviet" | "none"), team === "own");
    m.position.set((i - 1.5) * GAP, 1000, 0);
    for (const o of m.getObjectsByProperty("name", "ab")) o.visible = ab;
    for (const o of m.getObjectsByProperty("name", "idle")) o.visible = !ab;
    r.scene.add(m);
    return m;
  });
  const center = new THREE.Vector3(0, 1000, 0);
  if (view === "top") r.camera.position.set(0, 1036, 0.01);
  else if (view === "side") r.camera.position.set(0, 1000, 38);
  else if (view === "front") r.camera.position.set(0, 1003, -38);
  else if (view === "quarter") r.camera.position.set(0, 1016, -30);
  else r.camera.position.set(0, 1012, 30);
  r.camera.lookAt(center);
  if (view === "side") for (const m of models) m.rotation.y = -Math.PI / 2; // nose toward +X
  const t0 = performance.now();
  const frame = () => {
    if (!view) for (const m of models) m.rotation.y = (performance.now() - t0) / 1000 * 0.6 + Number(params.get("ang") ?? 0);
    sky.update(r.camera.position);
    r.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r });
}
