// Chapter 4: hangar, taxi, takeoff, landing, rearm and the ground protection rules.
import { keys, MOUSE_KEYS as M, TOUCH_LABEL as T } from "../input/bindings.ts";
import { art, b, figure, kbd, kmh, label, list, note, p, s, sec, speed, steps, sub, table, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";

/** Top view of a base: runway, parallel taxiway, apron and the hangar row. */
function baseArt(): SVGSVGElement {
  const hangars = Array.from({ length: R.hangars }, (_, i) =>
    s("rect", { x: 70 + i * 34, y: 128, width: 24, height: 18, class: "hangar" }));
  return art(340, 170, "Üs düzeni: pist, taksi yolu, apron ve hangarlar",
    s("rect", { x: 10, y: 10, width: 320, height: 150, rx: 10, class: "base-area" }),
    s("rect", { x: 20, y: 30, width: 300, height: 22, class: "runway" }),
    s("line", { x1: 30, y1: 41, x2: 310, y2: 41, class: "centerline" }),
    s("rect", { x: 40, y: 78, width: 260, height: 10, class: "taxi" }),
    s("rect", { x: 40, y: 52, width: 10, height: 26, class: "taxi" }), s("rect", { x: 290, y: 52, width: 10, height: 26, class: "taxi" }),
    s("rect", { x: 60, y: 88, width: 220, height: 36, class: "taxi" }),
    ...hangars,
    label(170, 24, "PİST", "mid small"), label(170, 101, "TAKSİ YOLU / APRON", "mid small"), label(170, 158, "HANGARLAR", "mid small"),
    label(318, 73, `≤ ${kmh(R.taxiGovernor)}`, "end small warn"));
}

/** Side view of a landing: glide, flare, touchdown limits. */
function landArt(): SVGSVGElement {
  return art(340, 130, "İniş: alçal, takımı aç, düşüş hızı ve yatış sınırının içinde değ",
    s("line", { x1: 10, y1: 110, x2: 330, y2: 110, class: "ground" }),
    s("rect", { x: 170, y: 106, width: 160, height: 4, class: "runway" }),
    s("path", { d: "M20 30 L170 100 Q190 108 220 108", class: "arrow dashed" }),
    s("g", { transform: "translate(20 30) rotate(25)" }, s("path", { d: "M-12 0 L10 0 L14 2 L-12 3 Z", class: "jet-side" })),
    label(80, 50, "süzülüş, takım açık", "small"),
    label(220, 92, `düşüş ≤ ${R.maxSinkRate} m/s · yatış ≤ ${R.maxTouchBankDeg}°`, "mid small warn"));
}

export const ground: Chapter = {
  id: "yer",
  title: "Kalkış, iniş, ikmal",
  render: ({ aircraft }) => [
    figure(baseArt(), `Her üste ${R.hangars} hangar var. Pist dışında (taksi yolu, apron, hangar, çimen) motor seni ${kmh(R.taxiGovernor)} üstüne itemez.`),
    sub("Hangardan kalkış"),
    steps(
      ["Hangarda ", b("park freni"), " tutar ve FREN ışığı yanar. Gaz ver (", kbd(keys(M.throttleUp)), "): fren bırakır. ",
        `İlk ${sec(R.parkGraceS)} gaz yok sayılır.`],
      ["Taksi yolundan piste çık. Dönmek için yatış/sapma tuşları burun tekerini çevirir. Fren: ", kbd(keys(M.brake)), " (basılı tut; ",
        `dokunmatik: ${T.brake}).`],
      ["Pistte burnu hizala, tam gaz ve AB ver."],
      ["Kalkış (rotate) hızında burnu kaldır; uçak teker keser."],
      ["Havalanınca takımı topla: ", kbd(keys(M.gear)), ` (dokunmatik: ${T.gear}).`]),
    table(["Uçak", "Kalkış hızı"], aircraft.map((a) => [b(a.name), speed(a.rotateSpeed)])),
    sub("Yerde sınırlar"),
    list(
      ["Pist dışında motor, AB dahil, ", b(speed(R.taxiGovernor)), " üstüne itemez (taksi valisi)."],
      ["Taksi yolu ve apronda ", speed(R.taxiMaxSpeed), " üstü teker teması çakılmaktır."],
      ["Çimen ve toprak hoş görülür: ", speed(R.grassMaxSpeed), " altında, eğim ", `${R.grassMaxSlopeDeg}°`,
        " içinde kalırsan devam edersin; çimen yavaşlatır ve sarsar. Su ölümcüldür."],
      ["Takım kapalı yere değmek her zaman çakılmaktır."]),
    sub("İniş"),
    figure(landArt(), "Pistin başına hizalan, alçal, takımı aç ve yumuşak değ."),
    list(
      ["Takımı ", speed(R.gearMaxDeploy), " altında aç (", kbd(keys(M.gear)), ")."],
      ["Temas anında düşüş hızı ", b(`≤ ${R.maxSinkRate} m/s`), ", yatış ", b(`≤ ${R.maxTouchBankDeg}°`),
        " olmalı. Pist her hızda kabul eder; taksi yolu ", speed(R.taxiMaxSpeed), " altında."],
      ["Değdikten sonra gazı kes ve fren yap. Burnu tutmaya devam edersen yeniden kalkarsın (pas geçme)."]),
    sub("İkmal"),
    p("Kendi üssünde (pist, taksi yolu, apron) tekerdeyken ", b(`${speed(R.rearmMaxSpeed)} altında`), " dur: ", b(sec(R.rearmS)),
      " sonra can, füze, flare, bomba dolar ve top soğur. HUD'da ", b("İKMAL %"), " çubuğu ilerler. Ateş edersen ya da flare atarsan sayaç sıfırlanır. ",
      "Herkes Herkese modunda iki üs de ikmal verir."),
    sub("Koruma kuralları"),
    list(
      ["Pistten doğduysan kendi üssünde tekerdeyken korunursun (hasar almazsın)."],
      ["Tekerle üs sınırından çıkarsan koruma o an biter."],
      ["Havalanınca koruma ", sec(R.liftoffProtectS), " sonra biter."],
      ["Ateş edersen (top, füze, bomba) koruma en çok ", sec(R.fireProtectS), " kalır."],
      ["Tekeri yerde olan ya da korumalı bir uçakla çarpışma hasar vermez: pist kazası kimseyi öldürmez."],
      ["Yerdeki uçağa füze kilitlenmez; top ve bomba korumasız uçağa işler. İkmal için inmiş (korumasız) düşmanı pistte bombalamak geçerli ",
        "bir taktiktir; kendi üssünde pistten doğmuş, korumalı uçağa hasar işlemez."]),
    note("tip", "Hayat başına bir kez P (UÇAK) ile uçağını anında değiştirebilirsin: pistten doğduysan kendi üssünde hâlâ yerdeyken, havada ",
      "doğduysan ilk ", sec(R.airProtectS), " koruma içinde. Sonrasında seçim bir sonraki doğuşta geçerli olur."),
  ],
};

