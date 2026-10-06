// Per-map terrain and sea colors (spec §12.1).
import * as THREE from "three";
import type { MapKind } from "../net/protocol.ts";

export type Palette = {
  sand: string; grassLow: string; grassHigh: string; rock: string; snow: string; seabed: string;
  sea: string; seaOpacity: number;
  rockFrom: number; // m: grass below, rock from here up to the snow line
  snowLine: number; // m: snow above
};

export const SEABED_Y = -30; // underwater vertices are drawn no deeper than this
const STEEP = 0.6;           // rise over run above which a vertex is rock

const ada: Palette = {
  sand: "#d8c48a", grassLow: "#5d8a3a", grassHigh: "#4a7030", rock: "#7a7368", snow: "#f2f2f2", seabed: "#1d4f6e",
  sea: "#2a6f97", seaOpacity: 0.92, rockFrom: 300, snowLine: 800,
};

export const PALETTES: Record<MapKind, Palette> = {
  ada,
  sehir: { ...ada, grassLow: "#6f8a55", grassHigh: "#5d7448", rock: "#80786c", rockFrom: 400, snowLine: 99999 },
  col: {
    ...ada, sand: "#e3c58a", grassLow: "#d9b779", grassHigh: "#c99e62", rock: "#b07a4a", seabed: "#c8a06a",
    sea: "#d6b47c", seaOpacity: 1, rockFrom: 150, snowLine: 99999,
  },
  dag: { ...ada, grassLow: "#4f7a3a", grassHigh: "#3f6630", rock: "#6d6a66", snow: "#f4f6f8", rockFrom: 700, snowLine: 1100 },
};

/** The palette of a map kind; unknown kinds get the island's. */
export function paletteFor(kind: string | undefined): Palette {
  return (kind !== undefined && Object.hasOwn(PALETTES, kind)) ? PALETTES[kind as MapKind] : PALETTES.ada;
}

/** Terrain color at height h (m) with slope (rise over run). */
export function baseColor(h: number, slope: number, p: Palette, out: THREE.Color): THREE.Color {
  if (h < 2) return out.set(p.sand).lerp(new THREE.Color(p.seabed), Math.min(1, (2 - h) / (2 - SEABED_Y)));
  if (slope > STEEP || (h >= p.rockFrom && h < p.snowLine)) return out.set(p.rock);
  if (h < p.rockFrom) return out.set(p.grassLow).lerp(new THREE.Color(p.grassHigh), (h - 2) / (p.rockFrom - 2));
  return out.set(p.snow);
}
