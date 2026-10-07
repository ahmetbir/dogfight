// Server events → effects, tracers and UI/audio hooks.
import type { Settings } from "../input/schemes.ts";
import type { HitZone, Item, Loadout, Weapon } from "../net/protocol.ts";
import type { Damage } from "./damage.ts";
import { v3, type V3 } from "../sim/vec.ts";
import type { ServerEvent } from "./state.ts";

/** Per-frame numbers for the HUD. */
export type HudView = {
  alive: boolean; speed: number; alt: number; hp: number; maxHP: number; th: number; ab: boolean;
  heat: number; overheated: boolean; missiles: number; flares: number; respawnS: number;
  lockProgress: number; locked: boolean; oobS: number; scheme: Settings["scheme"]; pointerLocked: boolean;
  invertY: boolean; rotateSpeed: number; // settings; my aircraft's lift-off speed (m/s)
  muzzle: number;                // m ahead of my origin where my rounds leave (my aircraft's)
  gLoad: number; gfx: boolean;           // my signed load factor; G effects setting
  protected: boolean;            // spawn protection
  lockTarget: number;            // id my lock is on (0: none)
  lockRange: number;             // my effective (IR) lock range (m): aircraft × weather; radar is ×RULES.radarRangeMul
  radars: number; loadout: Loadout; // radar missiles left (missiles: the IR ones); this sortie's loadout
  lockKind: "ir" | "radar";      // the kind my lock is for (what the missile key fires)
  damage: Damage;                // my lasting damage (damage.ts)
  fires: "ir" | "radar";         // the kind the missile key fires now: the pick, or the lock's kind without one
  picked: boolean;               // the kind is picked by the pick key (mouse, keyboard); touch picks by range
  gear: boolean; gearWanted: boolean; // gear down (actual) and as commanded
  brake: boolean; onGround: boolean;  // wheel brakes held; rolling on the wheels
  rearm: number; bombs: number;       // rearm progress 0..1; bombs left
  abHeat: number; abLocked: boolean;  // afterburner heat 0..1; locked out until it cools
  baseMode: boolean;                  // base attack room
  pos: V3; vel: V3; fwd: V3; up: V3; // my drawn state (up: my body's up axis)
  aimDir: V3 | null;             // mouse aim direction
  /** World point → CSS px on the canvas; null when behind the camera. */
  project(p: V3): { x: number; y: number } | null;
  /** A remote plane as drawn this frame; null if unknown or dead. */
  planeAt(id: number): { pos: V3; vel: V3 } | null;
  /** A remote plane where it is at the tick my next round leaves (gunsight); null if unknown or dead. */
  planeNow(id: number): { pos: V3; vel: V3 } | null;
};

/** Another plane as heard this frame (positional engine sound). */
export type Heard = { id: number; pos: V3; vel: V3; th: number; ab: boolean };

/** The main camera this frame: where it is and looks (the audio listener), what it watches. */
export type CamView = {
  pos: V3; vel: V3; fwd: V3; // vel: what the camera rides along with (Doppler)
  label: string;             // "Watching: …" while watching; "" otherwise
  planes: Heard[];           // other planes around the camera
  replay: boolean;           // the replay is playing
  canReplay: boolean;        // I am down and R would start it
};

/** UI and audio hooks; every one is optional (Task 25/26 fill them in). */
export type GameHooks = {
  hud?(v: HudView): void;
  camera?(c: CamView): void;                                  // every frame, before hud
  hurt?(dmg: number): void;                                   // I was hit
  hitConfirm?(): void;                                        // my round/missile hit someone
  zoneHit?(zone: HitZone, atMe: boolean, mine: boolean): void; // a hit struck a part (crit, engine, controls, avionics)
  kill?(victim: number, killer: number, weapon: Weapon | undefined): void;
  lockedOn?(by: number): void;                                // someone locked me
  missileLaunch?(target: number, atMe: boolean, missileId: number, mine: boolean): void; // mine: I fired it
  pickup?(item: Item | undefined, mine: boolean): void;
  notice?(msg: string): void;                                 // short HUD hint (e.g. missile without lock)
  sound?(name: SoundName, at: V3): void;
  lockLost?(): void;                                          // pointer lock lost while playing
  rearm?(mine: boolean): void;                                // a plane finished rearming
  structDown?(id: number, by: number): void;                  // base attack: structure destroyed by plane `by`
  bombDrop?(mine: boolean): void;
  /** A flare decoyed a missile: atMe, it was after me; mine, I fired it. */
  decoy?(atMe: boolean, mine: boolean): void;
};

export type SoundName = "cannon" | "explosion" | "flare" | "missile" | "bomb" | "aa";

export type FxSink = {
  sparks(at: V3): void;
  explosion(at: V3, big: boolean): void;
  /** The harmless pop of a decoyed missile at its flare. */
  puff(at: V3): void;
};

/** aa: an anti-aircraft shell (drawn orange). */
export type BulletSink = { spawn(pos: V3, vel: V3, tick: number, mine: boolean, aa?: boolean): void };

export type EventCtx = {
  you: number;
  fx: FxSink;
  bullets: BulletSink;
  hooks: GameHooks;
  /** Missiles decoyed by a flare and not yet gone (their end is a puff, not a blast); the caller keeps it across snapshots. */
  decoys?: Set<number>;
};

const vec = (a: [number, number, number] | undefined): V3 | null => (a ? v3(a[0], a[1], a[2]) : null);

/** Dispatches one snapshot's events; true when one of them respawned me. */
export function dispatchEvents(evs: ServerEvent[], c: EventCtx): boolean {
  let spawnedMe = false;
  for (const e of evs) {
    const p = vec(e.p);
    switch (e.k) {
      case "fire": { // a = shooter (0 for AA, b = the AA site); my own rounds were drawn when I fired
        const v = vec(e.v);
        if (!p || !v) break;
        if (e.w === "aa") {
          c.bullets.spawn(p, v, e.tick, false, true);
          c.hooks.sound?.("aa", p);
          break;
        }
        if (e.a === c.you) break;
        c.bullets.spawn(p, v, e.tick, false);
        c.hooks.sound?.("cannon", p);
        break;
      }
      case "hit": // a = victim, b = attacker
        if (p) c.fx.sparks(p);
        if (e.a === c.you) c.hooks.hurt?.(e.val ?? 0);
        if (e.b === c.you) c.hooks.hitConfirm?.();
        if (e.z) c.hooks.zoneHit?.(e.z, e.a === c.you, e.b === c.you);
        break;
      case "kill": // a = victim, b = killer
        if (p) {
          c.fx.explosion(p, true);
          c.hooks.sound?.("explosion", p);
        }
        c.hooks.kill?.(e.a, e.b ?? 0, e.w);
        break;
      case "lock": // a = locker, b = target
        if (e.b === c.you) c.hooks.lockedOn?.(e.a);
        break;
      case "mlaunch": // a = missile, b = target, o = shooter
        c.hooks.missileLaunch?.(e.b ?? 0, e.b === c.you, e.a, e.o === c.you);
        if (p) c.hooks.sound?.("missile", p);
        break;
      case "mgone": {
        const decoyed = !!c.decoys?.delete(e.a);
        if (p) (decoyed ? c.fx.puff(p) : c.fx.explosion(p, false));
        break;
      }
      case "flare": // drawn from the snapshot's flares; the event is the sound
        if (p) c.hooks.sound?.("flare", p);
        break;
      case "decoy": // a = missile, b = its target, o = shooter, p = the flare
        c.decoys?.add(e.a);
        c.hooks.decoy?.(e.b === c.you, e.o === c.you);
        break;
      case "pickup":
        c.hooks.pickup?.(e.item, e.a === c.you);
        break;
      case "spawn":
        if (e.a === c.you) spawnedMe = true;
        break;
      case "rearm": // a = plane
        c.hooks.rearm?.(e.a === c.you);
        break;
      case "bdrop": // a = bomb, o = owner
        c.hooks.bombDrop?.(e.o === c.you);
        if (p) c.hooks.sound?.("bomb", p);
        break;
      case "boom": // a = bomb, o = owner
        if (p) {
          c.fx.explosion(p, true);
          c.hooks.sound?.("explosion", p);
        }
        break;
      case "shit": // a = structure, b = attacker
        if (p) c.fx.sparks(p);
        if (e.b === c.you) c.hooks.hitConfirm?.();
        break;
      case "sdown": // a = structure, b = attacker
        if (p) {
          c.fx.explosion(p, true);
          c.hooks.sound?.("explosion", p);
        }
        c.hooks.structDown?.(e.a, e.b ?? 0);
        break;
    }
  }
  return spawnedMe;
}

/** Forgets decoyed missiles no longer in the snapshot (gone with their mgone, or cleared by a round reset). */
export function pruneDecoys(decoys: Set<number>, missiles: readonly { id: number }[]): void {
  if (decoys.size === 0) return;
  const live = new Set(missiles.map((m) => m.id));
  for (const id of decoys) if (!live.has(id)) decoys.delete(id);
}

/** Calls every defined hook of each set, in order. */
export function mergeHooks(...sets: GameHooks[]): GameHooks {
  const out: Record<string, (...a: unknown[]) => void> = {};
  for (const set of sets) {
    for (const [k, v] of Object.entries(set)) {
      if (typeof v !== "function") continue;
      const f = v as (...a: unknown[]) => void;
      const prev = out[k];
      out[k] = prev ? (...a) => { prev(...a); f(...a); } : f;
    }
  }
  return out as GameHooks;
}
