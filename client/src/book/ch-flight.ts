// Chapter 3: throttle and afterburner heat, corner speed and energy, stall,
// push vs pull, G effects, wind.
import type { AircraftInfo } from "../net/protocol.ts";
import { authority } from "../sim/flight.ts";
import { BLACK_AFTER_S, BLACK_G, RED_G } from "../ui/gfx.ts";
import { art, b, figure, kmh, label, list, note, num, p, pct, s, sec, speed, sub, table, type Chapter } from "./kit.ts";
import { TURN_BANK_RAD, TURN_S, turnBleed } from "./physics.ts";
import { RULES as R } from "./rules.ts";

/** Control authority below the stall speed (the same for every aircraft). */
const STALL_AUTHORITY = authority(0, { cornerSpeed: 1, maxSpeedAB: 2 } as Parameters<typeof authority>[1]);

/** AB heat over time: burn until the lockout, then cool to the unlock level. */
function abArt(): SVGSVGElement {
  const lockAt = R.abBurnS, unlockAt = lockAt + (1 - R.abUnlock) * R.abCoolS, end = lockAt + R.abCoolS;
  const W = 300, H = 120, x0 = 30, y0 = 100, k = (W - x0 - 10) / end, hgt = 80;
  const X = (t: number) => x0 + t * k, Y = (v: number) => y0 - v * hgt;
  return art(W, H + 20, "Art yakıcı ısısı: yanarken dolar, kilitlenir, soğuyunca açılır",
    s("line", { x1: x0, y1: y0, x2: W - 10, y2: y0, class: "axis" }), s("line", { x1: x0, y1: y0, x2: x0, y2: y0 - hgt, class: "axis" }),
    s("line", { x1: x0, y1: Y(R.abUnlock), x2: W - 10, y2: Y(R.abUnlock), class: "guide" }),
    s("polyline", { points: `${X(0)},${Y(0)} ${X(lockAt)},${Y(1)} ${X(end)},${Y(0)}`, class: "curve" }),
    s("rect", { x: X(lockAt), y: y0 - hgt, width: X(unlockAt) - X(lockAt), height: hgt, class: "lockout" }),
    label(X(lockAt * 0.62), Y(0.2), "AB yanıyor", "mid small"), label((X(lockAt) + X(unlockAt)) / 2, Y(1) + 14, "KİLİTLİ", "mid small warn"),
    label(x0 - 4, Y(R.abUnlock) + 4, pct(R.abUnlock), "end small"), label(x0 - 4, Y(1) + 4, "%100", "end small"),
    label(X(lockAt), y0 + 14, sec(lockAt), "mid small"), label(X(unlockAt), y0 + 14, sec(unlockAt), "mid small"));
}

/** Control authority against speed for each aircraft (the sim's own function). */
function authArt(list: AircraftInfo[]): SVGSVGElement {
  const top = Math.max(...list.map((a) => a.maxSpeedAB));
  const W = 320, x0 = 34, y0 = 120, k = (W - x0 - 10) / top, hgt = 100;
  const X = (v: number) => x0 + v * k, Y = (a: number) => y0 - a * hgt;
  const curves = list.map((a, i) => {
    const pts: string[] = [];
    for (let v = 40; v <= a.maxSpeedAB; v += 2) pts.push(`${X(v).toFixed(1)},${Y(authority(v, a)).toFixed(1)}`);
    return s("polyline", { points: pts.join(" "), class: `curve c${i}` });
  });
  return art(W, 160, "Dümen etkinliği hızla değişir: stall altında zayıf, köşe hızında en iyi",
    s("line", { x1: x0, y1: y0, x2: W - 10, y2: y0, class: "axis" }), s("line", { x1: x0, y1: y0, x2: x0, y2: y0 - hgt, class: "axis" }),
    s("line", { x1: X(R.stallSpeed), y1: y0, x2: X(R.stallSpeed), y2: y0 - hgt, class: "guide" }),
    label(X(R.stallSpeed), y0 + 14, `stall ${kmh(R.stallSpeed)}`, "mid small warn"),
    ...curves, label(x0 - 4, Y(1) + 4, "%100", "end small"), label(W - 10, y0 + 14, kmh(top), "end small"),
    ...list.map((a, i) => label(x0 + 8, 24 + i * 13, a.name, `small c${i}`)));
}

function aircraftTable(list: AircraftInfo[]): HTMLElement {
  const kmhLoss = (a: AircraftInfo, ab: boolean) => `−${num(turnBleed(a, ab) * 3.6, 0)}`;
  return table(["Uçak", "Köşe hızı", "Azami hız (AB'siz / AB)", `${sec(TURN_S)} dönüş kaybı (AB'siz / AB)`], list.map((a) => [
    b(a.name), kmh(a.cornerSpeed), `${Math.round(a.maxSpeed * 3.6)} / ${kmh(a.maxSpeedAB)}`, `${kmhLoss(a, false)} / ${kmhLoss(a, true)} km/h`,
  ]));
}

export const flight: Chapter = {
  id: "ucus",
  title: "Uçuş",
  render: ({ aircraft }) => [
    sub("Gaz ve art yakıcı (AB)"),
    p("Gaz motorun itkisini ayarlar; tam gazda uçak kendi azami hızına oturur. AB daha yüksek bir azami hız verir ama ısınır: ",
      b(sec(R.abBurnS)), " kesintisiz yanarsa kilitlenir ve ısı ", b(pct(R.abUnlock)), "'a inene kadar (", sec((1 - R.abUnlock) * R.abCoolS),
      ") kullanılamaz. HUD'da AB ışığının yanındaki çubuk ısıyı gösterir; kilitliyken yanıp söner."),
    figure(abArt(), `Isı yanarken ${sec(R.abBurnS)}'de dolar, kapalıyken ${sec(R.abCoolS)}'de boşalır.`),
    note("tip", "AB'yi kısa patlamalarla kullan: dönüşten çıkarken, füzeden kaçarken, tırmanırken. Kilitli AB savaşta en kötü sürprizdir."),
    sub("Köşe hızı ve enerji"),
    p("Her uçağın bir ", b("köşe hızı"), " vardır: dümen etkinliği orada en yüksektir. Daha yavaşta uçak tembelleşir, daha hızlıda ",
      "dönüş yarıçapı büyür. Sert dönüş hız yakar (indüklenmiş sürükleme): çektikçe yavaşlarsın. Enerjiyi irtifa ve hız olarak biriktir, ",
      "dönüşü gerektiği an harca."),
    figure(authArt(aircraft), "Dümen etkinliği: oyunun uçuş modelinden çizildi."),
    aircraftTable(aircraft),
    p(`Tablodaki kayıp: köşe hızından, tam gazla, ≈${Math.round((TURN_BANK_RAD * 180) / Math.PI)}° yatışta burnu sonuna kadar çekerek ${sec(TURN_S)}; `,
      "oyunun uçuş modeliyle hesaplandı."),
    sub("Stall (tutunma kaybı)"),
    p(b(speed(R.stallSpeed)), " altında uçak stall olur: dümenler ", pct(STALL_AUTHORITY), " etkiye düşer ve burun yere doğru düşer. ",
      "Burnu indir, gazı aç, hız kazan. Alçakta stall genelde çakılmak demektir."),
    sub("Çekmek ve itmek"),
    p("Burnu itmek (eksi G) çekmekten zayıftır: itiş hızı çekişin ", b(pct(R.pushRatio)), "'i kadardır. Kaçarken ve dönerken çek; ",
      "gerekirse önce yatıp sonra çek. Dümenlerin ataleti vardır: hız birden oluşmaz, birden de sönmez."),
    sub("G etkileri"),
    list(
      ["+", num(BLACK_G, 0), " G üstünde ", sec(BLACK_AFTER_S), " kalırsan ekran kenarları kararmaya başlar (blackout)."],
      [num(RED_G, 0), " G altında ekran kızarır (redout)."],
      ["Yalnız görseldir; uçuşu değiştirmez. Ayarlar → G efektleri ile kapatılır."]),
    sub("İniş takımı ve tavan"),
    list(
      ["Takım ", b(speed(R.gearMaxDeploy)), " üstünde açılmaz; havada ", speed(R.gearMaxSpeed), " üstüne çıkınca kendiliğinden kapanır. ",
        "Açık takım sürüklemeyi artırır."],
      ["Tavan ", b(`${R.ceiling} m`), ": daha yukarı çıkılmaz."]),
    sub("Rüzgâr"),
    p("Rüzgâr havadaki uçağı sürükler (pistte etkisizdir); mermi, füze ve bomba rüzgârdan etkilenmez. Fırtınada esintiler değişkendir. ",
      "Hava durumlarının rüzgârları: Haritalar ve hava bölümü."),
  ],
};
