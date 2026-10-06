import * as THREE from "three";
import { sampleHeight } from "./heightmap.ts";
import { baseColor, PALETTES, SEABED_Y, type Palette } from "./palette.ts";

export { decodeHeights, heightAt } from "./heightmap.ts";

/** Deterministic per-index noise in [0, 1) (integer hash, no PRNG). */
export function hash(i: number): number {
  let h = Math.imul(i ^ 0x9e3779b9, 0x85ebca6b);
  h = Math.imul(h ^ (h >>> 13), 0xc2b2ae35);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967296;
}

/** Low-poly terrain mesh: a res×res grid, Y = sample height, colored by height and slope. */
export function buildTerrain(heights: Uint16Array, size: number, res: number, pal: Palette = PALETTES.ada): THREE.Mesh {
  const cell = size / (res - 1);
  const at = (xi: number, zi: number) =>
    sampleHeight(heights[Math.min(res - 1, Math.max(0, zi)) * res + Math.min(res - 1, Math.max(0, xi))]);
  const pos = new Float32Array(res * res * 3);
  const col = new Float32Array(res * res * 3);
  const c = new THREE.Color();
  for (let zi = 0; zi < res; zi++) {
    for (let xi = 0; xi < res; xi++) {
      const i = zi * res + xi;
      const h = at(xi, zi);
      pos[3 * i] = -size / 2 + xi * cell;
      // The deep floor is flat at SEABED_Y and matches the seabed plane under
      // the sea, so no slope shading shows through the translucent water.
      pos[3 * i + 1] = Math.max(h, SEABED_Y);
      pos[3 * i + 2] = -size / 2 + zi * cell;
      const dx = (at(xi + 1, zi) - at(xi - 1, zi)) / (2 * cell);
      const dz = (at(xi, zi + 1) - at(xi, zi - 1)) / (2 * cell);
      baseColor(h, Math.hypot(dx, dz), pal, c);
      if (h >= 2) c.offsetHSL(0, 0, hash(i) * 0.06 - 0.03); // sRGB lightness; the seabed stays even
      col[3 * i] = c.r;
      col[3 * i + 1] = c.g;
      col[3 * i + 2] = c.b;
    }
  }
  const idx = new Uint32Array((res - 1) * (res - 1) * 6);
  let k = 0;
  for (let zi = 0; zi < res - 1; zi++) {
    for (let xi = 0; xi < res - 1; xi++) {
      const a = zi * res + xi;
      const b = a + 1;
      const d = a + res;
      const e = d + 1;
      idx.set([a, d, b, b, d, e], k); // counter-clockwise seen from above
      k += 6;
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
  geo.setAttribute("color", new THREE.BufferAttribute(col, 3));
  geo.setIndex(new THREE.BufferAttribute(idx, 1));
  geo.computeVertexNormals();
  geo.computeBoundingSphere();
  const mesh = new THREE.Mesh(geo, new THREE.MeshLambertMaterial({ vertexColors: true, flatShading: true }));
  mesh.name = "terrain";
  return mesh;
}

/** 40×40 km sea plane at Y = 0 over a flat seabed of the same size (opaque sand on the desert). */
export function buildSea(pal: Palette = PALETTES.ada): THREE.Mesh {
  const geo = new THREE.PlaneGeometry(40000, 40000, 40, 40);
  geo.rotateX(-Math.PI / 2);
  const water = pal.seaOpacity < 1; // the desert's "sea" is a matte sand plane
  const mat = new THREE.MeshPhongMaterial({
    color: pal.sea, shininess: water ? 60 : 0, specular: water ? 0x111111 : 0, transparent: water, opacity: pal.seaOpacity,
  });
  const mesh = new THREE.Mesh(geo, mat);
  mesh.name = "sea";
  // Same color and normal as the clamped terrain floor: the island's square
  // edge disappears instead of showing as dark bands through the water.
  const bed = new THREE.Mesh(
    new THREE.PlaneGeometry(40000, 40000).rotateX(-Math.PI / 2),
    new THREE.MeshLambertMaterial({ color: pal.seabed, flatShading: true }),
  );
  bed.name = "seabed";
  bed.position.y = SEABED_Y - 0.5; // just under the terrain floor (no z-fighting)
  mesh.add(bed);
  return mesh;
}
