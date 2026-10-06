// Flight environment for prediction: ground under a point and the wind.
import type { FlightEnv } from "../predict/predictor.ts";
import { groundSample } from "../sim/surface.ts";
import { v3 } from "../sim/vec.ts";
import { windAt } from "../sim/wind.ts";
import type { GameState } from "./state.ts";

const CALM = v3(0, 0, 0);
const SEA = { h: 0, surf: 0 };

/** turbo off, flat sea, no wind (tests, debug). */
export const AIR_ENV: FlightEnv = { turbo: false, ground: () => SEA, wind: () => CALM };

/** The room's terrain, paved surfaces and wind (flat sea and calm before the welcome). */
export function flightEnv(s: GameState, turbo: boolean): FlightEnv {
  const t = s.terrain, m = s.map, h = s.heights;
  const wx = s.weather;
  const base = wx ? v3(wx.wind[0], wx.wind[1], wx.wind[2]) : CALM;
  const gust = wx?.gust ?? 0;
  return {
    turbo,
    ground: (x, z) => (t && m && h ? groundSample(h, t.size, t.res, m.bases, x, z) : SEA),
    wind: (tick) => windAt(base, gust, tick),
  };
}
