// Chapter 1: first flight in six steps; air start vs runway start.
import { keys, MOUSE_KEYS as M, TOUCH_LABEL as T } from "../input/bindings.ts";
import { art, b, dist, figure, jet, label, list, note, p, s, sec, steps, sub, type Chapter } from "./kit.ts";
import { RULES as R } from "./rules.ts";

/** Top view of the map: both team air-spawn zones at the ends, facing the middle. */
function spawnArt(): SVGSVGElement {
  const zone = (x: number, cls: string) => s("rect", { x: x - 14, y: 40, width: 28, height: 120, rx: 6, class: `zone ${cls}` });
  const arrow = (x1: number, x2: number) => s("line", { x1, y1: 100, x2, y2: 100, class: "arrow", "marker-end": "url(#book-arrow)" });
  return art(320, 200, "Havada başlangıç: takımlar haritanın iki ucundan merkeze bakarak doğar",
    s("defs", {}, s("marker", { id: "book-arrow", viewBox: "0 0 10 10", refX: 9, refY: 5, markerWidth: 6, markerHeight: 6, orient: "auto" },
      s("path", { d: "M0 0 L10 5 L0 10 Z", class: "arrow-head" }))),
    s("rect", { x: 10, y: 10, width: 300, height: 180, rx: 10, class: "map" }),
    zone(45, "nato"), zone(275, "soviet"), arrow(64, 140), arrow(256, 180),
    jet(45, 80, 0.8, "jet nato", 90), jet(45, 120, 0.8, "jet nato", 90), jet(275, 80, 0.8, "jet soviet", -90), jet(275, 120, 0.8, "jet soviet", -90),
    s("circle", { cx: 160, cy: 100, r: 5, class: "center" }),
    label(45, 32, "NATO", "mid"), label(275, 32, "SOVYET", "mid"), label(160, 180, `oynanan alan ±${dist(R.playHalf)}`, "mid small"));
}

export const start: Chapter = {
  id: "baslangic",
  title: "Hızlı başlangıç",
  render: () => [
    p("Dogfight tarayıcıda çok oyunculu bir jet it dalaşı oyunudur. Bu kitaptaki sayılar oyunun kendi değerlerinden gelir; ",
      "oyun değişirse kitap da değişir."),
    sub("İlk uçuş: 6 adım"),
    steps(
      ["Ana sayfada adını yaz ve ", b("Hızlı Oyna"), "'ya bas. En kalabalık açık odaya katılırsın; yoksa yeni oda kurulur. ",
        "İstersen ", b("Oda Kur"), " ile mod, harita, hava ve kalkış türünü kendin seç."],
      ["Uçağını seç. ", sec(R.pickTimeoutS), " içinde seçmezsen takımının varsayılan uçağıyla doğarsın. Sonra ", b("P"),
        ` (dokunmatik: ${T.pick}) ile değiştirirsin.`],
      ["Fare ile nişanda oyun ekranına bir kez tıkla: fare kilitlenir. Fareyi oynattığın yer nişan yönüdür; otopilot burnu oraya çevirir."],
      ["Gaz ", b(keys(M.throttleUp, M.throttleDown)), ", art yakıcı (AB) ", b(keys(M.ab)), ". Hızını köşe hızı civarında tut (bkz. Uçuş)."],
      ["Düşmanı burnunun önüne al. Top: ", b(keys(M.fire)), ". Düşman ", `${R.lockConeDeg}°`, " koni içinde ve menzildeyken ",
        sec(R.lockS), " tutarsan kilitlenirsin; füze: ", b(keys(M.missile)), "."],
      ["Ekranda ", b("FÜZE UYARISI"), " çıkınca flare at: ", b(keys(M.flare)), ". Can azalınca kendi üssüne in ve dur: ",
        sec(R.rearmS), " içinde her şey dolar."]),
    note("tip", "Tuşlar şemaya göre değişir (fare, klavye, dokunmatik). Tam liste: Kontroller bölümü ya da oyunda Esc → Ayarlar."),
    sub("Havada mı, pistte mi?"),
    p("Oda kurarken ", b("Kalkış"), " ayarı ikisinden birini seçer. Hızlı Oyna'nın kendi kurduğu odalar havada başlar; ",
      "katıldığın açık oda ise pistten başlıyor olabilir."),
    figure(spawnArt(), "Havada başlangıç: iki takım haritanın iki ucunda, burun merkeze dönük doğar."),
    list(
      [b("Havada"), " (varsayılan): uçuşa hazır doğarsın. ", sec(R.airProtectS), " koruma vardır; ilk atışında koruma hemen biter."],
      [b("Pist"), ": hangarda park freniyle doğarsın. Gaz verince fren bırakır, taksi yolundan piste çıkar, kalkış hızında burnu kaldırırsın. ",
        "Kendi üssünde tekerdeyken korunursun; havalanınca koruma ", sec(R.liftoffProtectS), " sonra biter (bkz. Kalkış ve iniş)."]),
  ],
};
