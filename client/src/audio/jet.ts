// My own jet engine: noise roar + turbine whine + afterburner + air rush,
// built once from plain Web Audio nodes and steered per frame.
import {
  blastFreq, blastGain, roarCutoff, roarGain, spool, whineFreq, whineGain, windFreq, windGain,
} from "./jetmath.ts";

const SMOOTH = 0.08;  // s, de-zipper for per-frame targets (the spool itself is slower)
const AB_FADE = 0.1;  // s time constant: ~0.3 s to 95 %
const BUS_FADE = 0.16;
const MAX_DT = 0.25;

/** A looping buffer source started at offsetS. */
export function loopSource(c: AudioContext, buf: AudioBuffer, offsetS: number): AudioBufferSourceNode {
  const s = c.createBufferSource();
  s.buffer = buf;
  s.loop = true;
  s.start(0, offsetS);
  return s;
}

/** A biquad of the given type, frequency and Q. */
export function filter(c: AudioContext, type: BiquadFilterType, f: number, q: number): BiquadFilterNode {
  const b = c.createBiquadFilter();
  b.type = type;
  b.frequency.value = f;
  b.Q.value = q;
  return b;
}

/** Ramps p to 0 with time constant tau; tau 0: cancel queued events and set 0 now. */
export function mute(p: AudioParam, t: number, tau: number): void {
  if (tau > 0) {
    p.setTargetAtTime(0, t, tau);
    return;
  }
  p.cancelScheduledValues(t);
  p.setValueAtTime(0, t);
}

/** A gain node starting at v. */
export function gainNode(c: AudioContext, v: number): GainNode {
  const g = c.createGain();
  g.gain.value = v;
  return g;
}

export class JetEngine {
  private readonly c: AudioContext;
  private readonly bus: GainNode;
  private readonly roarLp: BiquadFilterNode;
  private readonly roar: GainNode;
  private readonly blastBp: BiquadFilterNode;
  private readonly blast: GainNode;
  private readonly whine: OscillatorNode[];
  private readonly whineG: GainNode;
  private readonly ab: GainNode;
  private readonly windBp: BiquadFilterNode;
  private readonly wind: GainNode;
  private rpm = 0;
  private last = -1; // currentTime of the previous set(); -1 after off()

  /** pink: rms-0.3 pink noise (≥ 4 s); crack: afterburner pop buffer. */
  constructor(c: AudioContext, out: AudioNode, pink: AudioBuffer, crack: AudioBuffer) {
    this.c = c;
    this.bus = gainNode(c, 0);
    this.bus.connect(out);

    // Core: pink → HP 35 Hz → (LP roar) + (BP blast) + (LP 150 Hz AB rumble).
    const core = filter(c, "highpass", 35, 0.7);
    loopSource(c, pink, 0).connect(core);
    this.roarLp = filter(c, "lowpass", roarCutoff(0), 0.6);
    this.roar = gainNode(c, roarGain(0));
    core.connect(this.roarLp).connect(this.roar).connect(this.bus);
    this.blastBp = filter(c, "bandpass", blastFreq(0), 0.9);
    this.blast = gainNode(c, blastGain(0));
    core.connect(this.blastBp).connect(this.blast).connect(this.bus);

    // Afterburner: deep rumble + popping crackle, faded in and out as one.
    this.ab = gainNode(c, 0);
    this.ab.connect(this.bus);
    core.connect(filter(c, "lowpass", 150, 1)).connect(gainNode(c, 0.9)).connect(this.ab);
    loopSource(c, crack, 0).connect(filter(c, "highpass", 700, 0.7)).connect(gainNode(c, 0.3)).connect(this.ab);

    // Turbine whine: a sine and a triangle a few cents apart (slow beating).
    this.whineG = gainNode(c, whineGain(0));
    this.whineG.connect(this.bus);
    this.whine = ([["sine", -4], ["triangle", 7]] as const).map(([type, cents]) => {
      const o = c.createOscillator();
      o.type = type;
      o.frequency.value = whineFreq(0);
      o.detune.value = cents;
      o.connect(this.whineG);
      o.start();
      return o;
    });

    // Air rush: a second, decorrelated read of the pink loop.
    this.windBp = filter(c, "bandpass", windFreq(0), 0.6);
    this.wind = gainNode(c, 0);
    loopSource(c, pink, pink.duration / 2).connect(this.windBp).connect(this.wind).connect(this.bus);
  }

  /** Per frame: throttle 0..1, afterburner, airspeed m/s. */
  set(throttle: number, ab: boolean, speed: number): void {
    const t = this.c.currentTime;
    const dt = this.last < 0 ? 0 : Math.min(MAX_DT, Math.max(0, t - this.last));
    this.last = t;
    const r = (this.rpm = spool(this.rpm, ab ? 1 : throttle, dt));
    this.roarLp.frequency.setTargetAtTime(roarCutoff(r), t, SMOOTH);
    this.roar.gain.setTargetAtTime(roarGain(r), t, SMOOTH);
    this.blastBp.frequency.setTargetAtTime(blastFreq(r), t, SMOOTH);
    this.blast.gain.setTargetAtTime(blastGain(r), t, SMOOTH);
    const f = whineFreq(r);
    for (const o of this.whine) o.frequency.setTargetAtTime(f, t, SMOOTH);
    this.whineG.gain.setTargetAtTime(whineGain(r), t, SMOOTH);
    this.windBp.frequency.setTargetAtTime(windFreq(speed), t, SMOOTH);
    this.wind.gain.setTargetAtTime(windGain(speed), t, SMOOTH);
    this.ab.gain.setTargetAtTime(ab ? 1 : 0, t, AB_FADE);
    this.bus.gain.setTargetAtTime(1, t, BUS_FADE);
  }

  /** Fades out (dead, menus); now: drop to 0 at once, cancelling anything queued
   *  (safe while suspended). The next life spools up from idle. */
  off(now = false): void {
    const t = this.c.currentTime;
    mute(this.bus.gain, t, now ? 0 : BUS_FADE);
    mute(this.ab.gain, t, now ? 0 : AB_FADE);
    this.rpm = 0;
    this.last = -1;
  }
}
