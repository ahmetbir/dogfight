// Heightmap decoding and sampling; mirrors internal/terrain (no Three.js, so
// it runs under node tests).

/** Decodes base64 little-endian uint16 samples (welcome.terrain.heights). */
export function decodeHeights(b64: string): Uint16Array {
  const bin = atob(b64);
  const out = new Uint16Array(bin.length >> 1);
  for (let i = 0; i < out.length; i++) out[i] = bin.charCodeAt(2 * i) | (bin.charCodeAt(2 * i + 1) << 8);
  return out;
}

/** Height in meters of quantized sample q (same as terrain.Decode). */
export function sampleHeight(q: number): number {
  return q / 10 - 500;
}

/** Bilinear terrain height at (x, z); -200 outside the grid (terrain.Map.Height). */
export function heightAt(heights: Uint16Array, size: number, res: number, x: number, z: number): number {
  const cell = size / (res - 1);
  const gx = (x + size / 2) / cell;
  const gz = (z + size / 2) / cell;
  if (gx < 0 || gz < 0 || gx > res - 1 || gz > res - 1) return -200;
  const x0 = Math.min(Math.trunc(gx), res - 2);
  const z0 = Math.min(Math.trunc(gz), res - 2);
  const tx = gx - x0;
  const tz = gz - z0;
  const at = (xi: number, zi: number) => sampleHeight(heights[zi * res + xi]);
  const a = at(x0, z0) + (at(x0 + 1, z0) - at(x0, z0)) * tx;
  const b = at(x0, z0 + 1) + (at(x0 + 1, z0 + 1) - at(x0, z0 + 1)) * tx;
  return a + (b - a) * tz;
}
