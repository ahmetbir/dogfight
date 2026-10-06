// Static scene for a room from the welcome: sky, sea, terrain, bases, city and
// clouds, dressed for the room's weather; update moves the sky and weather.
import type * as THREE from "three";
import type { MapInfo, TerrainInfo, WeatherInfo } from "../net/protocol.ts";
import { buildBases, hangarSolids } from "../render/bases.ts";
import { buildCity } from "../render/buildings.ts";
import { paletteFor } from "../render/palette.ts";
import { buildClouds, buildSky, fnv1a } from "../render/sky.ts";
import { buildSea, buildTerrain, decodeHeights } from "../render/terrain.ts";
import { lookFor, WeatherFx } from "../render/weather.ts";

/**
 * solids: hangar and building boxes the chase camera stays in front of.
 * setPerf: performance mode changed in the menu; clouds and rain follow it.
 */
export type World = {
  heights: Uint16Array; solids: number[][];
  update(dtS: number, cam: THREE.Vector3): void;
  setPerf(perf: boolean): void;
};

/**
 * perf: performance mode (fewer clouds and rain streaks). heights: the
 * already decoded terrain (GameState.heights), decoded here when absent.
 */
export function buildWorld(
  scene: THREE.Scene, t: TerrainInfo, map: MapInfo | null, weather: WeatherInfo | null, perf = false, heights?: Uint16Array,
): World {
  const pal = paletteFor(map?.kind);
  const look = lookFor(weather?.kind, perf);
  const sky = buildSky(scene, look);
  const h = heights ?? decodeHeights(t.heights);
  let clouds = buildClouds(t.seed, look);
  scene.add(buildSea(pal), buildTerrain(h, t.size, t.res, pal), clouds);
  if (map) scene.add(buildBases(map.bases, look.night));
  const city = map ? buildCity(map.bld, look.night) : null;
  if (city) scene.add(city);
  const solids = map ? [...map.bases.flatMap(hangarSolids), ...map.bld] : [];
  const fx = new WeatherFx(scene, look, fnv1a(t.seed), sky.flash, solids); // no rain under roofs
  return {
    heights: h,
    solids,
    update: (dtS, cam) => {
      sky.update(cam);
      fx.update(dtS, cam);
    },
    setPerf: (p) => {
      const next = lookFor(weather?.kind, p);
      scene.remove(clouds);
      clouds.dispose();
      clouds.geometry.dispose();
      (clouds.material as THREE.Material).dispose();
      clouds = buildClouds(t.seed, next);
      scene.add(clouds);
      fx.setRain(next.rain);
    },
  };
}
