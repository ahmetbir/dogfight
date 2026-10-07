// Pilot El Kitabı (Türkçe), bölüm 1–3: hızlı başlangıç, kontroller, uçuş.
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
  light: "hızlı yatış ve sıkı dönüş; it dalaşının ustaları.",
  multi: "sağlam gövde, bol füze; her işe yarar.",
  stealth: "hızlı ve çevik ama dört füze: atışını seç.",
  interceptor: "en hızlılar, kilit menzili en uzun; yavaş yatarlar, dönüş kavgasından uzak dur.",
  attack: "yavaş ama çok dayanıklı, on iki flare; üs baskınında sortide iki fazla bomba.",
  cheap: "küçük ve atik ama kırılgan, iki füze; ilk atışı kaçırma.",
  heavy: "yüksek hız, geniş dönüş; vur ve uzaklaş.",
};


export const basics: Basics = {
  start: () => [
    p("Dogfight tarayıcıda çok oyunculu bir jet it dalaşı oyunudur. Bu kitaptaki sayılar oyunun kendi değerlerinden gelir; ",
      "oyun değişirse kitap da değişir."),
    sub("İlk uçuş: 6 adım"),
    steps(
      ["Ana sayfada adını yaz ve ", b("Hızlı Oyna"), "'ya bas. En kalabalık açık odaya katılırsın; yoksa yeni oda kurulur. ",
        "İstersen ", b("Oda Kur"), " ile mod, harita, hava ve kalkış türünü kendin seç."],
      ["Uçağını seç. ", sec(R.pickTimeoutS), " içinde seçmezsen takımının varsayılan uçağıyla doğarsın. Sonra ", b("P"),
        ` (dokunmatik: ${T("pick")}) ile değiştirirsin.`],
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

  controls: () => [
    p("Şemayı oyunda ", b("Esc → Ayarlar"), ` (dokunmatik: ${T("menu")}) menüsünden seçersin; seçim tarayıcıda saklanır. `,
      "Aşağıdaki listeler oyunun tuş tablosundan üretilir."),
    figure(aimArt(), `Fare ile nişan: fareyi gitmek istediğin yere götür, uçak döner. Nişan burnun ${Math.round((MAX_AIM_OFF * 180) / Math.PI)}° konisinde kalır.`),
    sub("Fare ile nişan"), p("Masaüstü varsayılanı. Fare nişan yönünü gösterir, otopilot burnu oraya çevirir."), keyTable("mouse"),
    sub("Klavye"), p("Çubuk doğrudan tuşlarda: burun, yatış ve sapma senin elinde."), keyTable("keyboard"),
    sub("Dokunmatik"), p("Telefon ve tablet varsayılanı. Telefonu yatay tut."), keyTable("touch"),
    sub("Hızlı sohbet"),
    p(`1–6 tuşları (dokunmatik: ${T("chat")}) hazır mesaj yollar; takımlı modlarda yalnız takımına gider. `,
      "Mesajlar numara olarak gider: herkes kendi dilinde okur."),
    list(...CHAT_IDS.map((id) => [kbd(String(id)), " ", chatText(id)])),
    sub("Ayarlar"),
    list(
      [b("Dil"), ": Türkçe ya da English; ana sayfada ve oyunda Ayarlar'da değişir, seçim tarayıcıda saklanır."],
      [b("Y eksenini ters çevir"), ": burun yukarı/aşağı yönünü değiştirir (klavyede W/S, farede yukarı/aşağı, dokunmatikte çubuk)."],
      [b("Fare hassasiyeti"), ": yalnız fare ile nişanda."],
      [b("Fare kol gibi"), ": nişan burna bağlı kalır. Fareyi biraz sola kaydırırsan uçak, fareyi geri ortalayana dek sola dönmeye devam eder; ",
        "kaydırma büyüdükçe dönüş sertleşir. Uzun dönüşte rahattır, topla ince nişanda varsayılan mod daha iyidir."],
      [b("G efektleri"), ": yüksek G'de ekran kenarlarının kararması, eksi G'de kızarma (yalnız görsel)."],
      [b("Füze kamerası"), ": attığın füzeyi küçük bir pencerede izler."],
      [b("Performans modu"), ": daha az bulut, yağmur ve parçacık; zayıf cihazlarda akıcılık için."],
      [b("Eğimle nişan"), ": dokunmatikte, çubuk boştayken cihazı eğerek nişan alırsın."]),
    note("tip", "Mac trackpad'de füze için iki parmakla tıkla ya da ctrl+tık kullan."),
  ],

  flight: ({ aircraft }) => [
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
  aircraft: ({ aircraft }) => [
    p("İki taraf aynı rolleri kendi uçaklarıyla doldurur. Sayılar botların her uçak çiftiyle uçtuğu bir turnuvayla dengelendi: ",
      "hiçbir uçak ötekilerden belirgin üstün değildir, her biri kendi işinde iyidir. Takımlı modlarda kendi tarafının uçaklarını, ",
      "herkese karşı modunda hepsini seçebilirsin."),
    sub("Roller"),
    list(...ROLE_ORDER.map((g) => [b(t(`role.${g}` as Key)), ` (${roleNames(aircraft, g)}): `, ROLE_TEXT[g]])),
    sub("NATO"), rosterTable(aircraft, "nato"),
    sub("Sovyet"), rosterTable(aircraft, "soviet"),
    note("tip", "F-14 ile MiG-23'ün kanatları hızla oynar: yavaşken açık, hızlanınca geriye ok; parkta geriye toplu. ",
      "Rafale, Typhoon ve Su-30'un burnundaki kanardlar burnu kaldırırken döner."),
    p("Büyük uçak büyük hedeftir: mermi ve çarpışma küresi uçağın burnuna, kuyruğuna ya da kanat ucuna kadar uzanır. ",
      "Aynı takımdan uçaklar birbirine çarpmaz (dost ateşi kapalıyken)."),
  ],
};
