// What lies behind the HUD: a coarse luminance grid of the rendered frame, so
// the military HUD can pick its contrast per region (dark symbols with a
// strong halo over bright sky and cloud, bright ones over sea and night).
// A few times a second the frame is resolved and shrunk on the GPU and read
// back through a pixel buffer with a fence: the read never waits on the GPU.

export const GRID_W = 32;
export const GRID_H = 18;
const READ_W = 128; // the shrunken frame read back; each grid cell averages 4 × 4 of its pixels
const READ_H = 72;
const EVERY_MS = 250;

/**
 * Grid of mean luma (0..1, gamma-encoded Rec. 709 weights) from RGBA rows
 * read bottom-up (as readPixels returns them); row 0 of the grid is the top.
 */
export function lumaGrid(rgba: Uint8Array, w: number, h: number, gw = GRID_W, gh = GRID_H): Float32Array {
  const sum = new Float32Array(gw * gh);
  const n = new Float32Array(gw * gh);
  for (let y = 0; y < h; y++) {
    const gy = Math.min(gh - 1, Math.floor(((h - 1 - y) * gh) / h)); // flip: readPixels row 0 is the bottom
    for (let x = 0; x < w; x++) {
      const gx = Math.min(gw - 1, Math.floor((x * gw) / w));
      const i = (y * w + x) * 4;
      sum[gy * gw + gx] += (0.2126 * rgba[i] + 0.7152 * rgba[i + 1] + 0.0722 * rgba[i + 2]) / 255;
      n[gy * gw + gx]++;
    }
  }
  for (let i = 0; i < sum.length; i++) sum[i] = n[i] ? sum[i] / n[i] : 0;
  return sum;
}

/**
 * Backdrop luma of a region given as fractions of the screen (0..1, top-left
 * origin): the mean leaning toward the brightest cell, since a symbol is lost
 * over its brightest part.
 */
export function regionLuma(grid: Float32Array, x0: number, y0: number, x1: number, y1: number, gw = GRID_W, gh = GRID_H): number {
  const cx0 = clampI(Math.floor(Math.min(x0, x1) * gw), gw), cx1 = clampI(Math.floor(Math.max(x0, x1) * gw), gw);
  const cy0 = clampI(Math.floor(Math.min(y0, y1) * gh), gh), cy1 = clampI(Math.floor(Math.max(y0, y1) * gh), gh);
  let sum = 0, max = 0, n = 0;
  for (let y = cy0; y <= cy1; y++) {
    for (let x = cx0; x <= cx1; x++) {
      const v = grid[y * gw + x];
      sum += v;
      max = Math.max(max, v);
      n++;
    }
  }
  return n ? 0.4 * (sum / n) + 0.6 * max : 0;
}

function clampI(i: number, n: number): number {
  return Math.max(0, Math.min(n - 1, i));
}

/** Samples the default framebuffer of gl right after a frame is drawn into it. */
export class LumaProbe {
  private readonly gl: WebGL2RenderingContext;
  private resolveFb: WebGLFramebuffer | null = null;
  private resolveRb: WebGLRenderbuffer | null = null;
  private smallFb: WebGLFramebuffer | null = null;
  private pbo: WebGLBuffer | null = null;
  private fence: WebGLSync | null = null;
  private signalled = false;
  private fw = 0;
  private fh = 0;
  private last = -Infinity;
  private readonly px = new Uint8Array(READ_W * READ_H * 4);
  private grid: Float32Array | null = null;
  private broken = false;

  constructor(gl: WebGL2RenderingContext) {
    this.gl = gl;
  }

  /** The latest grid; null before the first read lands (or where reading back fails). */
  current(): Float32Array | null {
    return this.grid;
  }

  /** Call right after the frame is rendered: collects a finished read, starts the next every EVERY_MS. */
  capture(now: number): void {
    if (this.broken) return;
    const gl = this.gl;
    try {
      if (this.fence) {
        // Seen signalled in one frame, read in the next: the browser then serves the read from its copy.
        if (!this.signalled) {
          const st = gl.clientWaitSync(this.fence, 0, 0);
          if (st === gl.TIMEOUT_EXPIRED) return;
          this.signalled = true;
          return;
        }
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
        gl.getBufferSubData(gl.PIXEL_PACK_BUFFER, 0, this.px);
        gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
        gl.deleteSync(this.fence); // after the read: the browser ties its readback copy to the fence
        this.fence = null;
        this.signalled = false;
        this.grid = lumaGrid(this.px, READ_W, READ_H);
      }
      if (now - this.last < EVERY_MS) return;
      this.last = now;
      this.start();
    } catch {
      this.broken = true; // no read-back here: the HUD keeps its default contrast
      this.grid = null;
    }
  }

  private start(): void {
    const gl = this.gl;
    const w = gl.drawingBufferWidth, h = gl.drawingBufferHeight;
    if (w === 0 || h === 0) return;
    if (!this.smallFb) {
      this.smallFb = gl.createFramebuffer();
      const rb = gl.createRenderbuffer();
      gl.bindRenderbuffer(gl.RENDERBUFFER, rb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, READ_W, READ_H);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.smallFb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, rb);
      this.pbo = gl.createBuffer();
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
      gl.bufferData(gl.PIXEL_PACK_BUFFER, this.px.byteLength, gl.STREAM_READ);
      gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    }
    if (w !== this.fw || h !== this.fh) { // the multisampled frame resolves only into a buffer of its own size
      if (!this.resolveFb) {
        this.resolveFb = gl.createFramebuffer();
        this.resolveRb = gl.createRenderbuffer();
      }
      gl.bindRenderbuffer(gl.RENDERBUFFER, this.resolveRb);
      gl.renderbufferStorage(gl.RENDERBUFFER, gl.RGBA8, w, h);
      gl.bindFramebuffer(gl.FRAMEBUFFER, this.resolveFb);
      gl.framebufferRenderbuffer(gl.FRAMEBUFFER, gl.COLOR_ATTACHMENT0, gl.RENDERBUFFER, this.resolveRb);
      this.fw = w;
      this.fh = h;
    }
    gl.bindRenderbuffer(gl.RENDERBUFFER, null);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, null);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.resolveFb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, w, h, gl.COLOR_BUFFER_BIT, gl.NEAREST);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.resolveFb);
    gl.bindFramebuffer(gl.DRAW_FRAMEBUFFER, this.smallFb);
    gl.blitFramebuffer(0, 0, w, h, 0, 0, READ_W, READ_H, gl.COLOR_BUFFER_BIT, gl.LINEAR);
    gl.bindFramebuffer(gl.READ_FRAMEBUFFER, this.smallFb);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, this.pbo);
    gl.readPixels(0, 0, READ_W, READ_H, gl.RGBA, gl.UNSIGNED_BYTE, 0);
    gl.bindBuffer(gl.PIXEL_PACK_BUFFER, null);
    gl.bindFramebuffer(gl.FRAMEBUFFER, null); // three.js expects the default framebuffer bound between renders
    this.fence = gl.fenceSync(gl.SYNC_GPU_COMMANDS_COMPLETE, 0);
    gl.flush();
  }
}
