// Game hooks → sounds.
import type { GameHooks } from "../game/events.ts";
import { threatened, type GameState } from "../game/state.ts";
import { dist, type V3 } from "../sim/vec.ts";
import type { AudioEngine } from "./audio.ts";

type Sounds = "engine" | "engineOff" | "flyby" | "lockTone" | "missileWarning" | "hurt" | "hit" | "pickup"
  | "cannon" | "missileLaunch" | "explosion" | "flare" | "evaded";

/**
 * blocked: a menu covers the game (engine and tones go quiet). The listener
 * sits at the main camera (chase, look-back, killcam, replay), so left and
 * right follow what is on screen.
 */
export function audioHooks(a: Pick<AudioEngine, Sounds>, s: GameState, blocked: () => boolean): GameHooks {
  let ear: V3 | null = null;
  const far = (at: V3) => (ear ? dist(ear, at) : 0);
  return {
    camera: (c) => {
      ear = c.pos;
      a.flyby({ pos: c.pos, vel: c.vel, fwd: c.fwd }, blocked() ? [] : c.planes);
    },
    hud: (v) => {
      const quiet = blocked();
      if (v.alive && !quiet) a.engine(v.th, v.ab, v.speed);
      else a.engineOff();
      a.lockTone(!v.alive || quiet ? "none" : v.locked ? "locked" : v.lockProgress > 0 ? "seeking" : "none");
      a.missileWarning(v.alive && threatened(s));
    },
    hurt: () => a.hurt(),
    hitConfirm: () => a.hit(),
    pickup: (_item, mine) => { if (mine) a.pickup(); },
    rearm: (mine) => { if (mine) a.pickup(); },
    decoy: (atMe) => { if (atMe) a.evaded(); },
    sound: (name, at) => {
      switch (name) {
        case "cannon": case "aa": a.cannon(far(at)); break;
        case "bomb": a.missileLaunch(far(at)); break; // release whoosh
        case "missile": a.missileLaunch(far(at)); break;
        case "explosion": a.explosion(far(at)); break;
        case "flare": a.flare(far(at)); break;
      }
    },
  };
}
