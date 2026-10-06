// Chapter 6: team, free-for-all, base attack; rounds, scoring, the leaderboard.
import type { AircraftInfo, Team } from "../net/protocol.ts";
import { MODE_NAMES } from "../ui/create.ts";
import { art, b, dist, figure, label, list, note, p, s, sec, sub, table, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";

const TARGETS: [string, number, number][] = [
  ["Hangar", R.hangarTargets, R.hangarHP], ["Yakıt tankı", R.fuelTargets, R.fuelHP], ["Radar", R.radarTargets, R.radarHP],
  ["Uçaksavar (AA)", R.aaTargets, R.aaHP],
];

/** " (F-16, F-15)": a team's aircraft names, "" when the table is unknown. */
const fleet = (list: AircraftInfo[], team: Team) => {
  const names = list.filter((a) => a.team === team).map((a) => a.name);
  return names.length ? ` (${names.join(", ")})` : "";
};

/** One base's targets around the runway, with the AA's reach. */
function targetsArt(): SVGSVGElement {
  const t = (x: number, y: number, w: number, hgt: number, name: string) => [
    s("rect", { x, y, width: w, height: hgt, class: "target" }), label(x + w / 2, y + hgt + 12, name, "mid small"),
  ];
  return art(340, 180, "Üs Saldırısı: her üste altı hedef; uçaksavar çevresini korur",
    s("circle", { cx: 170, cy: 118, r: 50, class: "aa-zone" }),
    s("rect", { x: 20, y: 30, width: 300, height: 18, class: "runway" }),
    ...t(70, 80, 26, 18, "hangar"), ...t(244, 80, 26, 18, "hangar"), ...t(282, 66, 14, 14, ""), ...t(304, 66, 14, 14, ""), label(300, 92, "yakıt", "mid small"),
    ...t(26, 70, 10, 14, "radar"), ...t(162, 112, 16, 12, "AA"),
    label(170, 178, `AA menzili ${dist(R.aaRange)}`, "mid small warn"));
}

export const modes: Chapter = {
  id: "modlar",
  title: "Modlar ve skor",
  render: ({ aircraft }) => [
    sub(MODE_NAMES.team),
    list(
      [`NATO${fleet(aircraft, "nato")} Sovyet'e${fleet(aircraft, "soviet")} karşı. Takım başına `, `${R.teamMinPerSide}–${R.teamMaxPerSide}`,
        " pilot; boş koltukları botlar doldurur."],
      ["İlk ", b(`${R.teamKills} düşürme`), "ye ulaşan takım kazanır; ", b(`${R.roundMin} dk`), " dolunca önde olan, eşitse berabere."]),
    sub(MODE_NAMES.ffa),
    list(
      [`${R.ffaMin}–${R.ffaMax}`, " pilot, herkes herkese karşı."],
      ["İlk ", b(`${R.ffaKills} düşürme`), "ye ulaşan kazanır; ", `${R.roundMin} dk`, " dolunca en yüksek skor (eşitse berabere)."]),
    sub(MODE_NAMES.base),
    figure(targetsArt(), `Her üste ${R.targetsPerBase} hedef. Kendi üssünün uçaksavarı yakındaki düşmana ateş eder.`),
    p("Takımlı bir mod: amaç rakibin ", b(`${R.targetsPerBase} hedefinin`), " hepsini yıkmak. Düşürme sınırı yoktur; raund ",
      b(`${R.baseRoundMin} dk`), ". Süre dolunca kalan toplam hedef canı fazla olan kazanır; iki tarafın son hedefi aynı anda düşerse berabere."),
    table(["Hedef", "Adet", "Can"], [...TARGETS.map(([n, c, hp]) => [n, String(c), String(hp)]), [b("Toplam"), String(R.targetsPerBase), b(String(R.baseHP))]]),
    list(
      ["Uçaksavar sağlamken ", dist(R.aaRange), " içindeki en yakın düşmana saniyede ", String(R.aaShotsPerS), " mermi atar (", String(R.aaDmg),
        " hasar). Önce AA'yı yık ya da alçaktan, hızlı gir."],
      ["Yıkılan hangar o hangara doğmayı kapatır."],
      ["Takımda her ikinci bot bombacıdır, diğerleri avcı; kendi hedeflerini savunmayı unutma."]),
    sub("Skor"),
    list(
      ["Düşman düşürmek ", b("+1"), "; hedef yıkmak ", b(`+${R.structPoints}`), " (düşürme sayılmaz)."],
      ["Kendi kendine düşmek (yere çakılma, harita dışı) ", b("−1"), "; uçaksavardan ölmek yalnız ölüm sayar."],
      ["Takım arkadaşını düşürmek puan vermez."],
      ["Raund bitince skor tablosu ", sec(R.roundEndS), " görünür, sonra yeni raund başlar. Tab (dokunmatik: SKOR basılı) tabloyu açar."],
      ["Ölünce ", sec(R.respawnS), " sonra yeniden doğarsın; beklerken R (TEKRAR) son saniyelerin tekrarını gösterir."]),
    sub("Liderlik tablosu ve pilot kartı"),
    p("Tarayıcın seni bir pilot olarak tanır (anonim, hesap gerekmez). Ana sayfada haftalık ve tüm zamanlar tablosu ile kendi kartın görünür."),
    list(
      ["Tabloya yalnız ", b("açık (listeli)"), " odalarda ", b("insan"), " pilot düşürmek sayılır. Bot düşürmeleri yalnız kartında görünür."],
      ["Bir raund maç sayılsın diye en az ", b(sec(R.matchS)), " odada kalmalı ve en az bir kez havalanmış olmalısın."],
      ["Yeni pilot kaydı ancak ", sec(R.newPilotFlightS), " uçuştan sonra açılır."],
      ["Haftalık tablo ISO haftasıyla (UTC) sıfırlanır; dönemde düşürmesi olmayan pilot listelenmez."]),
    note("tip", "Özel odalar (Görünürlük: Özel) arkadaşlarla antrenman içindir; oda kodunu paylaş, tabloya sayılmaz."),
  ],
};
