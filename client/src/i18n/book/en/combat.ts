// Pilot's Manual (English), chapters 4–6: takeoff and landing, weapons, modes.
import { baseArt, landArt, rotateTable } from "../../../book/ch-ground.ts";
import { fleet, targetsArt, targetTable } from "../../../book/ch-modes.ts";
import { ammoTable, bind, flareArt, lockArt } from "../../../book/ch-weapons.ts";
import { b, dist, figure, kbd, kmh, list, note, p, pct, sec, speed, steps, sub } from "../../../book/kit.ts";
import { RULES as R } from "../../../book/rules.ts";
import { KEYBOARD_KEYS as K, keys, MOUSE_KEYS as M, touchLabel as T } from "../../../input/bindings.ts";
import { modeName } from "../../../ui/create.ts";
import type { Combat } from "../types.ts";

const kb = "keyboard";

export const combat: Combat = {
  ground: ({ aircraft }) => [
    figure(baseArt(), `Every base has ${R.hangars} hangars. Off the runway (taxiway, apron, hangar, grass) the engine can't push you past ${kmh(R.taxiGovernor)}.`),
    sub("Taking off from a hangar"),
    steps(
      ["In the hangar the ", b("parking brake"), " holds and the BRAKE light is on. Throttle up (", kbd(keys(M.throttleUp)), ") to release it. ",
        `Throttle in the first ${sec(R.parkGraceS)} is ignored.`],
      ["Taxi to the runway. To turn, the roll/yaw keys steer the nose wheel. Brake: ", kbd(keys(M.brake)), " (hold; ",
        `touch: ${T("brake")}).`],
      ["Line the nose up on the runway, go full throttle and light the AB."],
      ["Raise the nose at rotate speed; the plane lifts off."],
      ["Once airborne, raise the gear: ", kbd(keys(M.gear)), ` (touch: ${T("gear")}).`]),
    rotateTable(aircraft),
    sub("Limits on the ground"),
    list(
      ["Off the runway the engine, AB included, can't push you past ", b(speed(R.taxiGovernor)), " (the taxi governor)."],
      ["On the taxiway and apron, touching down above ", speed(R.taxiMaxSpeed), " is a crash."],
      ["Grass and dirt are tolerated: stay below ", speed(R.grassMaxSpeed), " and within a ", `${R.grassMaxSlopeDeg}°`,
        " slope and you carry on; grass slows you down and shakes you. Water is deadly."],
      ["Touching the ground with the gear up is always a crash."]),
    sub("Landing"),
    figure(landArt(), "Line up with the start of the runway, descend, lower the gear and touch down gently."),
    list(
      ["Lower the gear below ", speed(R.gearMaxDeploy), " (", kbd(keys(M.gear)), ")."],
      ["At touchdown the sink rate must be ", b(`≤ ${R.maxSinkRate} m/s`), " and the bank ", b(`≤ ${R.maxTouchBankDeg}°`),
        ". The runway takes any speed; the taxiway only below ", speed(R.taxiMaxSpeed), "."],
      ["After touchdown, cut the throttle and brake. Keep holding the nose up and you take off again (a go-around)."]),
    sub("Rearming"),
    p("On the wheels at your own base (runway, taxiway, apron), stop ", b(`below ${speed(R.rearmMaxSpeed)}`), ": after ", b(sec(R.rearmS)),
      " your HP, missiles, flares and bombs refill and the gun cools. The ", b("REARM %"), " bar on the HUD fills up. Firing or dropping a flare resets it. ",
      "In Free-for-all, both bases rearm you."),
    sub("Protection rules"),
    list(
      ["If you spawned on the runway, you are protected (take no damage) while on the wheels at your own base."],
      ["Roll past the base boundary and the protection ends at once."],
      ["Once airborne, the protection ends ", sec(R.liftoffProtectS), " later."],
      ["If you fire (gun, missile, bomb), the protection lasts at most ", sec(R.fireProtectS), " more."],
      ["Colliding with a plane that is on its wheels or protected does no damage: a runway accident kills nobody."],
      ["Missiles can't lock onto a plane on the ground; the gun and bombs do hurt an unprotected one. Bombing an enemy that landed to rearm ",
        "(unprotected) on the runway is a fair tactic; a protected plane that spawned on the runway at its own base takes no damage."]),
    note("tip", `Once per life you can swap your aircraft instantly with P (${T("pick")}): while still on the ground at your own base after a runway `,
      "spawn, or within the first ", sec(R.airProtectS), " of protection after an airborne spawn. After that, a pick applies on your next spawn."),
  ],

  weapons: ({ aircraft }) => [
    ammoTable(aircraft),
    sub("Gun"),
    p("Key: ", b(bind(M.fire, K.fire, "fire", kb)), ". ", b(String(R.gunRate)), " rounds per second at ", speed(R.bulletSpeed),
      ", effective range ", b(dist(R.gunRange)), ", ", String(R.bulletDmg), " damage per hit."),
    list(
      ["The ", b("lead circle"), " ahead of the target shows where your rounds will meet it: put the circle on your nose and fire."],
      ["Heat: after ", String(R.gunShotsToOverheat), " continuous shots the gun overheats and stays silent for ", sec(R.overheatS), ". Full heat cools in ",
        sec(R.gunCoolS), ". Fire short bursts."],
      ["While the Turbo power-up lasts, the gun doesn't heat up."]),
    sub("Missiles"),
    figure(lockArt(), `Lock: hold the enemy inside the ${R.lockConeDeg}° cone and in lock range for ${sec(R.lockS)} (radar: ${sec(R.radarLockS)}).`),
    p("Key: ", b(bind(M.missile, K.missile, "missile", kb)), ". You need a lock first: hold the enemy inside the ", `${R.lockConeDeg}°`, " cone and in lock range for ",
      b(sec(R.lockS)), " (", b(sec(R.radarLockS)), " with a radar missile); the lock box shrinks and holds still once locked. Under the box: ",
      "the lock's missile kind (IR or RADAR), the distance and that kind's range bar."),
    list(
      ["A missile flies at ", speed(R.missileSpeed), ", lives ", sec(R.missileLifeS), " and deals ", String(R.missileDmg), " damage (radar ",
        String(R.radarDmg), "). ", sec(R.missileCooldownS), " between two shots."],
      ["Lock range depends on the aircraft and shrinks in bad weather (Maps and weather). ", b("RANGE"), " on the HUD shows your current range."],
      ["Planes on their wheels can't be locked. A missile in flight loses its target after ", sec(R.missileGroundLoseS), " of the target staying on its wheels."],
      ["Missiles regenerate in the air: each kind on its own timer, +1 every ", sec(R.missileRegenS), ", but only up to half of that kind's load. For a full load, ",
        "rearm or pick up a missile power-up (each kind in the load gets its share)."]),
    sub("Missile loadout"),
    p("Picked on the aircraft screen (", b("P"), ") for every spawn; it follows the aircraft's rule: right away while protected, otherwise on your next spawn."),
    list(
      [b("IR (short range)"), ": all the aircraft's missiles are heat-seeking. Fire-and-forget: you can turn away after the shot. Can be fooled by flares."],
      [b("Radar (medium range)"), ": lock range ×", String(R.radarRangeMul), ", lock time ", sec(R.radarLockS), ", half the missiles (at least 1). ",
        "Semi-active: keep the target within ", `${R.radarLeashDeg}°`, " of your nose until the missile hits, or the missile flies blind. Flares don't work; ",
        "if the target flies across the missile (closing speed below ", speed(R.radarBeamSpeed), "), the track breaks after ", sec(R.radarBeamS), "."],
      [b("Mixed"), ": half the IR missiles + 1 radar. The missile key fires radar when the locked target is beyond IR range, IR inside it ",
        "(radar up close too once the IR missiles are gone)."]),
    note("tip", "Radar gets the first shot from afar, but keeping your nose on the target exposes you too; IR means more missiles in a close fight."),
    sub("Flares"),
    figure(flareArt(), "A burning flare can fool an IR missile that tracks you and passes close to it."),
    p("Key: ", b(bind(M.flare, K.flare, "flare", kb)), ". A flare is a decoy that burns for ", b(sec(R.flareBurnS)), ": it leaves the plane, slows down and falls."),
    list(
      ["Every missile tracking you that comes within ", b(dist(R.flareRange)), " of a burning flare is fooled once per flare with ", b(pct(R.flareChance)),
        " probability: it turns to the flare and destroys itself when the flare burns out."],
      [sec(R.flareCooldownS), " between two flares: two or three in a row multiply your chances."],
      ["Timing is everything: when a missile comes within ", b(dist(R.flareWarn)), ", ", b("FLARE!"),
        " blinks on the HUD. A flare dropped too early burns out before the missile arrives."],
      ["Flares regenerate, +1 every ", sec(R.flareRegenS), " (up to your load)."],
      ["Flares don't fool radar missiles: the HUD says ", b("BEAM IT!"), ". Fly across the missile and hold it for ", sec(R.radarBeamS), "; or shoot down ",
        "the launcher, or get outside its ", `${R.radarLeashDeg}°`, " nose cone."]),
    sub("Bombs (Base Attack)"),
    p("Key: ", b(bind(M.bomb, K.bomb, "bomb", kb)), ". ", b(String(R.bombs)), " bombs per aircraft; only rearming refills them. A bomb leaves with the plane's ",
      "velocity and falls with gravity (wind doesn't affect it): release it before you reach the target."),
    list(
      ["Blast radius ", dist(R.bombRadius), ": up to ", String(R.bombStructDmg), " damage to a structure, up to ", String(R.bombPlaneDmg),
        " to an enemy plane (less the farther from the center)."],
      ["The gun does ", pct(R.structCannonMul), " damage to structures; missiles don't lock onto structures."]),
    note("warn", "Bombing, firing a missile or the gun ends your protection. These and dropping a flare also reset the rearm timer."),
  ],

  modes: ({ aircraft }) => [
    sub(modeName("team")),
    list(
      [`NATO${fleet(aircraft, "nato")} against the Soviets${fleet(aircraft, "soviet")}. `, `${R.teamMinPerSide}–${R.teamMaxPerSide}`,
        " pilots per team; bots fill the empty seats."],
      ["The first team to reach ", b(`${R.teamKills} kills`), " wins; when the ", b(`${R.roundMin} min`), " run out, the leader wins, a tie is a draw."]),
    sub(modeName("ffa")),
    list(
      [`${R.ffaMin}–${R.ffaMax}`, " pilots, everyone against everyone."],
      ["The first to reach ", b(`${R.ffaKills} kills`), " wins; when the ", `${R.roundMin} min`, " run out, the highest score (a tie is a draw)."]),
    sub(modeName("base")),
    figure(targetsArt(), `${R.targetsPerBase} targets per base. Your own base's AA gun fires at nearby enemies.`),
    p("A team mode: the goal is to destroy all ", b(`${R.targetsPerBase} enemy targets`), ". There is no kill limit; a round lasts ",
      b(`${R.baseRoundMin} min`), ". When time runs out, the side with more total target HP left wins; if both sides' last targets fall at once, it's a draw."),
    targetTable(),
    list(
      ["While the AA gun stands, it fires ", String(R.aaShotsPerS), " rounds per second (", String(R.aaDmg),
        " damage) at the nearest enemy within ", dist(R.aaRange), ". Take out the AA first, or come in low and fast."],
      ["A destroyed hangar can't be spawned in any more."],
      ["Every second bot on a team is a bomber, the rest are fighters; don't forget to defend your own targets."]),
    sub("Scoring"),
    list(
      ["Shooting down an enemy ", b("+1"), "; destroying a target ", b(`+${R.structPoints}`), " (not counted as a kill)."],
      ["Going down on your own (hitting the ground, leaving the map) ", b("−1"), "; dying to AA fire only counts as a death."],
      ["Shooting down a teammate scores nothing."],
      ["When a round ends, the scoreboard shows for ", sec(R.roundEndS), `, then a new round starts. Tab (touch: hold ${T("board")}) opens the scoreboard.`],
      ["After going down you respawn in ", sec(R.respawnS), `; while you wait, R (${T("replay")}) replays your last seconds.`]),
    sub("Leaderboard and pilot card"),
    p("Your browser knows you as a pilot (anonymous, no account needed). The home page shows the weekly and all-time leaderboards and your own card."),
    list(
      ["Only kills of ", b("human"), " pilots in ", b("public (listed)"), " rooms count on the leaderboard. Bot kills show only on your card."],
      ["For a round to count as a match you must stay in the room for at least ", b(sec(R.matchS)), " and get airborne at least once."],
      ["A new pilot record only opens after ", sec(R.newPilotFlightS), " of flight."],
      ["The weekly board resets with the ISO week (UTC); pilots with no kills in the period aren't listed."]),
    note("tip", "Private rooms (Visibility: Private) are for practice with friends; share the room code. They don't count on the leaderboard."),
  ],
};
