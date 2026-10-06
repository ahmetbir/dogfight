// Chapter 5: cannon, missiles, flares, bombs.
import { KEYBOARD_KEYS as K, keys, MOUSE_KEYS as M, TOUCH_LABEL as T } from "../input/bindings.ts";
import type { AircraftInfo } from "../net/protocol.ts";
import { loadoutCounts, missileText } from "../ui/loadout.ts";
import { art, b, dist, figure, jet, label, list, note, p, pct, s, sec, speed, sub, table, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";

const bind = (m: readonly string[], k: readonly string[], t: string) => `${keys(m)} · klavye ${keys(k)} · ${t}`;

/** The lock cone ahead of the nose, with the lock range. */
function lockArt(): SVGSVGElement {
  const a = (R.lockConeDeg * Math.PI) / 180, L = 230, x0 = 50, y0 = 80;
  const dy = Math.tan(a) * L;
  return art(320, 160, "Kilit konisi: burnun önünde dar bir koni, kilit menziline kadar",
    s("path", { d: `M${x0} ${y0} L${x0 + L} ${y0 - dy} L${x0 + L} ${y0 + dy} Z`, class: "cone" }),
    jet(x0 - 6, y0, 1, "jet me", 90),
    jet(x0 + 170, y0 - 10, 0.8, "jet enemy", 90), label(x0 + 170, y0 - 28, "kilit", "mid small"),
    jet(x0 + 140, y0 + 55, 0.8, "jet enemy dim", 70), label(x0 + 140, y0 + 80, "koni dışı", "mid small"),
    s("line", { x1: x0, y1: y0 + 46, x2: x0 + L, y2: y0 + 46, class: "guide" }),
    label(x0 + L, y0 + 42, "kilit menzili", "end small"), label(x0 + 60, y0 - 6, `${R.lockConeDeg}°`, "small"));
}

/** A missile turning off toward a burning flare inside its capture radius. */
function flareArt(): SVGSVGElement {
  return art(320, 170, "Flare: yanan tuzak, yakınındaki füzeyi kendine çekebilir",
    s("circle", { cx: 200, cy: 85, r: 70, class: "flare-zone" }),
    jet(260, 85, 1, "jet me", -90), s("circle", { cx: 200, cy: 85, r: 5, class: "flare" }),
    s("path", { d: "M20 120 Q120 120 196 88", class: "arrow dashed warn" }),
    label(20, 140, "füze", "small warn"), label(200, 70, "flare", "mid small"),
    label(200, 165, `yakalama yarıçapı ${dist(R.flareRange)}`, "mid small"));
}

function ammoTable(list: AircraftInfo[]): HTMLElement {
  return table(["Uçak", "Can", "Füze: IR / Radar / Karışık", "Flare", "Kilit menzili (IR / radar)", "Füzeyle düşer (IR / radar)", "Topla düşer"],
    list.map((a) => [
      b(a.name), String(a.maxHP),
      (["ir", "radar", "mixed"] as const).map((lo) => missileText(...loadoutCounts(a.missiles, lo), lo)).join(" / "), String(a.flares),
      `${dist(a.lockRange)} / ${dist(a.lockRange * R.radarRangeMul)}`,
      `${Math.ceil(a.maxHP / R.missileDmg)} / ${Math.ceil(a.maxHP / R.radarDmg)} füze`, `${Math.ceil(a.maxHP / R.bulletDmg)} mermi`,
    ]));
}

export const weapons: Chapter = {
  id: "silahlar",
  title: "Silahlar",
  render: ({ aircraft }) => [
    ammoTable(aircraft),
    sub("Top"),
    p("Tuş: ", b(bind(M.fire, K.fire, T.fire)), ". Saniyede ", b(String(R.gunRate)), " mermi, mermi hızı ", speed(R.bulletSpeed),
      ", etkili menzil ", b(dist(R.gunRange)), ", isabet başına ", String(R.bulletDmg), " hasar."),
    list(
      ["Hedefin önündeki ", b("öndelik halkası"), " merminin hedefle buluşacağı yeri gösterir: halkayı burnuna al ve ateş et."],
      ["Isı: kesintisiz ", String(R.gunShotsToOverheat), " atışta top aşırı ısınır ve ", sec(R.overheatS), " susar. Tam ısı ",
        sec(R.gunCoolS), "'de soğur. Kısa seriler at."],
      ["Turbo power-up süresince top ısınmaz."]),
    sub("Füze"),
    figure(lockArt(), `Kilit: düşman ${R.lockConeDeg}° koni içinde ve kilit menzilindeyken ${sec(R.lockS)} tut (radar: ${sec(R.radarLockS)}).`),
    p("Tuş: ", b(bind(M.missile, K.missile, T.missile)), ". Önce kilit gerekir: düşmanı ", `${R.lockConeDeg}°`, " koni içinde ve kilit menzilinde ",
      b(sec(R.lockS)), " (radar füzesiyle ", b(sec(R.radarLockS)), ") tut; kilit kutusu daralır ve kilitlenince sabitlenir. Kutunun altında ",
      "kilidin füze türü (IR ya da RADAR), uzaklık ve o türün menzil çubuğu."),
    list(
      ["Füze ", speed(R.missileSpeed), " hızla gider, ", sec(R.missileLifeS), " yaşar, ", String(R.missileDmg), " hasar verir (radar ",
        String(R.radarDmg), "). İki atış arası ", sec(R.missileCooldownS), "."],
      ["Kilit menzili uçağa göre değişir ve kötü havada kısalır (Haritalar ve hava). HUD'daki ", b("MENZİL"), " o anki menzilini gösterir."],
      ["Tekeri yerde olan uçağa kilitlenilmez. Uçuştaki füze, hedefi ", sec(R.missileGroundLoseS), " kesintisiz tekerde kalırsa izini kaybeder."],
      ["Havada füze yenilenir: her tür kendi sayacıyla ", sec(R.missileRegenS), "'de +1, ama yalnız o türün yükünün yarısına kadar. Tam yük için ",
        "ikmal ya da füze power-up'ı (yükteki her türe payı kadar)."]),
    sub("Füze yükü"),
    p("Her doğuşta uçak seçim ekranında (", b("P"), ") seçilir; uçakla aynı kurala uyar: koruma süresindeysen hemen, değilse bir sonraki doğuşta geçerli."),
    list(
      [b("IR (kısa menzil)"), ": uçağın tüm füzeleri ısı güdümlü. Ateşle-unut: attıktan sonra dönebilirsin. Flare'e kanabilir."],
      [b("Radar (orta menzil)"), ": kilit menzili ×", String(R.radarRangeMul), ", kilit ", sec(R.radarLockS), ", sayı yarıya iner (en az 1). ",
        "Yarı aktif: füze vurana dek hedefi burnunun ", `${R.radarLeashDeg}°`, " içinde tut, yoksa füze güdümsüz kalır. Flare işlemez; hedef ",
        "füzeye dik uçarsa (füze yönündeki hızı ", speed(R.radarBeamSpeed), " altında) ", sec(R.radarBeamS), " sonra iz kopar."],
      [b("Karışık"), ": IR füzelerin yarısı + 1 radar. Füze tuşu kilitli hedef IR menzilinin dışındaysa radar, içindeyse IR atar ",
        "(IR bitince yakında da radar)."]),
    note("tip", "Radar uzaktan ilk atışı verir ama burnunu hedefte tutmak seni de açık eder; IR yakın dalaşta daha çok füze demektir."),
    sub("Flare"),
    figure(flareArt(), "Flare yanarken yakınından geçen ve seni izleyen IR füzeyi kandırabilir."),
    p("Tuş: ", b(bind(M.flare, K.flare, T.flare)), ". Flare ", b(sec(R.flareBurnS)), " yanan bir tuzaktır: uçaktan ayrılır, yavaşlar ve düşer."),
    list(
      ["Seni izleyen her füze, yanan bir flare'in ", b(dist(R.flareRange)), " yakınına girince o flare için bir kez ", b(pct(R.flareChance)),
        " olasılıkla kanar: flare'e döner ve flare sönünce kendini imha eder."],
      ["İki flare arası ", sec(R.flareCooldownS), ": art arda iki üç flare şansını katlar."],
      ["Zamanlama her şeydir: füze ", b(dist(R.flareWarn)), " içine girince HUD'da ", b("FLARE!"),
        " yanıp söner. Çok erken atılan flare füze yaklaşmadan söner."],
      ["Flare ", sec(R.flareRegenS), "'de +1 yenilenir (yüke kadar)."],
      ["Radar füzesini flare kandırmaz: HUD ", b("DİK UÇ!"), " der. Füzeye dik uç ve ", sec(R.radarBeamS), " öyle kal; ya da atanı ",
        "düşür ya da burnundan ", `${R.radarLeashDeg}°`, " dışına çık."]),
    sub("Bomba (Üs Saldırısı)"),
    p("Tuş: ", b(bind(M.bomb, K.bomb, T.bomb)), ". Uçak başına ", b(String(R.bombs)), " bomba; yalnız ikmalle dolar. Bomba uçağın hızıyla ",
      "ayrılır ve yerçekimiyle düşer (rüzgâr etkilemez): hedefin önünden bırak."),
    list(
      ["Patlama yarıçapı ", dist(R.bombRadius), ": yapıya en çok ", String(R.bombStructDmg), ", düşman uçağa en çok ", String(R.bombPlaneDmg),
        " hasar (merkezden uzaklaştıkça azalır)."],
      ["Top yapılara ", pct(R.structCannonMul), " hasar verir; füze yapıya kilitlenmez."]),
    note("warn", "Bombalamak, füze ya da top atmak korumanı bitirir. Bunlar ve flare atmak ikmal sayacını da sıfırlar."),
  ],
};
