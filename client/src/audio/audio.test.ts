import { test } from "node:test";
import assert from "node:assert/strict";
import { falloff } from "./audio.ts";

test("distance falloff is 1/(1+d/500)", () => {
  assert.equal(falloff(0), 1);
  assert.equal(falloff(500), 0.5);
  assert.equal(falloff(-10), 1);
});

// A minimal Web Audio stand-in that counts the nodes a sound creates.
function fakeWebAudio() {
  const listeners: Record<string, () => void> = {};
  const target = { addEventListener: (k: string, f: () => void) => { listeners[k] = f; }, removeEventListener() {} };
  type P = { value: number; target: number; cancelled: boolean } & Record<string, unknown>;
  const param = (): P => {
    const p: P = {
      value: 0, target: 0, cancelled: false,
      setValueAtTime: (v: number) => { made.events++; p.target = v; },
      setTargetAtTime: (v: number) => { made.events++; p.target = v; },
      exponentialRampToValueAtTime: (v: number) => { made.events++; p.target = v; },
      cancelScheduledValues: () => { made.events++; p.cancelled = true; },
    };
    made.params.push(p);
    return p;
  };
  const node = (): unknown => new Proxy({} as Record<string | symbol, unknown>, {
    get(t, k) {
      if (k in t) return t[k];
      if (k === "connect") return (n: unknown) => n;
      if (k === "start" || k === "stop" || k === "disconnect") return () => {};
      if (k === "then") return undefined;
      return (t[k] = param());
    },
  });
  const made = { ctx: null as null | { state: string; currentTime: number }, nodes: 0, events: 0, params: [] as { target: number; cancelled: boolean }[] };
  class FakeCtx {
    state = "running";
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    listener = node();
    constructor() { made.ctx = this; }
    private mk() { made.nodes++; return node(); }
    createGain() { return this.mk(); }
    createBiquadFilter() { return this.mk(); }
    createOscillator() { return this.mk(); }
    createBufferSource() { return this.mk(); }
    createPanner() { return this.mk(); }
    createDynamicsCompressor() { return this.mk(); }
    createBuffer(_c: number, len: number, sr: number) { return { duration: len / sr, getChannelData: () => new Float32Array(len) }; }
    suspend() { this.state = "suspended"; return Promise.resolve(); }
    resume() { this.state = "running"; return Promise.resolve(); }
    close() { return Promise.resolve(); }
  }
  const g = globalThis as Record<string, unknown>;
  g.window = target;
  g.document = { ...target, hidden: false };
  g.AudioContext = FakeCtx;
  return { made, unlock: () => listeners.pointerdown() };
}

test("one-shot sounds are not scheduled while the context is not running", async () => {
  const { made, unlock } = fakeWebAudio();
  const { AudioEngine } = await import("./audio.ts");
  const a = new AudioEngine();
  unlock();
  assert.ok(made.ctx);
  let before = made.nodes;
  a.cannon();
  a.hit();
  assert.ok(made.nodes > before, "a running context plays sounds");
  made.ctx.state = "suspended"; // hidden tab: currentTime is frozen
  before = made.nodes;
  a.cannon(); a.missileLaunch(); a.explosion(10); a.hurt(); a.flare(); a.evaded(); a.hit(); a.pickup();
  assert.equal(made.nodes, before, "a suspended context must not queue sounds");
  a.dispose();
});

test("engine and flybys build their nodes once, never per frame", async () => {
  const { made, unlock } = fakeWebAudio();
  const { AudioEngine } = await import("./audio.ts");
  const a = new AudioEngine();
  unlock();
  const built = made.nodes;
  assert.ok(built > 20, "jet + three flyby voices exist after unlock");
  const o = { x: 0, y: 0, z: 0 };
  const plane = (id: number, x: number) => ({ id, pos: { x, y: 0, z: 0 }, vel: { x: -200, y: 0, z: 0 }, th: 0.8, ab: id === 2 });
  for (let f = 0; f < 120; f++) {
    a.engine(f / 120, f > 60, 250);
    a.flyby({ pos: o, vel: o, fwd: { x: 0, y: 0, z: -1 } }, [plane(1, 100), plane(2, 50), plane(3, 300), plane(4, 550), plane(5, 900)]);
  }
  a.engineOff();
  a.silence();
  assert.equal(made.nodes, built);
  a.dispose();
});

test("continuous sounds schedule nothing while the context is not running", async () => {
  const { made, unlock } = fakeWebAudio();
  const { AudioEngine } = await import("./audio.ts");
  const a = new AudioEngine();
  unlock();
  assert.ok(made.ctx);
  const o = { x: 0, y: 0, z: 0 };
  const ear = { pos: o, vel: o, fwd: { x: 0, y: 0, z: -1 } };
  const near = [{ id: 1, pos: { x: 80, y: 0, z: 0 }, vel: o, th: 1, ab: true }];
  const frame = () => { a.engine(1, true, 300); a.flyby(ear, near); };
  frame();
  assert.ok(made.events > 0, "a running context steers the engine");
  made.ctx.state = "suspended"; // frames keep coming, currentTime is frozen
  const before = made.events;
  for (let i = 0; i < 600; i++) frame();
  a.engineOff();
  assert.equal(made.events, before, "nothing piles up at the frozen time");
  made.ctx.state = "running";
  made.ctx.currentTime += 1 / 60;
  const resumed = made.events;
  frame();
  const perFrame = made.events - resumed;
  assert.ok(perFrame > 0 && perFrame < 60, `one frame's worth of targets on resume: ${perFrame}`);
  a.dispose();
});

test("silence cuts the engine and flybys even while the context is suspended", async () => {
  const { made, unlock } = fakeWebAudio();
  const { AudioEngine } = await import("./audio.ts");
  const a = new AudioEngine();
  unlock();
  assert.ok(made.ctx);
  const o = { x: 0, y: 0, z: 0 };
  const near = [1, 2, 3].map((id) => ({ id, pos: { x: 50 * id, y: 0, z: 0 }, vel: o, th: 1, ab: true }));
  for (let i = 0; i < 10; i++) {
    a.engine(1, true, 300);
    a.flyby({ pos: o, vel: o, fwd: { x: 0, y: 0, z: -1 } }, near);
  }
  made.ctx.state = "suspended"; // hidden tab, then the player leaves the game
  a.silence();
  const cut = made.params.filter((p) => p.cancelled);
  assert.ok(cut.length >= 5, `jet bus + AB + 3 voices cut at once: ${cut.length}`);
  for (const p of cut) assert.equal(p.target, 0, "cut to silence, nothing left queued to come back on resume");
  a.dispose();
});
