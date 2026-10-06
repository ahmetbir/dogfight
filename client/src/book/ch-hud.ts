// Chapter 8: an annotated HUD and what every element means.
import { RADAR_ENEMY_M, TAG_GUN_M, TAG_GUN_RAD, TAG_NEAR_M } from "../game/sight.ts";
import { RADAR_M } from "../ui/radar.ts";
import { art, b, dist, figure, label, p, s, sec, sub, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";
import type { Child } from "../ui/dom.ts";

const deg = (rad: number) => `${Math.round((rad * 180) / Math.PI)}°`;

/** A numbered callout at (x, y). */
const tag = (n: number, x: number, y: number) => s("g", { class: "callout" }, s("circle", { cx: x, cy: y, r: 9 }), label(x, y + 4, String(n), "mid"));

function hudArt(): SVGSVGElement {
  const panel = (x: number, rows: string[]) => s("g", {},
    s("rect", { x, y: 228, width: 112, height: 92, rx: 6, class: "hud-box" }),
    ...rows.map((r, i) => label(x + 8, 246 + i * 18, r, "hud small")));
  return art(640, 340, "HUD: radar, skor, uyarılar, nişan işaretleri ve göstergeler",
    s("rect", { x: 0, y: 0, width: 640, height: 340, rx: 12, class: "screen" }),
    s("circle", { cx: 58, cy: 58, r: 44, class: "hud-box" }), s("circle", { cx: 58, cy: 58, r: 3, class: "hud-fill" }),
    s("rect", { x: 74, y: 40, width: 5, height: 5, class: "blip enemy" }), s("rect", { x: 40, y: 70, width: 5, height: 5, class: "blip friend" }),
    s("rect", { x: 255, y: 12, width: 130, height: 24, rx: 6, class: "hud-box" }), label(320, 29, "NATO 3 · 2 SOV · 6:12", "mid hud small"),
    s("rect", { x: 240, y: 44, width: 160, height: 22, rx: 5, class: "warn-box" }), label(320, 60, "FÜZE UYARISI · 1,2 km", "mid small"),
    label(320, 84, "FLARE!", "mid warn"),
    label(628, 26, "Ali ✕ Veli  TOP", "end small"),
    s("circle", { cx: 380, cy: 150, r: 16, class: "hud-mark" }),
    s("path", { d: "M312 170 h16 M320 162 v16", class: "hud-mark" }),
    s("rect", { x: 420, y: 118, width: 40, height: 40, class: "lock-box" }), label(440, 172, "820 m", "mid small hud"),
    s("rect", { x: 420, y: 178, width: 40, height: 4, class: "hud-box" }), s("rect", { x: 420, y: 178, width: 30, height: 4, class: "hud-fill" }),
    s("circle", { cx: 470, cy: 128, r: 6, class: "lead" }),
    label(320, 214, "MENZİL DIŞI", "mid warn small"),
    panel(14, ["HIZ 820 km/h", "İRT 1450 m", "GAZ ▮▮▮▯ AB ▮▯", "TEKER FREN İKMAL"]),
    panel(514, ["CAN ▮▮▮▮▯ 76", "ISI ▮▯▯▯", "MENZİL 950 m", "FÜZE 3  FLARE 6"]),
    tag(1, 108, 30), tag(2, 396, 24), tag(3, 412, 56), tag(4, 360, 84), tag(5, 560, 44), tag(6, 400, 140), tag(7, 330, 186),
    tag(8, 486, 140), tag(9, 452, 196), tag(10, 232, 214), tag(11, 136, 236), tag(12, 500, 236));
}

const item = (n: number, title: string, ...c: Child[]) => p(b(`${n}. ${title}`), " — ", ...c);

export const hud: Chapter = {
  id: "hud",
  title: "HUD rehberi",
  render: () => [
    figure(hudArt(), "Temsili HUD; numaralar aşağıdaki açıklamalara karşılık gelir."),
    item(1, "Radar", "Kuzey yukarıda, ", dist(RADAR_M), " yarıçap. Dostlar ve üs hedefleri her zaman görünür; düşman yalnız ",
      b(dist(RADAR_ENEMY_M)), " içindeyse."),
    item(2, "Skor ve süre", "Takım skorları (Üs Saldırısı'nda iki tarafın hedef canı) ve raundun kalan süresi."),
    item(3, "FÜZE UYARISI", "Sana kilitli bir füze yolda; yanında en yakın füzenin türü (IR ya da RADAR) ve uzaklığı. Kaç, dön, flare'e hazırlan."),
    item(4, "FLARE! / DİK UÇ!", "Seni izleyen IR füze ", b(dist(R.flareWarn)), " içinde ve flare'in hazır: şimdi at (yanında flare tuşu; dokunmatikte ",
      "FLARE düğmesi yanar). Flare füzeyi kandırınca ", b("FÜZE ATLATILDI!"), " yazar. Radar füzesinde mavi ", b("DİK UÇ!"),
      ": flare işlemez, füzeye dik uç."),
    item(5, "Olay akışı", "Kim kimi neyle düşürdü; hızlı sohbet mesajları da burada görünür."),
    item(6, "Nişan halkası", "Fare ile nişanda gitmek istediğin yön. Otopilot burnu buraya çevirir."),
    item(7, "Burun artısı", "Uçağın burnu, yani topun ateş yönü."),
    item(8, "Kilit kutusu", "Koni içinde burnuna en yakın (en küçük açıdaki) düşmanı çevreler; kilit ilerledikçe daralır, ", sec(R.lockS),
      " (radar ", sec(R.radarLockS), ", kesik çizgili kutu) sonra kilitlenir. Altında füze türü, uzaklık ve o türün menzil çubuğu: ",
      "çubuk dolu = kilit menzilinin kenarı."),
    item(9, "Öndelik halkası", "Top mermisinin hedefle buluşacağı nokta. Halkayı burun artısının üstüne getir ve ateş et."),
    item(10, "MENZİL DIŞI", "Koni içinde düşman var ama kilit menzilinin dışında: yaklaş."),
    item(11, "Sol panel", "HIZ (km/h), İRT (m), GAZ çubuğu, AB ışığı ve AB ısı çubuğu (kilitliyken yanıp söner). Altında ışıklar: ",
      b("TEKER"), " (takım açık; istenenle gerçek farklıyken yanıp söner), ", b("FREN"), " (fren ya da park freni), ", b("BOMBA n"),
      " (Üs Saldırısı) ve ", b("İKMAL %"), " (kendi üssünde dururken dolum)."),
    item(12, "Sağ panel", "CAN, top ISI'sı (dolunca top susar), MENZİL (havaya göre o anki kilit menzilin; Karışık'ta IR / radar), ",
      "kalan FÜZE (türüyle: ör. 2 IR + 1 R) ve FLARE."),
    sub("Diğer işaretler"),
    p(b("KORUMA"), ": doğuş ya da yer koruması sürüyor. ", b("İsim etiketleri"), ": düşman adı yalnız ", dist(TAG_NEAR_M),
      " içinde ya da top hattının ", deg(TAG_GUN_RAD), " yakınında ve ", dist(TAG_GUN_M), " altındaysa görünür; dostlar her zaman."),
    p("Ekran kırmızı yanıp sönerse isabet aldın; ekranın ortasındaki küçük işaret isabet ettirdiğini gösterir. Can azalınca CAN çubuğu kırmızıya döner."),
  ],
};
