// Debug scene router (?debug=<name>); only reachable when DEBUG is true.
import { debugFly } from "./fly.ts";
import { debugFx } from "./fx.ts";
import { debugModels } from "./models.ts";
import { debugTerrain } from "./terrain.ts";
import { debugWorld } from "./world.ts";

const scenes: Record<string, (canvas: HTMLCanvasElement, params: URLSearchParams) => void> = {
  terrain: debugTerrain,
  models: debugModels,
  fx: debugFx,
  fly: debugFly,
  world: debugWorld,
};

/** Starts the scene named by ?debug=; false when there is none. */
export function runDebug(canvas: HTMLCanvasElement, params: URLSearchParams): boolean {
  const scene = scenes[params.get("debug") ?? ""];
  if (!scene) return false;
  console.info(`debug=${params.get("debug")}`);
  scene(canvas, params);
  return true;
}
