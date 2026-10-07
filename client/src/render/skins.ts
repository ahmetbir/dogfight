// Paint schemes ("skins") for the .glb jets: the body and secondary colours,
// an optional camouflage pattern and canopy tint. The team colour always
// stays on the stripe role (fin tips, roundels, stripes), so friend and foe
// never mix. The server knows the same ids (internal/game skin.go); it checks
// a pick's skin and relays it in the roster. Pure data and pixels here; the
// textures and materials are render/camo.ts.
import type { AircraftKind } from "../net/protocol.ts";
import { teamColors, type Team } from "./models/common.ts";

/**
 * Who may wear each scheme ("*": every jet; else the kinds, space-separated),
 * in the order the picker shows them. One `id: "kinds"` pair per entry:
 * TestClientSkinsMatchServer (internal/match) pins this table to the server's.
 */
export const SKIN_KINDS = {
  standard: "*", airsup: "*", desert: "*", winter: "*", naval: "*", splinter: "*", night: "*",
  flanker: "su27 su30",
  blackband: "f14 f4",
};

export type SkinId = keyof typeof SKIN_KINDS;

export const STANDARD: SkinId = "standard";

/**
 * A camouflage pattern, tiled over the airframe (render/camo.ts projects it
 * from above and from the side, in metres from the nose). colors are the
 * camo colours over the scheme's body colour; cover is each one's share of
 * the area (the body keeps the rest).
 */
export type Pattern =
  | { kind: "blotch"; colors: string[]; cover: number[]; tile: number; seed: number }
  | { kind: "splinter"; colors: string[]; cover: number[]; tile: number; seed: number }
  | { kind: "band"; colors: [string]; from: number; to: number; tile: number }; // body colour only from..to m behind the nose

export type Scheme = {
  body?: string;       // absent: the team's grey (the standard look)
  secondary?: string;  // radome, frame bow, pylons, rails
  canopy?: string;     // absent: the model's smoked glass
  pattern?: Pattern;
};

export const SCHEMES: Readonly<Record<SkinId, Scheme>> = {
  standard: {},
  airsup: {
    body: "#aeb9c6", secondary: "#97a2ae",
    pattern: { kind: "blotch", colors: ["#6d7a88"], cover: [0.45], tile: 18, seed: 11 },
  },
  desert: {
    body: "#d6b98a", secondary: "#c7aa7c",
    pattern: { kind: "blotch", colors: ["#9b6c42", "#b7905e"], cover: [0.34, 0.2], tile: 16, seed: 23 },
  },
  winter: {
    body: "#eef1f3", secondary: "#e2e6e9", canopy: "#6d8296",
    pattern: { kind: "splinter", colors: ["#aeb7bf", "#7f8b96"], cover: [0.28, 0.2], tile: 14, seed: 37 },
  },
  naval: { body: "#b9c0c6", secondary: "#eef1f2" },
  splinter: {
    body: "#b9a97e", secondary: "#8f9474",
    pattern: { kind: "splinter", colors: ["#5d6c3c", "#70553a"], cover: [0.34, 0.26], tile: 15, seed: 53 },
  },
  night: { body: "#3b4048", secondary: "#2c3036", canopy: "#28323d" },
  flanker: {
    body: "#bfcdd6", secondary: "#e6eaec",
    pattern: { kind: "blotch", colors: ["#7e95a6", "#a1acb3"], cover: [0.32, 0.24], tile: 17, seed: 71 },
  },
  blackband: {
    body: "#f0f0ec", secondary: "#30343a", canopy: "#2a3440",
    pattern: { kind: "band", colors: ["#30343a"], from: 9.3, to: 10.4, tile: 64 },
  },
};

/** Each jet's scheme before the player chose one: its best-known look. */
const DEFAULTS: Partial<Record<AircraftKind, SkinId>> = {
  f15: "airsup", f22: "airsup", su27: "flanker", su30: "flanker",
  f14: "naval", f18: "naval", f4: "splinter", su25: "desert",
};

/** The schemes kind may wear, in picker order (an unknown kind: the shared set). */
export function skinsFor(kind: string): SkinId[] {
  return (Object.keys(SKIN_KINDS) as SkinId[]).filter((id) => {
    const who = SKIN_KINDS[id];
    return who === "*" || who.split(" ").includes(kind);
  });
}

/** id if kind may wear it, else standard (unknown ids, another jet's scheme, missing). */
export function validSkin(kind: string, id: string | undefined | null): SkinId {
  return id && (skinsFor(kind) as string[]).includes(id) ? (id as SkinId) : STANDARD;
}

/** The scheme a jet wears until its pilot picks one. */
export function defaultSkin(kind: string): SkinId {
  return validSkin(kind, DEFAULTS[kind as AircraftKind]);
}

const FFA_OWN_STRIPE = "#e8b33a"; // my plane in FFA, on a painted body: the amber of my standard look

/**
 * The colours of the recoloured roles for a scheme: body and secondary from
 * the scheme (standard: the team's), stripe always the team's, canopy only
 * when the scheme tints it (null: the model's).
 */
export function skinColors(id: SkinId, team: Team, own: boolean): { body: string; secondary: string; stripe: string; canopy: string | null } {
  const tc = teamColors(team, own);
  const s = SCHEMES[id] ?? SCHEMES.standard;
  if (!s.body) return { ...tc, canopy: s.canopy ?? null };
  const stripe = team === "none" && own ? FFA_OWN_STRIPE : tc.stripe;
  return { body: s.body, secondary: s.secondary ?? s.body, stripe, canopy: s.canopy ?? null };
}

// ---- pattern pixels -------------------------------------------------------

export const PATTERN_PX = 64; // a tile's texels per side: about 25 cm each, chunky on purpose

/** mulberry32: a small seeded generator, the same pattern on every client. */
function rand(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function rgb(hex: string): [number, number, number] {
  const n = parseInt(hex.slice(1), 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

/** Tileable value noise, n×n, from a cells×cells lattice of random values. */
function noise(n: number, cells: number, r: () => number): Float32Array {
  const lat = Array.from({ length: cells * cells }, r);
  const at = (x: number, y: number) => lat[((y + cells) % cells) * cells + ((x + cells) % cells)];
  const ease = (t: number) => t * t * (3 - 2 * t);
  const out = new Float32Array(n * n);
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      const fx = (x / n) * cells, fy = (y / n) * cells;
      const ix = Math.floor(fx), iy = Math.floor(fy);
      const tx = ease(fx - ix), ty = ease(fy - iy);
      const top = at(ix, iy) + (at(ix + 1, iy) - at(ix, iy)) * tx;
      const bot = at(ix, iy + 1) + (at(ix + 1, iy + 1) - at(ix, iy + 1)) * tx;
      out[y * n + x] = top + (bot - top) * ty;
    }
  }
  return out;
}

/**
 * Which colour each texel takes: 0 the body, i+1 colors[i]. Blotches are
 * thresholded noise (quantiles, so each colour gets its cover); splinter is
 * a wrapped Voronoi tiling, whose straight cell edges give the shards.
 */
export function patternIndex(p: Pattern, n = PATTERN_PX): Uint8Array {
  const idx = new Uint8Array(n * n);
  if (p.kind === "band") {
    for (let y = 0; y < n; y++) {
      const m = ((y + 0.5) / n) * p.tile; // metres behind the nose
      const body = m >= p.from && m < p.to;
      idx.fill(body ? 0 : 1, y * n, (y + 1) * n);
    }
    return idx;
  }
  const r = rand(p.seed);
  // Cumulative cover from the last colour back: colour k takes the top cover[k] share.
  const shares = p.colors.map((_, i) => Math.max(0, Math.min(1, p.cover[i] ?? 0)));
  if (p.kind === "blotch") {
    const big = noise(n, 4, r), small = noise(n, 9, r);
    const v = big.map((b, i) => b * 0.72 + small[i] * 0.28);
    const sorted = Float32Array.from(v).sort();
    const cut = (share: number) => sorted[Math.min(n * n - 1, Math.max(0, Math.floor((1 - share) * n * n)))];
    let above = 0;
    const lows = shares.map((s) => cut((above += s))); // colour i holds the values from lows[i] up to the previous cut
    for (let i = 0; i < n * n; i++) {
      for (let k = 0; k < lows.length; k++) {
        if (v[i] >= lows[k]) { idx[i] = k + 1; break; }
      }
    }
    return idx;
  }
  const seeds = 18;
  const pts = Array.from({ length: seeds }, () => [r() * n, r() * n] as const);
  // Each cell's colour by the covers: a shuffled list with the right counts.
  const counts = shares.map((s) => Math.round(s * seeds));
  const colorOf: number[] = [];
  counts.forEach((c, k) => { for (let j = 0; j < c; j++) colorOf.push(k + 1); });
  while (colorOf.length < seeds) colorOf.push(0);
  for (let i = colorOf.length - 1; i > 0; i--) {
    const j = Math.floor(r() * (i + 1));
    [colorOf[i], colorOf[j]] = [colorOf[j], colorOf[i]];
  }
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let best = Infinity, cell = 0;
      pts.forEach(([px, py], c) => {
        let dx = Math.abs(x + 0.5 - px), dy = Math.abs(y + 0.5 - py);
        dx = Math.min(dx, n - dx);
        dy = Math.min(dy, n - dy);
        const d = dx * dx + dy * dy * 0.6; // rows run along the jet: the shards stretch that way
        if (d < best) { best = d; cell = c; }
      });
      idx[y * n + x] = colorOf[cell];
    }
  }
  return idx;
}

/**
 * The pattern as RGBA multipliers over the body colour (sRGB bytes): the
 * body texels are white, a camo texel is its colour divided by the body's,
 * so body × texel gives the camo colour. Colours lighter than the body clamp.
 */
export function patternPixels(p: Pattern, body: string, n = PATTERN_PX): Uint8Array {
  const idx = patternIndex(p, n);
  const base = rgb(body);
  const mul = [[255, 255, 255], ...p.colors.map((c) => rgb(c).map((v, i) => Math.min(255, Math.round((v / Math.max(1, base[i])) * 255))))];
  const out = new Uint8Array(n * n * 4);
  for (let i = 0; i < n * n; i++) {
    const m = mul[idx[i]] ?? mul[0];
    out.set([m[0], m[1], m[2], 255], i * 4);
  }
  return out;
}

export const SWATCH_PX = 16;

/**
 * A picker chip's pixels (RGBA, n×n): the body in its camo, the secondary
 * colour in the top-left corner, the team stripe along the bottom.
 */
export function swatchPixels(id: SkinId, team: Team, own: boolean, n = SWATCH_PX): Uint8ClampedArray<ArrayBuffer> {
  const c = skinColors(id, team, own);
  const p = SCHEMES[id]?.pattern;
  const body = rgb(c.body), sec = rgb(c.secondary), stripe = rgb(c.stripe);
  const camo = p ? [body, ...p.colors.map(rgb)] : [body];
  const idx = p ? patternIndex(p) : null;
  const out = new Uint8ClampedArray(n * n * 4);
  const bar = Math.max(2, Math.round(n / 6));
  for (let y = 0; y < n; y++) {
    for (let x = 0; x < n; x++) {
      let col = body;
      if (y >= n - bar) col = stripe;
      else if (x + y < n / 3) col = sec;
      else if (p && idx) {
        // band: its body stripe across the middle; camo: every other texel of the tile's corner (about 8 m)
        const k = p.kind === "band" ? (Math.abs(y - (n - bar) / 2) < n / 7 ? 0 : 1) : idx[2 * y * PATTERN_PX + 2 * x];
        col = camo[k] ?? body;
      }
      out.set([col[0], col[1], col[2], 255], (y * n + x) * 4);
    }
  }
  return out;
}
