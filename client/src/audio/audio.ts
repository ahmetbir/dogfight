// Procedural sound with Web Audio nodes only (no audio files). The
// AudioContext is created on the first user gesture (autoplay policy) and
// suspended while the tab is hidden; every call before that is a no-op.
import { AudioShell, falloff } from "../core/audio/shell.ts";
import { Flybys, type Ear, type FlySource } from "./flyby.ts";
import { JetEngine } from "./jet.ts";
import { crackle, pinkNoise } from "./jetmath.ts";

export { falloff };

type Lock = { osc: OscillatorNode; lfoDepth: GainNode; tone: GainNode; out: GainNode };
type Warn = { out: GainNode };
export type LockState = "none" | "seeking" | "locked";

export class AudioEngine {
  private readonly shell: AudioShell;
  private jet: JetEngine | null = null;
  private flybys: Flybys | null = null;
  private lock: Lock | null = null;
  private warn: Warn | null = null;
  private lockState: LockState = "none";
  private warnOn = false;

  constructor() {
    this.shell = new AudioShell({ start: (c, master) => this.buildVoices(c, master) });
  }

  setVolume(v: number): void {
    this.shell.setVolume(v);
  }

  /** Continuous, per frame: my jet (spooling roar + whine, AB, air rush at speed m/s). */
  engine(throttle: number, ab: boolean, speed = 0): void {
    if (this.shell.live()) this.jet?.set(throttle, ab, speed);
  }

  /** Silences my engine (dead, menus). */
  engineOff(): void {
    if (this.shell.live()) this.jet?.off();
  }

  /** Per frame: positional jets of the nearest other planes heard from ear. */
  flyby(ear: Ear, planes: readonly FlySource[]): void {
    if (this.shell.live()) this.flybys?.update(ear, planes);
  }

  /** Stops every continuous sound (engines, flybys, lock tone, missile warning). */
  silence(): void {
    // Unguarded on purpose: leaving the game with a hidden tab must not let
    // the engine come back in the menu on resume. Suspended: cut at once.
    const now = !this.shell.live();
    this.jet?.off(now);
    this.flybys?.off(now);
    this.lockTone("none");
    this.missileWarning(false);
  }

  /** Short noise burst through a 1.2 kHz bandpass, 40 ms. */
  cannon(distance = 0): void {
    this.shell.burst({ type: "bandpass", f0: 1200, q: 1.2 }, 0.04, 0.35 * falloff(distance));
  }

  /** 0.8 s noise whoosh through a falling lowpass. */
  missileLaunch(distance = 0): void {
    this.shell.burst({ type: "lowpass", f0: 3500, f1: 250, q: 2 }, 0.8, 0.5 * falloff(distance), 0.05);
  }

  /** 1 kHz beeps 4/s while seeking, a steady 1.4 kHz tone when locked. */
  lockTone(state: LockState): void {
    const c = this.shell.context();
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
    const c = this.shell.context();
    if (!c || !this.warn || on === this.warnOn) return;
    this.warnOn = on;
    this.warn.out.gain.setTargetAtTime(on ? 0.08 : 0, c.currentTime, 0.01);
  }

  /** Low noise burst; volume 1/(1+d/500). */
  explosion(distance: number): void {
    this.shell.burst({ type: "lowpass", f0: 500, f1: 120, q: 0.7 }, 1.4, 0.9 * falloff(distance), 0.005);
  }

  /** My round or missile hit someone: a short high tick. */
  hit(): void {
    this.shell.tone("square", 1800, 1800, 0.05, 0.08);
  }

  /** I was hit: a low thump. */
  hurt(): void {
    this.shell.burst({ type: "lowpass", f0: 700, f1: 150, q: 1 }, 0.18, 0.5);
  }

  pickup(): void {
    this.shell.tone("sine", 600, 1300, 0.22, 0.15);
  }

  /** A flare decoyed the missile after me: a quick rising two-tone. */
  evaded(): void {
    this.shell.tone("sine", 660, 660, 0.1, 0.14);
    this.shell.tone("sine", 990, 990, 0.16, 0.14, 0.1);
  }

  flare(distance = 0): void {
    this.shell.burst({ type: "highpass", f0: 1800, q: 0.8 }, 0.35, 0.25 * falloff(distance), 0.01);
  }

  dispose(): void {
    this.shell.dispose();
  }

  /** The continuous voices, built once on the created context. */
  private buildVoices(c: AudioContext, master: GainNode): void {
    const pink = this.buffer(c, pinkNoise(c.sampleRate * 4, c.sampleRate / 4, Math.random));
    const crack = this.buffer(c, crackle(Math.round(c.sampleRate * 5.3), c.sampleRate, Math.random));
    this.jet = new JetEngine(c, master, pink, crack);
    this.flybys = new Flybys(c, master, pink);
    this.lock = this.buildLock(c, master);
    this.warn = this.buildWarn(c, master);
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

  private buffer(c: AudioContext, data: Float32Array): AudioBuffer {
    const b = c.createBuffer(1, data.length, c.sampleRate);
    b.getChannelData(0).set(data);
    return b;
  }
}
