// Paved surfaces from welcome.map.bases; mirrors maps.Map.SurfaceAt.
import type { BaseInfo } from "../net/protocol.ts";
import { heightAt } from "../render/heightmap.ts";
import type { GroundSample } from "./ground.ts";

export const SURF_NONE = 0, SURF_RUNWAY = 1, SURF_TAXI = 2;

/** The paved surface at (x, z); runway wins over taxiway. */
export function surfaceAt(bases: BaseInfo[], x: number, z: number): number {
  let best = SURF_NONE;
  for (const b of bases) {
    for (const a of b.areas) {
      if (x < a[0] || x > a[2] || z < a[1] || z > a[3]) continue;
      if (a[4] === SURF_RUNWAY) return SURF_RUNWAY;
      if (a[4] === SURF_TAXI) best = SURF_TAXI;
    }
  }
  return best;
}

/** terrain.Ground (water level 0) and the surface under (x, z). */
export function groundSample(heights: Uint16Array, size: number, res: number, bases: BaseInfo[], x: number, z: number): GroundSample {
  return { h: Math.max(heightAt(heights, size, res, x, z), 0), surf: surfaceAt(bases, x, z) };
}
