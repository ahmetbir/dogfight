import * as THREE from "three";
import type { V3 } from "../sim/vec.ts";
import { LumaProbe } from "./luma.ts";

/** Owns the WebGL renderer, the scene and the main camera. */
export class Renderer {
  readonly scene = new THREE.Scene();
  readonly camera = new THREE.PerspectiveCamera(70, 1, 1, 20000);
  private readonly gl: THREE.WebGLRenderer;
  readonly canvas: HTMLCanvasElement;
  private w = 0;
  private h = 0;
  private readonly tmp = new THREE.Vector3();
  private probe: LumaProbe | null = null;

  /** perf: performance mode, pixel ratio 1. */
  constructor(canvas: HTMLCanvasElement, perf = false) {
    this.canvas = canvas;
    this.gl = new THREE.WebGLRenderer({ canvas, antialias: true });
    this.gl.toneMapping = THREE.ACESFilmicToneMapping;
    this.setPerf(perf);
  }

  /** Pixel ratio 1 in performance mode, else the device's up to 2; applied on the next render. */
  setPerf(perf: boolean): void {
    this.gl.setPixelRatio(perf ? 1 : Math.min(window.devicePixelRatio, 2));
    this.w = 0; // render() sizes the drawing buffer again
  }

  /** Draws one frame, resizing to the canvas' client size when it changed. */
  render(): void {
    const w = this.canvas.clientWidth;
    const h = this.canvas.clientHeight;
    if (w !== this.w || h !== this.h) {
      this.w = w;
      this.h = h;
      this.gl.setSize(w, h, false);
      this.camera.aspect = w / Math.max(h, 1);
      this.camera.updateProjectionMatrix();
    }
    this.gl.render(this.scene, this.camera);
  }

  /** The canvas size in CSS px as of the last render. */
  size(): { w: number; h: number } {
    return { w: this.w, h: this.h };
  }

  /**
   * Draws the scene from cam into rect (CSS px, bottom-left origin) over the
   * frame already rendered, then restores the full-canvas viewport.
   */
  renderInset(cam: THREE.PerspectiveCamera, rect: { x: number; y: number; w: number; h: number }): void {
    if (this.w === 0 || rect.w <= 0 || rect.h <= 0) return;
    if (Math.abs(cam.aspect - rect.w / rect.h) > 1e-6) {
      cam.aspect = rect.w / rect.h;
      cam.updateProjectionMatrix();
    }
    const g = this.gl;
    g.setScissorTest(true);
    g.setScissor(rect.x, rect.y, rect.w, rect.h);
    g.setViewport(rect.x, rect.y, rect.w, rect.h);
    g.render(this.scene, cam);
    g.setViewport(0, 0, this.w, this.h);
    g.setScissorTest(false);
  }

  /**
   * The luma grid of what was drawn (render/luma.ts), sampled a few times a
   * second without waiting on the GPU; call after the frame is rendered.
   * null until the first read lands.
   */
  backdrop(now: number): Float32Array | null {
    this.probe ??= new LumaProbe(this.gl.getContext() as WebGL2RenderingContext);
    this.probe.capture(now);
    return this.probe.current();
  }

  /** World point → CSS px on the canvas as of the last render; null when behind the camera. */
  project(p: V3): { x: number; y: number } | null {
    const v = this.tmp.set(p.x, p.y, p.z).applyMatrix4(this.camera.matrixWorldInverse);
    if (v.z > -this.camera.near) return null;
    v.applyMatrix4(this.camera.projectionMatrix);
    return { x: ((v.x + 1) / 2) * this.w, y: ((1 - v.y) / 2) * this.h };
  }

  /** Draw statistics of the last frame (draw calls, triangles). */
  info(): THREE.WebGLInfo["render"] {
    return this.gl.info.render;
  }
}
