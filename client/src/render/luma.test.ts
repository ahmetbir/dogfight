import { test } from "node:test";
import assert from "node:assert/strict";
import { Backdrop, GRID_H, GRID_W, lumaGrid, LumaProbe, regionLuma } from "./luma.ts";

const near = (a: number, b: number, eps = 1e-6) => assert.ok(Math.abs(a - b) <= eps, `${a} ≉ ${b}`);

/** w × h RGBA rows as readPixels returns them (row 0 = bottom); rowLuma(y) is the grey of row y. */
function frame(w: number, h: number, rowLuma: (y: number) => number): Uint8Array {
  const px = new Uint8Array(w * h * 4);
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) px.fill(Math.round(rowLuma(y) * 255), (y * w + x) * 4, (y * w + x) * 4 + 3);
  }
  return px;
}

test("lumaGrid flips readPixels' bottom-up rows: a bright top of the image is grid row 0", () => {
  // image top half bright = readPixels rows 2..3 of 4
  const g = lumaGrid(frame(4, 4, (y) => (y >= 2 ? 1 : 0)), 4, 4, 2, 2);
  near(g[0], 1); near(g[1], 1); // grid row 0 (top)
  near(g[2], 0); near(g[3], 0); // grid row 1 (bottom)
});

test("lumaGrid: Rec. 709 weights, columns left to right, empty-safe", () => {
  const px = new Uint8Array(2 * 1 * 4);
  px.set([255, 0, 0, 255, 0, 255, 0, 255]);
  const g = lumaGrid(px, 2, 1, 2, 1);
  near(g[0], 0.2126); near(g[1], 0.7152);
  assert.equal(lumaGrid(new Uint8Array(0), 0, 0, 2, 2).every((v) => v === 0), true);
  assert.equal(lumaGrid(frame(8, 8, () => 0.5), 8, 8).length, GRID_W * GRID_H);
});

test("regionLuma leans toward the brightest cell and takes corners in any order", () => {
  const grid = new Float32Array(GRID_W * GRID_H);
  grid[0] = 1; // top-left cell
  const whole = regionLuma(grid, 0, 0, 1, 1);
  near(whole, 0.4 * (1 / grid.length) + 0.6);
  near(regionLuma(grid, 1, 1, 0, 0), whole);
  near(regionLuma(grid, 0.5, 0.5, 0.9, 0.9), 0, 1e-9);
  near(regionLuma(grid, -3, -3, -2, -2), 1, 1e-9); // off screen clamps to the nearest cell (top-left)
  near(regionLuma(new Float32Array(GRID_W * GRID_H).fill(0.5), 0.2, 0.2, 0.4, 0.4), 0.5);
});

/** A GL stand-in: every call is recorded, every create* gives a distinct object. */
function fakeGl(lost = () => false) {
  const calls: string[] = [];
  const gl = new Proxy({} as Record<string, unknown>, {
    get(_, k: string) {
      if (k === "drawingBufferWidth") return 640;
      if (k === "drawingBufferHeight") return 360;
      if (k === "isContextLost") return lost;
      if (k === "clientWaitSync") return () => 0;
      if (/^[A-Z_0-9]+$/.test(k)) return k;
      return (...a: unknown[]) => {
        calls.push(k);
        return k.startsWith("create") || k === "fenceSync" ? { made: k, n: calls.length, a } : undefined;
      };
    },
  });
  return { gl: gl as unknown as WebGL2RenderingContext, calls };
}

test("LumaProbe.dispose frees every GPU object, the full-size resolve buffer included", () => {
  const { gl, calls } = fakeGl();
  const probe = new LumaProbe(gl);
  probe.capture(0);
  assert.equal(calls.filter((c) => c === "createRenderbuffer").length, 2, "small + resolve");
  probe.dispose();
  assert.equal(calls.filter((c) => c === "deleteRenderbuffer").length, 2);
  assert.equal(calls.filter((c) => c === "deleteFramebuffer").length, 2);
  assert.equal(calls.filter((c) => c === "deleteBuffer").length, 1);
  assert.equal(calls.filter((c) => c === "deleteSync").length, 1, "the outstanding fence");
  assert.equal(probe.current(), null);
});

test("LumaProbe leaves a lost context alone", () => {
  let lost = true;
  const { gl, calls } = fakeGl(() => lost);
  const probe = new LumaProbe(gl);
  probe.capture(0);
  probe.dispose();
  assert.equal(calls.length, 0);
  lost = false;
  probe.capture(1000); // the same probe may still be used once restored; Backdrop.forget() is what drops it
  assert.ok(calls.includes("createRenderbuffer"));
});

test("Backdrop: Classic never touches GL; leaving Military frees; a lost context drops the probe", () => {
  const { gl, calls } = fakeGl();
  let opened = 0;
  const b = new Backdrop(() => (opened++, gl));
  assert.equal(b.sample(0, false), null);
  assert.equal(opened, 0, "off from the start: no probe, no context access");
  assert.equal(calls.length, 0);

  b.sample(0, true);
  assert.equal(opened, 1);
  b.sample(300, true);
  assert.equal(opened, 1, "one probe while on");
  assert.equal(b.sample(600, false), null);
  assert.ok(calls.includes("deleteRenderbuffer"), "released on leaving Military");
  const frees = calls.filter((c) => c.startsWith("delete")).length;
  b.sample(900, false);
  assert.equal(calls.filter((c) => c.startsWith("delete")).length, frees, "off again: nothing more to free");

  b.sample(1200, true);
  assert.equal(opened, 2);
  b.forget(); // context lost / restored
  b.sample(1500, true);
  assert.equal(opened, 3, "a fresh probe for the new context");
});
