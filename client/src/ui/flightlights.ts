// HUD lights under the left panel: gear, brake (wheel or parking brake),
// bombs n (base attack) and the rearm progress bar.
import type { HudView } from "../game/events.ts";
import { lt, t } from "../i18n/index.ts";
import { pct } from "../i18n/format.ts";
import { h, text } from "./dom.ts";

/** Gear light: on when down as wanted, off when up as wanted, blink while they differ. */
export function gearLight(gear: boolean, wanted: boolean): "on" | "off" | "blink" {
  if (gear !== wanted) return "blink";
  return gear ? "on" : "off";
}

/** "" when not rearming, else "İKMAL %NN" / "REARM NN%". */
export function rearmText(rr: number): string {
  return rr > 0 ? t("lamp.rearm", { p: pct(Math.min(1, rr)) }) : "";
}

/**
 * The runway-spawn parking brake as the server applies it (internal/sim
 * parkingBrake): set when a life starts on the wheels, released for the rest
 * of that life by the first throttle or afterburner command or by leaving
 * the ground. Like the server's ParkGraceTicks, thrust in the first 0.5 s of
 * the life (the last life's throttle, before the scheme reset) is ignored.
 */
export class ParkBrake {
  static readonly GRACE = 5; // updates at 10 Hz
  private wasAlive = false;
  private parked = false;
  private age = 0;

  update(alive: boolean, onGround: boolean, th: number, ab: boolean): boolean {
    if (alive && !this.wasAlive) {
      this.parked = onGround;
      this.age = 0;
    }
    this.wasAlive = alive;
    this.age++;
    if (!alive || !onGround || ((th > 0 || ab) && this.age > ParkBrake.GRACE)) this.parked = false;
    return this.parked;
  }
}

export class FlightLights {
  readonly el: HTMLElement;
  private readonly gear = h("span", { class: "lamp gear" }, lt("lamp.gear"));
  private readonly brake = h("span", { class: "lamp brake" }, lt("lamp.brake"));
  private readonly bombs = h("span", { class: "lamp bombs", hidden: true });
  private readonly rearmFill = h("div", { class: "bar-fill" });
  private readonly rearmLabel = h("span", { class: "g-label rearm-label" });
  private readonly park = new ParkBrake();
  private readonly rearm = h("div", { class: "g-row rearm", hidden: true }, this.rearmLabel, h("div", { class: "bar rearm-bar" }, this.rearmFill));

  constructor() {
    this.el = h("div", { class: "flight-lights" }, h("div", { class: "g-row lamps" }, this.gear, this.brake, this.bombs), this.rearm);
  }

  update(v: HudView): void {
    const g = gearLight(v.gear, v.gearWanted);
    this.gear.classList.toggle("on", g === "on");
    this.gear.classList.toggle("blink", g === "blink");
    this.brake.classList.toggle("on", v.brake || this.park.update(v.alive, v.onGround, v.th, v.ab));
    this.bombs.hidden = !v.baseMode;
    if (v.baseMode) {
      text(this.bombs, t("lamp.bombs", { n: v.bombs }));
      this.bombs.classList.toggle("on", v.bombs > 0);
    }
    const rr = v.alive ? v.rearm : 0;
    this.rearm.hidden = rr <= 0;
    if (rr > 0) {
      text(this.rearmLabel, rearmText(rr));
      this.rearmFill.style.width = `${Math.round(Math.min(1, rr) * 100)}%`;
    }
  }
}
