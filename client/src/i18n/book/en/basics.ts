// Pilot's Manual (English), chapters 1–3: quick start, controls, flight.
import { aimArt, keyTable } from "../../../book/ch-controls.ts";
import { abArt, aircraftTable, authArt, STALL_AUTHORITY } from "../../../book/ch-flight.ts";
import { spawnArt } from "../../../book/ch-start.ts";
import { b, figure, kbd, list, note, num, p, pct, sec, speed, steps, sub } from "../../../book/kit.ts";
import { TURN_BANK_RAD, TURN_S } from "../../../book/physics.ts";
import { RULES as R } from "../../../book/rules.ts";
import { keys, MOUSE_KEYS as M, touchLabel as T } from "../../../input/bindings.ts";
import { MAX_AIM_OFF } from "../../../input/schemes.ts";
import { BLACK_AFTER_S, BLACK_G, RED_G } from "../../../ui/gfx.ts";
import { CHAT_IDS, chatText } from "../../../ui/chat.ts";
import { ROLE_ORDER, roleNames, rosterTable } from "../../../book/ch-aircraft.ts";
import { t, type Key } from "../../index.ts";
import type { RoleGroup } from "../../../ui/roles.ts";
import type { Basics } from "../types.ts";

const ROLE_TEXT: Record<RoleGroup, string> = {
  light: "quick roll and tight turns; the dogfight specialists.",
  multi: "a tough airframe and plenty of missiles; good at everything.",
  stealth: "fast and agile but four missiles: pick your shots.",
  interceptor: "the fastest, with the longest lock; slow to roll, so stay out of turning fights.",
  attack: "slow but very tough, twelve flares; two extra bombs per sortie in base attack.",
  cheap: "small and nimble but fragile, two missiles; make the first shot count.",
  heavy: "high speed, wide turns; strike and extend.",
};


export const basics: Basics = {
  start: () => [
    p("Dogfight is a multiplayer jet dogfighting game in your browser. Every number in this manual comes from the game's own values; ",
      "when the game changes, so does the manual."),
    sub("First flight in 6 steps"),
    steps(
      ["On the home page, type your name and press ", b("Quick Play"), ". You join the busiest open room, or a new one is created. ",
        "If you like, use ", b("Create Room"), " to pick the mode, map, weather and start yourself."],
      ["Choose your aircraft. If you don't pick within ", sec(R.pickTimeoutS), ", you spawn in your team's default aircraft. Later, ", b("P"),
        ` (touch: ${T("pick")}) changes it.`],
      ["With mouse aim, click the game screen once: the mouse is captured. Where you move the mouse is where you aim; the autopilot turns the nose there."],
      ["Throttle ", b(keys(M.throttleUp, M.throttleDown)), ", afterburner (AB) ", b(keys(M.ab)), ". Keep your speed near corner speed (see Flight)."],
      ["Put the enemy in front of your nose. Gun: ", b(keys(M.fire)), ". Hold an enemy inside the ", `${R.lockConeDeg}°`, " cone and in range for ",
        sec(R.lockS), " and you get a lock; missile: ", b(keys(M.missile)), "."],
      ["When ", b("MISSILE WARNING"), " appears, drop a flare: ", b(keys(M.flare)), ". When your HP runs low, land at your own base and stop: ",
        "everything refills in ", sec(R.rearmS), "."]),
    note("tip", "The keys depend on the control scheme (mouse, keyboard, touch). The full list: the Controls chapter, or Esc → Settings in the game."),
    sub("Airborne or on the runway?"),
    p("When you create a room, the ", b("Start"), " setting picks one of the two. Rooms that Quick Play creates start airborne; ",
      "an open room you join may start on the runway."),
    figure(spawnArt(), "Airborne start: the two teams spawn at the two ends of the map, noses toward the middle."),
    list(
      [b("Airborne"), " (default): you spawn ready to fly, with ", sec(R.airProtectS), " of protection; your first shot ends it at once."],
      [b("Runway"), ": you spawn in a hangar with the parking brake set. Throttle up to release it, taxi to the runway and rotate at takeoff speed. ",
        "On the wheels at your own base you are protected; once airborne, the protection ends ", sec(R.liftoffProtectS), " later (see Takeoff, landing, rearm)."]),
  ],

  controls: () => [
    p("Pick the scheme in the game under ", b("Esc → Settings"), ` (touch: ${T("menu")}); the browser remembers it. `,
      "The lists below are generated from the game's key table."),
    figure(aimArt(), `Mouse aim: move the mouse where you want to go and the plane turns. The aim stays within a ${Math.round((MAX_AIM_OFF * 180) / Math.PI)}° cone around the nose.`),
    sub("Mouse aim"), p("The desktop default. The mouse sets the aim direction; the autopilot turns the nose there."), keyTable("mouse"),
    sub("Keyboard"), p("The stick is on the keys: pitch, roll and yaw are all yours."), keyTable("keyboard"),
    sub("Touch"), p("The phone and tablet default. Hold the phone in landscape."), keyTable("touch"),
    sub("Quick chat"),
    p(`Keys 1–6 (touch: ${T("chat")}) send a preset message; in team modes only your team sees it. `,
      "Messages travel as numbers, so everyone reads them in their own language."),
    list(...CHAT_IDS.map((id) => [kbd(String(id)), " ", chatText(id)])),
    sub("Settings"),
    list(
      [b("Language"), ": Türkçe or English; switch it on the home page or in Settings in the game. The browser remembers your choice."],
      [b("Invert Y axis"), ": flips nose up/down (W/S on the keyboard, up/down with the mouse, the stick on touch)."],
      [b("Mouse sensitivity"), ": mouse aim only."],
      [b("Mouse as a lever"), ": the aim rides on the nose. Move the mouse a little left and the plane keeps turning left until you centre it again; ",
        "a bigger move turns harder. Easy on long turns; the default mode is better for fine gun aiming."],
      [b("G effects"), ": the screen edges dim at high G and redden at negative G (visual only)."],
      [b("Missile camera"), ": follows the missile you fired in a small window."],
      [b("Performance mode"), ": fewer clouds, less rain and fewer particles, for smoother play on weaker devices."],
      [b("Tilt aim"), ": on touch, tilt the device to aim while the stick is idle."],
      [b("HUD style"), ": Classic (default) or Military: one colour and thin lines, like a real fighter's HUD. Military also picks the colour (green, amber) and the speed unit (km/h, kt) (see the HUD chapter)."]),
    note("tip", "On a Mac trackpad, fire missiles with a two-finger click or ctrl+click."),
  ],

  flight: ({ aircraft }) => [
    sub("Throttle and afterburner (AB)"),
    p("The throttle sets engine thrust; at full throttle the plane settles at its top speed. AB gives a higher top speed but heats up: after ",
      b(sec(R.abBurnS)), " of continuous burn it locks out and stays unusable until the heat falls to ", b(pct(R.abUnlock)), " (",
      sec((1 - R.abUnlock) * R.abCoolS), "). On the HUD, the bar next to the AB light shows the heat; it blinks while locked."),
    figure(abArt(), `Heat fills in ${sec(R.abBurnS)} while burning and empties in ${sec(R.abCoolS)} while off.`),
    note("tip", "Use AB in short bursts: coming out of a turn, running from a missile, climbing. A locked-out AB is the worst surprise in a fight."),
    sub("Corner speed and energy"),
    p("Every aircraft has a ", b("corner speed"), " where its controls bite hardest. Slower, the plane gets sluggish; faster, ",
      "the turn radius grows. Hard turns burn speed (induced drag): the more you pull, the slower you get. Store energy as altitude and speed, ",
      "and spend it on a turn only when you need to."),
    figure(authArt(aircraft), "Control authority, drawn from the game's flight model."),
    aircraftTable(aircraft),
    p(`The loss in the table: from corner speed at full throttle, pulling the nose all the way at ≈${Math.round((TURN_BANK_RAD * 180) / Math.PI)}° bank for ${sec(TURN_S)}; `,
      "computed with the game's flight model."),
    sub("Stall"),
    p("Below ", b(speed(R.stallSpeed)), " the plane stalls: the controls drop to ", pct(STALL_AUTHORITY), " authority and the nose falls toward the ground. ",
      "Lower the nose, add throttle, gain speed. A stall down low usually means a crash."),
    sub("Pulling and pushing"),
    p("Pushing the nose (negative G) is weaker than pulling: the push rate is ", b(pct(R.pushRatio)), " of the pull rate. Pull when you turn and when you evade; ",
      "roll first and then pull if you need to. The controls have inertia: rates don't build up instantly, and don't die out instantly either."),
    sub("G effects"),
    list(
      ["Stay above +", num(BLACK_G, 0), " G for ", sec(BLACK_AFTER_S), " and the screen edges start to go dark (blackout)."],
      ["Below ", num(RED_G, 0), " G the screen turns red (redout)."],
      ["Visual only; the flight doesn't change. Turn it off under Settings → G effects."]),
    sub("Landing gear and ceiling"),
    list(
      ["The gear won't come down above ", b(speed(R.gearMaxDeploy)), "; in the air it retracts by itself above ", speed(R.gearMaxSpeed), ". ",
        "Lowered gear adds drag."],
      ["Ceiling ", b(`${R.ceiling} m`), ": you can't climb higher."]),
    sub("Wind"),
    p("Wind drifts a plane in the air (not on the runway); bullets, missiles and bombs ignore it. In a storm the gusts vary. ",
      "Each weather's wind: see the Maps and weather chapter."),
  ],
  aircraft: ({ aircraft }) => [
    p("Both sides fill the same roles with their own aircraft. The numbers were balanced by a tournament in which bots fly every pair of ",
      "aircraft: none is clearly better than the rest, each is good at its own job. In team modes you fly your side's aircraft; ",
      "in free-for-all, any of them."),
    sub("Roles"),
    list(...ROLE_ORDER.map((g) => [b(t(`role.${g}` as Key)), ` (${roleNames(aircraft, g)}): `, ROLE_TEXT[g]])),
    sub("NATO"), rosterTable(aircraft, "nato"),
    sub("Soviet"), rosterTable(aircraft, "soviet"),
    note("tip", "The F-14's and the MiG-23's wings move with speed: spread when slow, swept back when fast, folded back when parked. ",
      "The canards on the Rafale, Typhoon and Su-30 turn as the nose comes up."),
    p("A big jet is a big target: the bullet and collision sphere reaches its nose, tail or wingtip. ",
      "Planes of the same team do not collide (with friendly fire off)."),
  ],
};
