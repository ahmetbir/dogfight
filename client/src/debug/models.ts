// ?debug=models: the four aircraft side by side, turning. Debug builds only.
// &view=top|side|front|quarter freezes them; &team=nato|soviet|none|own; &ab=1 lights afterburners.
// &glb=1 shows the .glb models where the build has one; &pair=<kind> shows that kind's
// built-in model (left) next to its .glb (right); &gear=1 lowers the .glb gear;
// &wiggle=1 sweeps the .glb control surfaces; &kinds=f22,su57,... lines up those kinds instead
// of the four (kinds without a built-in model show the F-16 until their .glb loads);
// &sweep=0,1,... sets each slot's swing wings (0 forward .. 1 back; F-14, MiG-23).
import * as THREE from "three";
import { dressGlb, type Rig } from "../render/glb.ts";
import { validSkin } from "../render/skins.ts";
import { buildModel, tryLoadGlb } from "../render/models.ts";
import type { Team } from "../render/models/common.ts";
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
  const pair = params.get("pair");
  const useGlb = params.get("glb") === "1";
  const gear = params.get("gear") === "1";
  const wiggle = params.get("wiggle") === "1";
  const tm = (team === "own" ? "none" : team) as Team;
  const own = team === "own";
  const kinds = params.get("kinds")?.split(",").filter(Boolean) ?? KINDS;
  const sweeps = params.get("sweep")?.split(",").map(Number) ?? [];
  const slots: { kind: string; glb: boolean }[] = pair
    ? [{ kind: pair, glb: false }, { kind: pair, glb: true }]
    : kinds.map((kind) => ({ kind, glb: useGlb }));
  const rigs: Rig[] = [];
  const models = slots.map(({ kind, glb }, i) => {
    const m = buildModel(kind, tm, own);
    // Seen from the front (camera at -z) +x is on the left: keep the slot order left to right.
    const flip = view === "front" || view === "quarter" ? -1 : 1;
    m.position.set(flip * (i - (slots.length - 1) / 2) * GAP, 1000, 0);
    const lights = (root: THREE.Object3D) => {
      for (const o of root.getObjectsByProperty("name", "ab")) o.visible = ab;
      for (const o of root.getObjectsByProperty("name", "idle")) o.visible = !ab;
    };
    lights(m);
    if (glb) {
      void tryLoadGlb(kind).then((g) => {
        if (!g) return;
        for (const o of [...m.children]) m.remove(o);
        const d = dressGlb(g, tm, own, validSkin(kind, params.get("skin")));
        d.body.scale.setScalar(1 / m.scale.x);
        m.add(d.body);
        lights(d.body);
        d.rig.pose({ p: 0, r: 0, y: 0 }, gear ? 1 : 0);
        if (Number.isFinite(sweeps[i])) d.rig.sweep(sweeps[i]!);
        rigs.push(d.rig);
      });
    }
    r.scene.add(m);
    return m;
  });
  const center = new THREE.Vector3(0, 1000, 0);
  if (view === "top") r.camera.position.set(0, 1036, 0.01);
  else if (view === "side") r.camera.position.set(0, 1000, 38);
  else if (view === "front") r.camera.position.set(0, 1003, -38);
  else if (view === "quarter") r.camera.position.set(0, 1016, -30);
  else r.camera.position.set(0, 1012, 30);
  if (pair) r.camera.position.lerp(center, 0.45); // two jets: come closer
  else if (slots.length > 4) r.camera.position.sub(center).multiplyScalar(slots.length / 4).add(center); // a longer row: back off
  r.camera.lookAt(center);
  if (view === "side") for (const m of models) m.rotation.y = -Math.PI / 2; // nose toward +X
  const t0 = performance.now();
  const frame = () => {
    const t = (performance.now() - t0) / 1000;
    if (!view) for (const m of models) m.rotation.y = t * 0.6 + Number(params.get("ang") ?? 0);
    if (wiggle) for (const rig of rigs) rig.pose({ p: Math.sin(t * 1.7), r: Math.sin(t * 1.1), y: Math.sin(t * 0.8) }, gear ? 1 : 0);
    sky.update(r.camera.position);
    r.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  Object.assign(globalThis, { debugRenderer: r });
}
