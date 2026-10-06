// Positional jet sound for the (up to) three nearest other planes. Three
// voices are built once; each frame they are re-pointed at planes, never
// created or destroyed.
import type { V3 } from "../sim/vec.ts";
import { filter, gainNode, loopSource, mute } from "./jet.ts";
import { assign, doppler, edgeFade, listenerUp, nearest, roarCutoff, spool, whineFreq } from "./jetmath.ts";

/** A remote plane as heard this frame. */
export type FlySource = { id: number; pos: V3; vel: V3; th: number; ab: boolean };
/** Where I hear from: position, velocity and facing. */
export type Ear = { pos: V3; vel: V3; fwd: V3 };

type Voice = {
  id: number; // 0: free
  th: number; // spooled remote throttle
  src: AudioBufferSourceNode; lp: BiquadFilterNode; osc: OscillatorNode; gain: GainNode; pan: PannerNode;
};

const VOICES = 3;
const BASE = 0.4;      // voice gain before distance (panner) and edge fade
const FAST = 0.03;     // s, position / doppler / gain de-zipper
const REF_M = 60;      // panner inverse model: full level inside this distance

type Pos3 = { positionX?: AudioParam; positionY?: AudioParam; positionZ?: AudioParam; setPosition(x: number, y: number, z: number): void };

function place(n: Pos3, p: V3, t: number, tau: number): void {
  if (!n.positionX || !n.positionY || !n.positionZ) {
    n.setPosition(p.x, p.y, p.z);
    return;
  }
  const set = (a: AudioParam, v: number) => (tau > 0 ? a.setTargetAtTime(v, t, tau) : a.setValueAtTime(v, t));
  set(n.positionX, p.x);
  set(n.positionY, p.y);
  set(n.positionZ, p.z);
}

export class Flybys {
  private readonly c: AudioContext;
  private readonly voices: Voice[] = [];
  private last = -1;

  constructor(c: AudioContext, out: AudioNode, pink: AudioBuffer) {
    this.c = c;
    for (let i = 0; i < VOICES; i++) {
      const pan = c.createPanner();
      pan.panningModel = "HRTF";
      pan.distanceModel = "inverse";
      pan.refDistance = REF_M;
      pan.maxDistance = 10000;
      pan.rolloffFactor = 1;
      pan.connect(out);
      const gain = gainNode(c, 0);
      gain.connect(pan);
      const src = loopSource(c, pink, (pink.duration * (i + 1)) / (VOICES + 2));
      const lp = filter(c, "lowpass", roarCutoff(0.7), 0.6);
      src.connect(lp).connect(gain);
      const osc = c.createOscillator();
      osc.type = "sine";
      osc.frequency.value = whineFreq(0.7);
      osc.connect(gainNode(c, 0.05)).connect(gain);
      osc.start();
      this.voices.push({ id: 0, th: 0, src, lp, osc, gain, pan });
    }
  }

  /** Per frame: point the voices at the nearest planes around ear. */
  update(ear: Ear, sources: readonly FlySource[]): void {
    const t = this.c.currentTime;
    const dt = this.last < 0 ? 0 : Math.min(0.25, Math.max(0, t - this.last));
    this.last = t;
    this.listen(ear, t);
    const picks = nearest(ear.pos, sources, VOICES);
    const ids = assign(this.voices.map((v) => v.id), picks.map((p) => p.id));
    this.voices.forEach((v, i) => {
      const p = picks.find((x) => x.id === ids[i]);
      if (!p) {
        v.id = 0;
        v.gain.gain.setTargetAtTime(0, t, FAST);
        return;
      }
      if (v.id !== p.id) { // re-pointed: jump there from silence, not the last plane's level
        v.id = p.id;
        v.th = p.ab ? 1 : p.th;
        v.gain.gain.setValueAtTime(0, t);
        place(v.pan, p.pos, t, 0);
      }
      this.steer(v, p, ear, t, dt);
    });
  }

  /** Fades every voice out; now: silent at once (safe while suspended). */
  off(now = false): void {
    const t = this.c.currentTime;
    this.last = -1;
    for (const v of this.voices) {
      v.id = 0;
      mute(v.gain.gain, t, now ? 0 : FAST);
    }
  }

  private steer(v: Voice, p: FlySource, ear: Ear, t: number, dt: number): void {
    const d = Math.hypot(p.pos.x - ear.pos.x, p.pos.y - ear.pos.y, p.pos.z - ear.pos.z);
    const th = (v.th = spool(v.th, p.ab ? 1 : p.th, dt));
    const g = BASE * (0.45 + 0.55 * th) * (p.ab ? 1.4 : 1) * edgeFade(d);
    const shift = doppler(p.pos, p.vel, ear.pos, ear.vel);
    place(v.pan, p.pos, t, FAST);
    v.gain.gain.setTargetAtTime(g, t, FAST);
    v.src.playbackRate.setTargetAtTime(shift, t, FAST);
    v.osc.frequency.setTargetAtTime(whineFreq(th) * shift, t, FAST);
    v.lp.frequency.setTargetAtTime(roarCutoff(th), t, FAST);
  }

  private listen(ear: Ear, t: number): void {
    const l = this.c.listener;
    const u = listenerUp(ear.fwd);
    place(l, ear.pos, t, FAST);
    if (l.forwardX && l.forwardY && l.forwardZ && l.upX && l.upY && l.upZ) {
      l.forwardX.setTargetAtTime(ear.fwd.x, t, FAST);
      l.forwardY.setTargetAtTime(ear.fwd.y, t, FAST);
      l.forwardZ.setTargetAtTime(ear.fwd.z, t, FAST);
      l.upX.setTargetAtTime(u.x, t, FAST);
      l.upY.setTargetAtTime(u.y, t, FAST);
      l.upZ.setTargetAtTime(u.z, t, FAST);
    } else {
      l.setOrientation(ear.fwd.x, ear.fwd.y, ear.fwd.z, u.x, u.y, u.z);
    }
  }
}
