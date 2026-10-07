// In-flight HUD overlay. Gauges and text refresh at 10 Hz; the projected
// marks (reticle) move every frame.
import type { GameHooks, HudView } from "../game/events.ts";
import { enemyOnRadar } from "../game/sight.ts";
import { threatened, type GameState } from "../game/state.ts";
import { lt, t, type Key } from "../i18n/index.ts";
import { fixed } from "../i18n/format.ts";
import type { HitZone, Item, PlaneJSON, Team } from "../net/protocol.ts";
import { dist, type V3 } from "../sim/vec.ts";
import { GroundHelp } from "./coach.ts";
import { ConnHud } from "./conn.ts";
import type { LinkView } from "../net/link.ts";
import { GEffects } from "./gfx.ts";
import { h, text } from "./dom.ts";
import { Gauges } from "./hudtext.ts";
import { flareCue, FlareHud } from "./flarecue.ts";
import { CHAT_LIFE_MS, chatText } from "./chat.ts";
import { KillFeed, weaponName, whoEl, type Who } from "./killfeed.ts";
import { waitWhen } from "./pick.ts";
import { Radar, type Contact } from "./radar.ts";
import { outOfRange } from "./lockinfo.ts";
import { beamCue, incomingIR, ranges, reach, warnText } from "./loadout.ts";
import { arrowAngle, beamTurn, clockOf, relBearing, threatSource } from "./threat.ts";
import { enemyTargets, ObjectiveBar } from "./objective.ts";
import { formatDist, inCone, Reticle } from "./reticle.ts";
import { boardRows, scoreLine, type BoardView } from "./scoreboard.ts";

const TEXT_MS = 100;
const GRACE_S = 5;           // sim boundsGraceTicks / 60
const GUN_CONE = (35 * Math.PI) / 180;
const GUN_RANGE = 2000;
const TOAST_MS = 1800;
// The shield power-up was removed (FB-A 7): "shield" stays a wire Item but has no label.
const ITEM: Partial<Record<Item, Key>> = { missiles: "hud.item.missiles", repair: "hud.item.repair", turbo: "hud.item.turbo" };

/** Whether plane p is an enemy of a pilot on team mine. */
export function hostile(mine: Team, p: { tm: Team }): boolean {
  return mine === "none" || p.tm !== mine;
}

export class Hud {
  readonly el: HTMLElement;
  private readonly state: GameState;
  private readonly menuOpen: () => boolean;
  private readonly reticle = new Reticle();
  private readonly radar = new Radar();
  private readonly feed = new KillFeed();
  private readonly score = h("div", { class: "hud-score" });
  private readonly warn = h("div", { class: "hud-warn", hidden: true }, t("hud.missileWarn"));
  private readonly center = h("div", { class: "hud-center" });
  private readonly sub = h("div", { class: "hud-sub" });
  private readonly prot = h("div", { class: "hud-tag", hidden: true }, lt("hud.prot"));
  private readonly outRange = h("div", { class: "hud-range", hidden: true }, lt("hud.outRange"));
  private readonly toast = h("div", { class: "hud-toast" });
  private readonly hitMark = h("div", { class: "hud-hit" });
  private readonly arrow = h("div", { class: "hud-threat", hidden: true }, h("div", { class: "hud-threat-tip" }));
  private readonly flash = h("div", { class: "hud-flash" });
  private readonly watch = h("div", { class: "hud-watch", hidden: true }); // "Watching: …"
  private readonly gauges = new Gauges();
  private readonly flare = new FlareHud();
  private readonly objective = new ObjectiveBar();
  private readonly help = new GroundHelp();
  private readonly gfx = new GEffects();
  private readonly conn = new ConnHud();
  private lastFrame = 0;
  private lastText = 0;
  private toastUntil = 0;
  private roundRef: unknown = null;
  private roundAt = 0;
  private killedBy = "";
  private replay = false;    // the replay is playing (no death text over it)
  private canReplay = false; // down, and R would start it

  constructor(state: GameState, menuOpen: () => boolean) {
    this.state = state;
    this.menuOpen = menuOpen;
    this.el = h("div", { class: "hud" }, this.gfx.el, this.flash, this.reticle.el,
      h("div", { class: "hud-top" }, this.objective.el, this.score, this.conn.el, this.conn.banner, this.warn, this.flare.cue, this.flare.beam),
      this.radar.el, this.feed.el,
      h("div", { class: "hud-mid" }, this.center, this.sub, this.flare.note, this.outRange, this.prot, this.toast),
      this.hitMark, this.arrow, this.help.el, this.gauges.left, this.gauges.right, this.watch);
  }

  hooks(): GameHooks {
    return {
      hud: (v) => this.draw(v),
      camera: (c) => {
        text(this.watch, c.label);
        this.watch.hidden = !c.label;
        this.watch.classList.toggle("replay", c.replay);
        this.replay = c.replay;
        this.radar.el.hidden = c.replay; // live blips do not belong over recorded planes
        this.canReplay = c.canReplay;
      },
      hurt: () => restart(this.flash, "on"),
      hitConfirm: () => restart(this.hitMark, "on"),
      kill: (victim, killer, w) => {
        const v = this.who(victim);
        const k = killer && killer !== victim ? this.who(killer) : null;
        this.feed.add(v, k, w, performance.now());
        if (victim === this.state.you) {
          const weapon = w ? weaponName(w) : "?";
          this.killedBy = k ? t("hud.downedBy", { name: k.name, w: weapon }) : t("hud.died", { w: weapon });
        }
      },
      pickup: (item, mine) => {
        const label = item && ITEM[item];
        if (!mine || !label) return;
        this.toast.textContent = t(label);
        this.toastUntil = performance.now() + TOAST_MS;
      },
      decoy: (atMe, mine) => this.flare.decoy(atMe, mine, performance.now()),
      zoneHit: (zone, atMe, mine) => {
        const msg = zoneNotice(zone, atMe, mine);
        if (!msg) return;
        this.toast.textContent = msg;
        this.toastUntil = performance.now() + TOAST_MS;
      },
      notice: (msg) => {
        this.toast.textContent = msg;
        this.toastUntil = performance.now() + TOAST_MS;
      },
    };
  }

  /** The connection indicator and banner; null while reconnecting. */
  link(v: LinkView | null): void {
    this.conn.update(v);
  }

  /** A quick chat line from plane `from` in the kill feed; unknown presets are ignored. */
  chat(from: number, id: number): void {
    const msg = chatText(id); // the preset in my language
    if (!msg) return;
    this.feed.addLine(h("div", { class: "kf-line chat" }, whoEl(this.who(from)), ": ", msg), performance.now(), CHAT_LIFE_MS);
  }

  /** No plane yet (joined, pick pending): hide the flight widgets and say why; touch names its plane button. */
  waiting(on: boolean, left: number, touch = false): void {
    this.el.classList.toggle("waiting", on);
    if (!on) return;
    text(this.score, scoreLine(this.board(), this.roundLeft()));
    this.objective.update(this.state.round, this.state.mode, this.state.players.get(this.state.you)?.team ?? "none");
    text(this.center, t("hud.waitPick"));
    const others = [...this.state.planes.values()].some((p) => p.a && p.id !== this.state.you);
    const watch = others ? t("hud.waitWatch", { key: t(touch ? "hud.tap" : "hud.clickArrows") }) : "";
    text(this.sub, t("hud.waitSub", { key: touch ? t("touch.pick") : "P", when: waitWhen(left) }) + watch);
  }

  /** Board data shared with the scoreboard and round-end screens. */
  board(): BoardView {
    const s = this.state;
    const r = s.round;
    return { mode: s.mode, rows: boardRows(s.players.values(), r?.board ?? [], s.you), nato: r?.nato ?? 0, soviet: r?.soviet ?? 0 };
  }

  /** Seconds left in the current phase, counted down locally between round messages. */
  roundLeft(now = performance.now()): number {
    const r = this.state.round;
    if (!r) return 0;
    if (r !== this.roundRef) {
      this.roundRef = r;
      this.roundAt = now;
    }
    return Math.max(0, r.left / 60 - (now - this.roundAt) / 1000);
  }

  private who(id: number): Who {
    const p = this.state.players.get(id);
    return { name: p?.name ?? `#${id}`, team: p?.team ?? "none", me: id === this.state.you };
  }

  private draw(v: HudView): void {
    const s = this.state;
    const myTeam = s.players.get(s.you)?.team ?? "none";
    const lockPlane = v.lockTarget ? v.planeAt(v.lockTarget) : null;
    // The box frames the drawn plane; the lead uses where it is now.
    this.reticle.update({
      alive: v.alive, pos: v.pos, vel: v.vel, fwd: v.fwd, aimDir: v.aimDir, project: v.project,
      lock: lockPlane && v.lockProgress > 0
        ? {
          pos: lockPlane.pos, progress: v.lockProgress, locked: v.locked, dist: dist(lockPlane.pos, v.pos), kind: v.lockKind,
          range: v.lockKind === "radar" ? ranges(v.lockRange).radar : v.lockRange,
        }
        : null,
      lead: (v.lockTarget ? v.planeNow(v.lockTarget) : null) ?? this.gunTarget(v, myTeam),
    });
    const now = performance.now();
    this.gfx.update(v.gLoad, this.lastFrame ? (now - this.lastFrame) / 1000 : 0, v.gfx && v.alive);
    this.lastFrame = now;
    if (now - this.lastText < TEXT_MS) return;
    this.lastText = now;
    this.gauges.update(v);
    this.help.update(v);
    text(this.score, scoreLine(this.board(), this.roundLeft(now)));
    this.objective.update(s.round, s.mode, myTeam);
    this.threat(v, now);
    // No missiles: the sim does not lock at all, so "close in" would mislead. Radar aboard: its longer range counts.
    const far = reach(v.lockRange, v.missiles, v.radars);
    this.outRange.hidden = !v.alive || v.oobS > 0 || v.lockProgress > 0 || far <= 0 || !outOfRange(v.pos, v.fwd, this.enemies(v, myTeam), far);
    this.prot.hidden = !v.alive || !v.protected;
    this.messages(v, now);
    this.feed.update(now);
    this.radar.draw(v.pos, v.fwd, this.contacts(v, myTeam));
  }

  /**
   * The missile warning with the kind, distance and clock position of the
   * nearest missile tracking me (or of a plane locked on me before it fires),
   * an arrow toward it round the reticle; under the warning FLARE! against an
   * IR missile, the beam cue with the way to turn against radar.
   */
  private threat(v: HudView, now: number): void {
    const s = this.state;
    this.warn.hidden = !v.alive || !threatened(s);
    const ir = this.warn.hidden ? null : incomingIR(v.pos, s.missiles, s.you);
    const me = s.planes.get(s.you);
    const beam = !this.warn.hidden && beamCue(v.alive, s.missiles, s.you);
    const radar = beam ? threatSource(v.pos, s.you, s.missiles, [], "radar") : null;
    const turn = radar ? beamTurn(relBearing(v.pos, v.fwd, radar.pos)) : null;
    this.flare.update(flareCue(v.alive, ir, me?.fl ?? 0, s.tick, s.myFlareTick), v.scheme, this.el.parentElement, now, beam, turn,
      radar?.beam ?? 0); // null while the warning is off
    const src = this.warn.hidden ? null : threatSource(v.pos, s.you, s.missiles, s.planes.values());
    this.arrow.hidden = !src;
    if (!src) return;
    this.arrow.classList.toggle("lock", src.kind === "lock");
    this.arrow.style.transform = `rotate(${arrowAngle(v.pos, v.fwd, v.up, src.pos)}rad)`;
    text(this.warn, warnText(src, formatDist, clockOf(relBearing(v.pos, v.fwd, src.pos))));
  }

  /** Live enemy planes where they are drawn. */
  private enemies(v: HudView, myTeam: Team): V3[] {
    const out: V3[] = [];
    for (const p of this.state.planes.values()) {
      if (p.id === this.state.you || !p.a || p.gd || !hostile(myTeam, p)) continue; // no locks on wheels
      const b = v.planeAt(p.id);
      if (b) out.push(b.pos);
    }
    return out;
  }

  private messages(v: HudView, now: number): void {
    let main = "";
    let sub = "";
    if (this.replay) {
      // the bottom label says it all
    } else if (!v.alive) {
      const touch = v.scheme === "touch";
      main = this.killedBy || t("hud.downed");
      sub = t("hud.respawn", { s: t("unit.sec", { n: fixed(Math.max(0, v.respawnS), 1) }), key: touch ? t("touch.pick") : "P" }) +
        (this.canReplay ? t("hud.replayHint", { key: touch ? t("touch.replay") : "R" }) : "");
    } else {
      this.killedBy = "";
      if (v.oobS > 0) {
        const left = Math.ceil(GRACE_S - v.oobS);
        main = left > 0 ? t("hud.oob", { n: left }) : t("hud.oobNow");
      } else if (v.scheme === "mouse" && !v.pointerLocked && !this.menuOpen()) {
        sub = t("hud.clickAim");
      }
    }
    text(this.center, main);
    this.center.classList.toggle("alert", v.alive && v.oobS > 0);
    text(this.sub, sub);
    if (now > this.toastUntil) text(this.toast, "");
  }

  /** Nearest enemy ahead within gun range, for the lead circle when not locking. */
  private gunTarget(v: HudView, myTeam: Team): { pos: V3; vel: V3 } | null {
    if (!v.alive) return null;
    let best: { pos: V3; vel: V3 } | null = null;
    let bestD = GUN_RANGE;
    for (const p of this.state.planes.values()) {
      if (p.id === this.state.you || !p.a || !hostile(myTeam, p)) continue;
      const b = v.planeNow(p.id);
      if (!b || !inCone(v.pos, v.fwd, b.pos, GUN_CONE)) continue;
      const d = dist(b.pos, v.pos);
      if (d < bestD) {
        bestD = d;
        best = b;
      }
    }
    return best;
  }

  private contacts(v: HudView, myTeam: Team): Contact[] {
    const s = this.state;
    const out: Contact[] = [];
    const spots = s.terrain?.spots ?? [];
    for (const u of s.powerups) {
      const p = spots[u.s];
      if (u.a && p) out.push({ pos: { x: p[0], y: p[1], z: p[2] }, kind: "powerup" });
    }
    for (const p of s.planes.values() as Iterable<PlaneJSON>) {
      if (p.id === s.you || !p.a) continue;
      const pos = v.planeAt(p.id)?.pos ?? { x: p.p[0], y: p.p[1], z: p.p[2] };
      const enemy = hostile(myTeam, p);
      if (enemy && !enemyOnRadar(v.pos, pos)) continue; // friends always show
      out.push({ pos, kind: enemy ? "enemy" : "friend" });
    }
    for (const m of s.missiles) out.push({ pos: { x: m.p[0], y: m.p[1], z: m.p[2] }, kind: m.tg === s.you ? "incoming" : "missile" });
    if (s.mode === "base") for (const pos of enemyTargets(s.map?.structs ?? [], s.structs, myTeam)) out.push({ pos, kind: "target" });
    return out;
  }
}

/** The toast for a zone hit: my damaged part, or my critical hit on someone; null otherwise (my own crit downs me: the death text says it). */
export function zoneNotice(zone: HitZone, atMe: boolean, mine: boolean): string | null {
  if (atMe) return zone === "crit" ? null : t(`dmg.${zone}`);
  if (mine && zone === "crit") return t("dmg.critMine");
  return null;
}

/** Restarts a CSS animation by toggling cls. */
function restart(e: HTMLElement, cls: string): void {
  e.classList.remove(cls);
  void e.offsetWidth;
  e.classList.add(cls);
}
