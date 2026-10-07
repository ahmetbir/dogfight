// Camera director for the game loop: picks the main view each frame (own
// chase camera, killcam, orbit around my wreck, spectator, overview, replay),
// runs the missile cam inset and reports the camera pose (audio listener).
import * as THREE from "three";
import { t } from "../i18n/index.ts";
import type { Settings } from "../input/schemes.ts";
import { ChaseCam, type Solid } from "../render/camera.ts";
import { MissileCam } from "../render/missilecam.ts";
import type { Renderer } from "../render/renderer.ts";
import type { FlightState } from "../sim/flight.ts";
import { len, v3, type V3 } from "../sim/vec.ts";
import { airframe } from "./airframe.ts";
import type { CamView, Heard } from "./events.ts";
import { camMode, othersAlive, watchingLabel, type CamMode } from "./spectate.ts";
import { ReplayView, type ReplayScene } from "./replayview.ts";
import type { GameState, ServerEvent } from "./state.ts";

const ORBIT_RATE = 0.3; // rad/s around the place I fell
const ORBIT_R = 120;    // m
const ORBIT_UP = 40;    // m above it
const ORBIT_CLEAR = 15; // m the orbit stays above the ground
const FOV = 70;

export type CamsCtx = {
  renderer: Renderer; state: GameState; settings: Settings; solids: readonly Solid[];
  ground(x: number, z: number): number; // terrain height (orbit clearance)
  spectate?(): number | null;           // the plane picked to watch while I have none
};

/** What the own view needs from this frame's controls. */
export type OwnView = { fs: FlightState | null; live: boolean; lookBack: boolean; aimDir: V3 | null };

const ZERO = v3(0, 0, 0);

export class Cams {
  private readonly c: CamsCtx;
  private readonly chase: ChaseCam;
  private readonly missile = new MissileCam();
  private readonly dir = new THREE.Vector3();
  private readonly replay: ReplayView;
  private killer = 0;
  private deathAt: V3 | null = null;
  private deathMs = 0;
  private modeKey = "";

  constructor(c: CamsCtx) {
    this.c = c;
    this.chase = new ChaseCam(c.renderer.camera, c.solids);
    this.replay = new ReplayView(c.state);
  }

  /** Snap the chase camera on the next frame (spawn). */
  snap(): void {
    this.chase.snap();
  }

  /** I respawned: the killcam ends. */
  respawned(): void {
    this.killer = 0;
    this.deathAt = null;
    this.replay.respawned();
    this.chase.snap();
  }

  /** Reconnected as a new player: forget the old life. */
  reset(): void {
    this.respawned();
    this.replay.reset();
    this.missile.stop(-Infinity);
  }

  /** A missile was launched; mine: I fired it (the missile cam follows it when enabled). */
  launched(id: number, mine: boolean, nowMs: number): void {
    if (mine && this.c.settings.missileCam) this.missile.follow(id, nowMs);
  }

  /** One snapshot's events: my death (killcam) and the followed missile's end. */
  events(evs: ServerEvent[], nowMs: number): void {
    const s = this.c.state;
    const id = this.missile.following();
    for (const e of evs) {
      if (e.k === "mgone" && e.a === id) this.missile.stop(nowMs);
      if (e.k === "kill" && e.a === s.you) {
        this.killer = e.b && e.b !== s.you ? e.b : 0;
        const me = s.planes.get(s.you);
        this.deathAt = e.p ? v3(e.p[0], e.p[1], e.p[2]) : me ? v3(me.p[0], me.p[1], me.p[2]) : null;
        this.deathMs = nowMs;
        this.replay.died(e.tick);
      }
    }
    this.replay.record();
  }

  /** R: starts the replay while I am down, or skips the one playing; true if it did either. */
  replayKey(nowMs: number): boolean {
    return this.replay.skip() || this.replay.start(nowMs);
  }

  /** Esc: skips the replay; true if one was playing. */
  skipReplay(): boolean {
    return this.replay.skip();
  }

  replaying(): boolean {
    return this.replay.playing();
  }

  /** The replay frame to draw instead of the live scene; null when none plays. */
  replayScene(nowMs: number): ReplayScene | null {
    return this.replay.scene(nowMs);
  }

  /** Places the main camera for this frame (rs: the replay frame drawn, if any) and returns where it is and what the HUD says. */
  place(dtS: number, nowMs: number, rt: number, own: OwnView, rs: ReplayScene | null): CamView {
    const cam = this.c.renderer.camera;
    if (rs) {
      this.switchTo({ kind: "replay" });
      if (rs.me) this.chase.update(dtS, rs.me.pos, rs.me.rot, len(rs.me.vel), false, null, airframe(rs.me.kind).length);
      const label = this.c.settings.scheme === "touch" ? t("replay.labelTouch", { skip: t("touch.skip") }) : t("replay.label");
      return this.view(rs.me?.vel ?? ZERO, label, rs.heard, true);
    }
    const s = this.c.state;
    const me = s.planes.get(s.you);
    const mode = camMode({
      alive: !!me?.a, dead: !!me && !me.a, killer: this.killer, spectate: this.c.spectate?.() ?? null,
      deathAt: this.deathAt ?? (me ? v3(me.p[0], me.p[1], me.p[2]) : null), aliveIds: othersAlive(s.planes.values(), s.you),
    });
    this.switchTo(mode);
    let vel = ZERO;
    let label = "";
    if (mode.kind === "own" && own.fs) {
      const { fs, live } = own;
      this.chase.update(dtS, fs.pos, fs.rot, live ? len(fs.vel) : 0, own.lookBack && live, live ? own.aimDir : null, airframe(me?.k ?? "").length);
      if (live) vel = fs.vel;
    } else if (mode.kind === "follow") {
      const t = s.interp.get(mode.id)?.sample(rt);
      if (t) {
        this.chase.update(dtS, t.pos, t.rot, len(t.vel), false, null, airframe(s.planes.get(mode.id)?.k ?? "").length); // keyboard style: rolls with the plane
        vel = t.vel;
      }
      label = watchingLabel(s.players.get(mode.id)?.name ?? `#${mode.id}`);
    } else if (mode.kind === "orbit") {
      const a = (ORBIT_RATE * (nowMs - this.deathMs)) / 1000;
      const x = mode.at.x + Math.cos(a) * ORBIT_R, z = mode.at.z + Math.sin(a) * ORBIT_R;
      cam.position.set(x, Math.max(mode.at.y + ORBIT_UP, this.c.ground(x, z) + ORBIT_CLEAR), z);
      cam.up.set(0, 1, 0);
      cam.lookAt(mode.at.x, mode.at.y, mode.at.z);
      setFov(cam, FOV);
      label = watchingLabel(t("watch.wreck"));
    } else {
      overview(cam, s.terrain?.size ?? 8000);
      setFov(cam, FOV);
    }
    return this.view(vel, label, this.heard(rt), false);
  }

  /** After the main render: the missile cam inset while it runs (and the setting is on). */
  inset(nowMs: number): void {
    const s = this.c.state;
    // Only over my own view: the killcam / spectator label sits where the inset would.
    if (!this.c.settings.missileCam || this.modeKey !== "own" || !this.missile.active(nowMs)) return;
    this.missile.update(s.missiles, (nowMs - s.snapAt) / 1000);
    this.missile.render(this.c.renderer);
  }

  private view(vel: V3, label: string, planes: Heard[], replay: boolean): CamView {
    const cam = this.c.renderer.camera;
    cam.getWorldDirection(this.dir);
    return {
      pos: v3(cam.position.x, cam.position.y, cam.position.z), vel, fwd: v3(this.dir.x, this.dir.y, this.dir.z),
      label, planes, replay, canReplay: this.replay.ready(),
    };
  }

  /** A new view (or a new plane to follow) starts without trailing in from the old one. */
  private switchTo(m: CamMode | { kind: "replay" }): void {
    const key = m.kind === "follow" ? `follow:${m.id}` : m.kind;
    if (key !== this.modeKey) this.chase.snap();
    this.modeKey = key;
  }

  /** Other live planes as drawn this frame (positional engine sound). */
  private heard(rt: number): Heard[] {
    const s = this.c.state;
    const out: Heard[] = [];
    for (const p of s.planes.values()) {
      if (p.id === s.you || !p.a) continue;
      const at = s.interp.get(p.id)?.sample(rt);
      if (at) out.push({ id: p.id, pos: at.pos, vel: at.vel, th: p.th, ab: !!p.ab });
    }
    return out;
  }
}

function setFov(cam: THREE.PerspectiveCamera, fov: number): void {
  if (Math.abs(cam.fov - fov) < 0.01) return;
  cam.fov = fov;
  cam.updateProjectionMatrix();
}

/** A wide view over the island while there is nobody to watch. */
function overview(cam: THREE.PerspectiveCamera, size: number): void {
  cam.position.set(0, size * 0.18, size * 0.45);
  cam.up.set(0, 1, 0);
  cam.lookAt(0, 0, 0);
}
