// Pilot's Manual (English), chapters 7–9: maps and weather, the HUD, tips.
import { deg, hudArt } from "../../../book/ch-hud.ts";
import { weatherTable } from "../../../book/ch-world.ts";
import { b, dist, figure, list, note, p, sec, sub } from "../../../book/kit.ts";
import { RULES as R } from "../../../book/rules.ts";
import { RADAR_ENEMY_M, TAG_GUN_M, TAG_GUN_RAD, TAG_NEAR_M } from "../../../game/sight.ts";
import type { MapKind, WeatherKind } from "../../../net/protocol.ts";
import { MAPS, mapName, WEATHERS, weatherName } from "../../../ui/create.ts";
import type { Child } from "../../../ui/dom.ts";
import { RADAR_M } from "../../../ui/radar.ts";
import { UNSTABLE_MS } from "../../../net/link.ts";
import { t } from "../../index.ts";
import type { Field } from "../types.ts";

const MAP_ABOUT: Record<MapKind, string> = {
  ada: "An island ringed by sea: wide open space, low hills. The easiest one for your first flights.",
  sehir: "City blocks and tall buildings. Buildings are solid: hitting one is fatal, but diving between them shakes off a pursuer.",
  col: "Sand dunes and flats; few places to hide, a wide horizon.",
  dag: "Steep mountains and snowy peaks. Valleys give cover, but the terrain is your worst enemy.",
};

const WX_ABOUT: Record<WeatherKind, string> = {
  acik: "Clear skies.", bulutlu: "Low clouds, light wind.", sisli: "Very short visibility; the lock range shrinks too.",
  yagmurlu: "Rain, low clouds, wind.", firtina: "Lightning, downpours, strong and gusty wind.",
  gece: "Darkness; moonlight, stars, runway and engine lights.",
};

const item = (n: number, title: string, ...c: Child[]) => p(b(`${n}. ${title}`), " — ", ...c);

export const field: Field = {
  world: (ctx) => [
    p("You pick the map and the weather when you create a room; the same seed gives the same map. The play area reaches ", b(dist(R.playHalf)),
      " from the center in every direction; fly out and you get a warning first, then take damage shortly after. The two bases sit at the two ends of the map."),
    sub("Maps"),
    list(...MAPS.map((k) => [b(mapName(k)), ": ", MAP_ABOUT[k]])),
    sub("Weather"),
    p("The weather doesn't change during a round. It affects visibility (fog) and the missile lock range; wind drifts a plane in the air."),
    weatherTable(ctx),
    list(...WEATHERS.map((k) => [b(weatherName(k)), ": ", WX_ABOUT[k]])),
    note("tip", `In fog and storms the lock range shrinks: you have to get closer, and the gun does more of the talking. ${t("g.range")} on the HUD shows the current value.`),
    note("tip", "Wind doesn't affect bullets or missiles, it only drifts the plane: when landing, point the nose slightly into the wind (crab angle)."),
  ],

  hud: () => [
    figure(hudArt(), "A sample HUD; the numbers match the descriptions below."),
    item(1, "Radar", `North (${t("radar.north")}) is up, radius `, dist(RADAR_M), ". Friends and base targets always show; enemies only within ",
      b(dist(RADAR_ENEMY_M)), "."),
    item(2, "Score and time", "The team scores (in Base Attack, both sides' target HP) and the time left in the round."),
    item(3, t("hud.missileWarn"), "A missile locked on you is on its way; next to it, the kind (IR or RADAR), distance and clock position of the nearest one ",
      "(6 O'CLOCK: dead astern). The red arrow round the reticle points at it; on the radar the missile tracking you is a ringed red dot. ",
      "When someone has locked you before firing, it reads ", b(t("hud.lockWarn")), " and the arrow turns amber. Run, turn, get ready to flare."),
    item(4, `${t("flare.cue")} / ${t("flare.beam")}`, "An IR missile tracking you is within ", b(dist(R.flareWarn)), " and a flare is ready: drop it now (the flare key is shown next to it; ",
      "on touch the FLARE button lights up). When a flare fools the missile, ", b(t("flare.evaded")), " appears. Against a radar missile it shows a blue ", b(t("flare.beam")),
      ": flares don't work; keep the missile at your 3 or 9 o'clock to break its track. Next to it, the way to turn (← TURN LEFT / TURN RIGHT →); HOLD once the missile sits at 3 or 9. The bar under it fills while you hold the angle and empties when it slips; full, the track breaks."),
    item(5, "Event feed", "Who shot down whom, with what; quick chat messages show up here too."),
    item(6, "Aim circle", "With mouse aim, the direction you want to go. The autopilot turns the nose here."),
    item(7, "Nose cross", "The plane's nose, which is where the gun fires."),
    item(8, "Lock box", "Frames the enemy in the cone closest to your nose (at the smallest angle); it shrinks as the lock builds and locks after ", sec(R.lockS),
      " (radar ", sec(R.radarLockS), ", a dashed box). Under it: the missile kind, the distance and that kind's range bar; ",
      "a full bar = the edge of the lock range."),
    item(9, "Lead circle", "Where your gun rounds will meet the target. Put the circle on the nose cross and fire."),
    item(10, t("hud.outRange"), "An enemy is in the cone but outside your lock range: close in."),
    item(11, "Left panel", `${t("g.speed")} (km/h), ${t("g.alt")} (m), the ${t("g.thr")} bar, the AB light and the AB heat bar (blinks while locked out). Below them, the lights: `,
      b(t("lamp.gear")), " (gear down; blinks while the wanted and the actual state differ), ", b(t("lamp.brake")), " (brake or parking brake), ",
      b(t("lamp.bombs", { n: "n" })), " (Base Attack) and ", b(t("lamp.rearm", { p: "%" })), " (refilling while stopped at your own base)."),
    item(12, "Right panel", `${t("g.hp")}, gun ${t("g.heat")} (the gun falls silent when full), ${t("g.range")} (the picked missile's lock range for the weather), `,
      `the ${t("g.missiles")} left (with their kind: e.g. IR 2 RADAR 1; with Mixed the kind the missile key fires is framed) and ${t("g.flares")}.`),
    sub("Other marks"),
    p(b(t("hud.prot")), ": spawn or ground protection is on. ", b("Name tags"), ": an enemy's name shows only within ", dist(TAG_NEAR_M),
      ", or near your gun line (within ", deg(TAG_GUN_RAD), ") and closer than ", dist(TAG_GUN_M), "; friends' names always show."),
    p("If the screen flashes red, you were hit; the small mark in the middle of the screen shows that you hit. When your HP runs low, the HP bar turns red."),
    p(b("Connection"), ": the bars under the radar (beside it on phones and tablets) show your link to the server: four green bars when all is well, then fair, poor, ",
      "and one red bar when the server has gone quiet. Hover or tap them for the round trip in ms; when the link isn't good, the ms shows by itself. After ",
      sec(UNSTABLE_MS / 1000), " without a word from the server, ", b(t("conn.unstable")), " appears under the score. Your plane then flies on with the last input the server got; ",
      "when the link is back it glides to where the server has it instead of jumping."),
  ],

  tips: () => [
    sub("Energy"),
    list(
      ["Come in above corner speed and keep turns short: a long pull eats your speed, and a slow plane is an easy target."],
      ["Altitude is speed in reserve: wait up high, attack in a dive, then climb again."],
      ["Light the AB when you need it; you can't outrun a missile with a locked-out AB."]),
    sub("Attack"),
    list(
      ["Fire missiles from behind and well inside the range: the target finds no angle to escape. A missile fired head-on or at the edge of its range is easy to dodge."],
      ["Keep your nose on the enemy while the lock builds; the cone is narrow (", `${R.lockConeDeg}°`, ")."],
      ["Use the lead circle for the gun and fire short bursts within ", dist(R.gunRange), "; if the heat fills up, you're unarmed for ", sec(R.overheatS), "."]),
    sub("Defense"),
    list(
      [`On ${t("hud.missileWarn")}, turn hard across the missile's path (at a right angle to it), then drop a flare when `, b(t("flare.cue")), " lights up; several flares in a row are safer."],
      ["If the warning says RADAR, flares are wasted: ", b(t("flare.beam")), " — keep the missile at your 3 or 9 o'clock for ", sec(R.radarBeamS), " to break its track. If you're far away, fire first too: ",
        "the launcher has to keep its nose on you until its missile hits."],
      ["Turning low, in a valley or between buildings can fly a pursuer into the terrain — but you can hit it too."],
      ["Low on HP? Don't drag the fight out: land at your own base, stop for ", sec(R.rearmS), " and take off fully loaded."]),
    sub("Team play and Base Attack"),
    list(
      [`Use the 1–6 quick chat keys to keep your team posted: "${t("chat.1")}", "${t("chat.2")}".`],
      ["If you're a bomber, take out the AA first; it fires constantly within ", dist(R.aaRange), "."],
      ["Release bombs before the target; they carry forward with the plane's speed."],
      ["Don't leave your own base empty: shoot down enemy bombers before they reach their target."]),
    p("Good hunting, pilot."),
  ],
};
