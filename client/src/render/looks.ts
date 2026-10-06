// Visual weather table (spec §5): fog, clouds, light, rain, lightning, night
// and sky colors per weather kind. Re-exported by weather.ts.
import type { WeatherKind } from "../net/protocol.ts";

export type Look = {
  fog: [number, number];                              // near, far (m)
  clouds: { count: number; min: number; max: number }; // cloud count, base altitude range (m)
  light: number;                                      // daylight factor
  rain: number;                                       // rain streaks around the camera
  lightning: boolean;
  night: boolean;
  zenith: string; horizon: string;                    // sky gradient; the horizon is also the fog color
};

const day = { rain: 0, lightning: false, night: false };

export const LOOKS: Record<WeatherKind, Look> = {
  acik: { ...day, fog: [3000, 14000], clouds: { count: 60, min: 1200, max: 2400 }, light: 1, zenith: "#4a90d9", horizon: "#bfe3ff" },
  bulutlu: { ...day, fog: [2000, 11000], clouds: { count: 140, min: 700, max: 1500 }, light: 0.8, zenith: "#7f97ad", horizon: "#c9d3dc" },
  sisli: { ...day, fog: [600, 3500], clouds: { count: 40, min: 900, max: 1800 }, light: 0.7, zenith: "#9aa6b0", horizon: "#c8cdd1" },
  yagmurlu: {
    ...day, fog: [1200, 7000], clouds: { count: 120, min: 600, max: 1400 }, light: 0.6, rain: 1500,
    zenith: "#56626e", horizon: "#8f9aa4",
  },
  firtina: {
    ...day, fog: [800, 5000], clouds: { count: 160, min: 500, max: 1300 }, light: 0.45, rain: 1500, lightning: true,
    zenith: "#3a434d", horizon: "#6d7782",
  },
  gece: {
    ...day, fog: [1500, 9000], clouds: { count: 30, min: 1200, max: 2400 }, light: 0.25, night: true,
    zenith: "#05070d", horizon: "#1a2233",
  },
};

const RAIN_PERF_MAX = 600;

/** The look of a weather kind (unknown → clear); perf halves clouds and rain (rain ≤ 600). */
export function lookFor(kind: string | undefined, perf: boolean): Look {
  const l = kind !== undefined && Object.hasOwn(LOOKS, kind) ? LOOKS[kind as WeatherKind] : LOOKS.acik;
  if (!perf) return l;
  return {
    ...l,
    clouds: { ...l.clouds, count: Math.round(l.clouds.count / 2) },
    rain: Math.min(RAIN_PERF_MAX, Math.round(l.rain / 2)),
  };
}
