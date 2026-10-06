// Procedural sound with Web Audio nodes only (no audio files). The
// AudioContext is created on the first user gesture (autoplay policy) and
// suspended while the tab is hidden; every call before that is a no-op.
import { Flybys, type Ear, type FlySource } from "./flyby.ts";
import { JetEngine } from "./jet.ts";
import { crackle, pinkNoise } from "./jetmath.ts";

type Lock = { osc: OscillatorNode; lfoDepth: GainNode; tone: GainNode; out: GainNode };
type Warn = { out: GainNode };
export type LockState = "none" | "seeking" | "locked";

// The compressor adds automatic makeup gain: +4.33 dB below threshold for the
// limiter settings below (measured in Chromium with an OfflineAudioContext).
// Undo it so the mix keeps its pre-limiter loudness.
const LIMITER_TRIM = 10 ** (-4.33 / 20);
const SMOOTH = 0.08; // s, setTargetAtTime time constant

/** Gain for a sound d meters away. */
export function falloff(d: number): number {
  return 1 / (1 + Math.max(0, d) / 500);
}

export class AudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private noise: AudioBuffer | null = null;
  private jet: JetEngine | null = null;
  private flybys: Flybys | null = null;
  private lock: Lock | null = null;
  private warn: Warn | null = null;
  private lockState: LockState = "none";
  private warnOn = false;
  private vol = 0.8;
  private readonly off: (() => void)[] = [];

  constructor() {
    const unlock = () => this.start();
    const vis = () => {
      if (!this.ctx) return;
      void (document.hidden ? this.ctx.suspend() : this.ctx.resume()).catch(() => {});
    };
    window.addEventListener("pointerdown", unlock);
    window.addEventListener("keydown", unlock);
    document.addEventListener("visibilitychange", vis);
    this.off.push(
      () => window.removeEventListener("pointerdown", unlock),
      () => window.removeEventListener("keydown", unlock),
      () => document.removeEventListener("visibilitychange", vis),
    );
  }

  setVolume(v: number): void {
    this.vol = Math.max(0, Math.min(1, v));
    if (this.ctx && this.master) this.master.gain.setTargetAtTime(this.vol, this.ctx.currentTime, SMOOTH);
  }

  /** Continuous, per frame: my jet (spooling roar + whine, AB, air rush at speed m/s). */
  engine(throttle: number, ab: boolean, speed = 0): void {
    if (this.live()) this.jet?.set(throttle, ab, speed);
  }

  /** Silences my engine (dead, menus). */
  engineOff(): void {
    if (this.live()) this.jet?.off();
  }

  /** Per frame: positional jets of the nearest other planes heard from ear. */
  flyby(ear: Ear, planes: readonly FlySource[]): void {
    if (this.live()) this.flybys?.update(ear, planes);
  }

  /** Stops every continuous sound (engines, flybys, lock tone, missile warning). */
  silence(): void {
    // Unguarded on purpose: leaving the game with a hidden tab must not let
    // the engine come back in the menu on resume. Suspended: cut at once.
    const now = !this.live();
    this.jet?.off(now);
    this.flybys?.off(now);
    this.lockTone("none");
    this.missileWarning(false);
  }

  /** Short noise burst through a 1.2 kHz bandpass, 40 ms. */
  cannon(distance = 0): void {
    this.burst({ type: "bandpass", f0: 1200, q: 1.2 }, 0.04, 0.35 * falloff(distance));
  }

  /** 0.8 s noise whoosh through a falling lowpass. */
  missileLaunch(distance = 0): void {
    this.burst({ type: "lowpass", f0: 3500, f1: 250, q: 2 }, 0.8, 0.5 * falloff(distance), 0.05);
  }

  /** 1 kHz beeps 4/s while seeking, a steady 1.4 kHz tone when locked. */
  lockTone(state: LockState): void {
    const c = this.ctx;
    const l = this.lock;
    if (!c || !l || state === this.lockState) return;
    this.lockState = state;
    const t = c.currentTime;
    l.osc.frequency.setValueAtTime(state === "locked" ? 1400 : 1000, t);
    // tone gain = base + square LFO * depth: 0/1 pulses while seeking, constant 1 when locked.
    l.lfoDepth.gain.setValueAtTime(state === "seeking" ? 0.5 : 0, t);
    l.tone.gain.setValueAtTime(state === "seeking" ? 0.5 : 1, t);
    l.out.gain.setTargetAtTime(state === "none" ? 0 : 0.07, t, 0.01);
  }

  /** Alternating 800/1200 Hz while a missile is after me. */
  missileWarning(on: boolean): void {
    if (!this.ctx || !this.warn || on === this.warnOn) return;
    this.warnOn = on;
    this.warn.out.gain.setTargetAtTime(on ? 0.08 : 0, this.ctx.currentTime, 0.01);
  }

  /** Low noise burst; volume 1/(1+d/500). */
  explosion(distance: number): void {
    this.burst({ type: "lowpass", f0: 500, f1: 120, q: 0.7 }, 1.4, 0.9 * falloff(distance), 0.005);
  }

  /** My round or missile hit someone: a short high tick. */
  hit(): void {
    this.tone("square", 1800, 1800, 0.05, 0.08);
  }

  /** I was hit: a low thump. */
  hurt(): void {
    this.burst({ type: "lowpass", f0: 700, f1: 150, q: 1 }, 0.18, 0.5);
  }

  pickup(): void {
    this.tone("sine", 600, 1300, 0.22, 0.15);
  }

  /** A flare decoyed the missile after me: a quick rising two-tone. */
  evaded(): void {
    this.tone("sine", 660, 660, 0.1, 0.14);
    this.tone("sine", 990, 990, 0.16, 0.14, 0.1);
  }

  flare(distance = 0): void {
    this.burst({ type: "highpass", f0: 1800, q: 0.8 }, 0.35, 0.25 * falloff(distance), 0.01);
  }

  dispose(): void {
    for (const f of this.off) f();
    this.off.length = 0;
    void this.ctx?.close().catch(() => {});
    this.ctx = null;
  }

  private start(): void {
    if (this.ctx) {
      if (this.ctx.state === "suspended" && !document.hidden) void this.ctx.resume().catch(() => {});
      return;
    }
    let c: AudioContext;
    try {
      c = new AudioContext();
    } catch {
      return; // no Web Audio: stay silent
    }
    this.ctx = c;
    this.master = c.createGain();
    this.master.gain.value = this.vol;
    const trim = c.createGain();
    trim.gain.value = LIMITER_TRIM;
    this.master.connect(this.limiter(c)).connect(trim).connect(c.destination);
    const n = c.createBuffer(1, c.sampleRate * 2, c.sampleRate);
    const d = n.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    this.noise = n;
    const pink = this.buffer(c, pinkNoise(c.sampleRate * 4, c.sampleRate / 4, Math.random));
    const crack = this.buffer(c, crackle(Math.round(c.sampleRate * 5.3), c.sampleRate, Math.random));
    this.jet = new JetEngine(c, this.master, pink, crack);
    this.flybys = new Flybys(c, this.master, pink);
    this.lock = this.buildLock(c, this.master);
    this.warn = this.buildWarn(c, this.master);
    if (document.hidden) void c.suspend().catch(() => {});
  }

  private buildLock(c: AudioContext, out: AudioNode): Lock {
    const outG = c.createGain();
    outG.gain.value = 0;
    outG.connect(out);
    const tone = c.createGain();
    tone.gain.value = 0;
    tone.connect(outG);
    const osc = c.createOscillator();
    osc.type = "sine";
    osc.frequency.value = 1000;
    osc.connect(tone);
    osc.start();
    const lfo = c.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 4;
    const lfoDepth = c.createGain();
    lfoDepth.gain.value = 0;
    lfo.connect(lfoDepth).connect(tone.gain);
    lfo.start();
    return { osc, lfoDepth, tone, out: outG };
  }

  private buildWarn(c: AudioContext, out: AudioNode): Warn {
    const outG = c.createGain();
    outG.gain.value = 0;
    outG.connect(out);
    const osc = c.createOscillator();
    osc.type = "square";
    osc.frequency.value = 1000;
    const lfo = c.createOscillator();
    lfo.type = "square";
    lfo.frequency.value = 3; // 800 ↔ 1200 Hz, six switches a second
    const depth = c.createGain();
    depth.gain.value = 200;
    lfo.connect(depth).connect(osc.frequency);
    const soft = c.createBiquadFilter();
    soft.type = "lowpass";
    soft.frequency.value = 2500;
    osc.connect(soft).connect(outG);
    osc.start();
    lfo.start();
    return { out: outG };
  }

  /** Soft limiter (its automatic makeup gain is undone by LIMITER_TRIM): unity below ≈ −10 dBFS, so stacked flybys + AB + an explosion do not clip. */
  private limiter(c: AudioContext): DynamicsCompressorNode {
    const k = c.createDynamicsCompressor();
    k.threshold.value = -10;
    k.knee.value = 6;
    k.ratio.value = 12;
    k.attack.value = 0.003;
    k.release.value = 0.25;
    return k;
  }

  private buffer(c: AudioContext, data: Float32Array): AudioBuffer {
    const b = c.createBuffer(1, data.length, c.sampleRate);
    b.getChannelData(0).set(data);
    return b;
  }

  /** The context, only while it plays. A suspended one (hidden tab) has a
   *  frozen currentTime: every one-shot scheduled then would pile up and
   *  sound at once on return. */
  private live(): AudioContext | null {
    return this.ctx?.state === "running" ? this.ctx : null;
  }

  /** One-shot filtered noise: attack, then exponential decay over durS. */
  private burst(fl: { type: BiquadFilterType; f0: number; f1?: number; q: number }, durS: number, peak: number, attackS = 0.002): void {
    const c = this.live();
    if (!c || !this.master || !this.noise || peak < 0.003) return;
    const t = c.currentTime;
    const src = c.createBufferSource();
    src.buffer = this.noise;
    const rate = 0.8 + Math.random() * 0.4;
    src.playbackRate.value = rate;
    const filt = c.createBiquadFilter();
    filt.type = fl.type;
    filt.Q.value = fl.q;
    filt.frequency.setValueAtTime(fl.f0, t);
    if (fl.f1) filt.frequency.exponentialRampToValueAtTime(fl.f1, t + durS);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + attackS);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    src.connect(filt).connect(g).connect(this.master);
    // Random offset, but leave enough buffer for the whole sound at this rate.
    const room = Math.max(0, this.noise.duration - (durS + 0.05) * rate);
    src.start(t, Math.random() * room);
    src.stop(t + durS + 0.05);
  }

  /** One-shot oscillator sweep f0 → f1. */
  /** delayS: start this long from now. */
  private tone(type: OscillatorType, f0: number, f1: number, durS: number, peak: number, delayS = 0): void {
    const c = this.live();
    if (!c || !this.master) return;
    const t = c.currentTime + delayS;
    const o = c.createOscillator();
    o.type = type;
    o.frequency.setValueAtTime(f0, t);
    if (f1 !== f0) o.frequency.exponentialRampToValueAtTime(f1, t + durS);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(peak, t + 0.005);
    g.gain.exponentialRampToValueAtTime(0.0001, t + durS);
    o.connect(g).connect(this.master);
    o.start(t);
    o.stop(t + durS + 0.05);
  }
}
