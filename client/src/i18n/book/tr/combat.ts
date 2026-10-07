// Pilot El Kitabı (Türkçe), bölüm 4–6: kalkış ve iniş, silahlar, modlar.
import { baseArt, landArt, rotateTable } from "../../../book/ch-ground.ts";
import { extraBombs } from "../../../book/ch-aircraft.ts";
import { fleet, targetsArt, targetTable } from "../../../book/ch-modes.ts";
import { ammoTable, bind, flareArt, lockArt } from "../../../book/ch-weapons.ts";
import { b, dist, figure, kbd, kmh, list, note, num, p, pct, sec, speed, steps, sub } from "../../../book/kit.ts";
import { RULES as R } from "../../../book/rules.ts";
import { KEYBOARD_KEYS as K, keys, MOUSE_KEYS as M, touchLabel as T } from "../../../input/bindings.ts";
import { modeName } from "../../../ui/create.ts";
import type { Combat } from "../types.ts";

const kb = "klavye";

export const combat: Combat = {
  ground: ({ aircraft }) => [
    figure(baseArt(), `Her üste ${R.hangars} hangar var. Pist dışında (taksi yolu, apron, hangar, çimen) motor seni ${kmh(R.taxiGovernor)} üstüne itemez.`),
    sub("Hangardan kalkış"),
    steps(
      ["Hangarda ", b("park freni"), " tutar ve FREN ışığı yanar. Gaz ver (", kbd(keys(M.throttleUp)), "): fren bırakır. ",
        `İlk ${sec(R.parkGraceS)} gaz yok sayılır.`],
      ["Taksi yolundan piste çık. Dönmek için yatış/sapma tuşları burun tekerini çevirir. Fren: ", kbd(keys(M.brake)), " (basılı tut; ",
        `dokunmatik: ${T("brake")}).`],
      ["Pistte burnu hizala, tam gaz ve AB ver."],
      ["Kalkış (rotate) hızında burnu kaldır; uçak teker keser."],
      ["Havalanınca takımı topla: ", kbd(keys(M.gear)), ` (dokunmatik: ${T("gear")}).`]),
    rotateTable(aircraft),
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
    note("tip", `Hayat başına bir kez P (${T("pick")}) ile uçağını anında değiştirebilirsin: pistten doğduysan kendi üssünde hâlâ yerdeyken, havada `,
      "doğduysan ilk ", sec(R.airProtectS), " koruma içinde. Sonrasında seçim bir sonraki doğuşta geçerli olur."),
  ],

  weapons: ({ aircraft }) => [
    ammoTable(aircraft),
    sub("Top"),
    p("Tuş: ", b(bind(M.fire, K.fire, "fire", kb)), ". Saniyede ", b(String(R.gunRate)), " mermi, mermi hızı ", speed(R.bulletSpeed),
      ", etkili menzil ", b(dist(R.gunRange)), ", isabet başına ", String(R.bulletDmg), " hasar."),
    list(
      ["Hedefin önündeki ", b("öndelik halkası"), " merminin hedefle buluşacağı yeri gösterir: halkayı burnuna al ve ateş et."],
      ["Isı: kesintisiz ", String(R.gunShotsToOverheat), " atışta top aşırı ısınır ve ", sec(R.overheatS), " susar. Tam ısı ",
        sec(R.gunCoolS), "'de soğur. Kısa seriler at."],
      ["Turbo power-up süresince top ısınmaz."]),
    sub("Füze"),
    figure(lockArt(), `Kilit: düşman ${R.lockConeDeg}° koni içinde ve kilit menzilindeyken ${sec(R.lockS)} tut (radar: ${sec(R.radarLockS)}).`),
    p("Tuş: ", b(bind(M.missile, K.missile, "missile", kb)), ". Önce kilit gerekir: düşmanı ", `${R.lockConeDeg}°`, " koni içinde ve kilit menzilinde ",
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
      [b("Radar (orta menzil)"), ": kilit menzili ×", num(R.radarRangeMul), ", kilit ", sec(R.radarLockS), ", sayı yarıya iner (en az 1). ",
        "Yarı aktif: füze vurana dek hedefi burnunun ", `${R.radarLeashDeg}°`, " içinde tut, yoksa füze güdümsüz kalır. Flare işlemez; hedef ",
        "füzeye dik uçarsa (füze yönündeki hızı ", speed(R.radarBeamSpeed), " altında) ", sec(R.radarBeamS), " sonra iz kopar (kopunca FÜZE ATLATILDI! yazar). Radar ", dist(R.radarMinRange), " içindeki hedefe kilitlenmez: yakında IR ya da top."],
      [b("Karışık"), ": IR füzelerin yarısı + 1 radar. Türü sen seçersin: ", b(keys(M.pick)), " (fare) ya da ", b(keys(K.pick)),
        " (klavye) IR ile radar arasında geçer; kilit menzili ve süresi seçtiğin türün olur. Seçtiğin tür bitince füze tuşu öbürünü atar. ",
        "Dokunmatikte seçim yok: kilitli hedef IR menzilinin dışındaysa radar, içindeyse IR."]),
    note("tip", "Radar uzaktan ilk atışı verir ama burnunu hedefte tutmak seni de açık eder; IR yakın dalaşta daha çok füze demektir."),
    sub("Flare"),
    figure(flareArt(), "Flare yanarken yakınından geçen ve seni izleyen IR füzeyi kandırabilir."),
    p("Tuş: ", b(bind(M.flare, K.flare, "flare", kb)), ". Flare ", b(sec(R.flareBurnS)), " yanan bir tuzaktır: uçaktan ayrılır, yavaşlar ve düşer."),
    list(
      ["Seni izleyen her füze, yanan bir flare'in ", b(dist(R.flareRange)), " yakınına girince o flare için bir kez ", b(pct(R.flareChance)),
        " olasılıkla kanar: flare'e döner ve flare sönünce kendini imha eder."],
      ["İki flare arası ", sec(R.flareCooldownS), "; tuşu basılı tutarsan seri çıkar. Her flare ayrı şanstır: art arda üç flare füzeyi ",
        b(pct(1 - (1 - R.flareChance) ** 3)), " olasılıkla kandırır."],
      ["Zamanlama her şeydir: füze ", b(dist(R.flareWarn)), " içine girince HUD'da ", b("FLARE!"),
        " yanıp söner. Çok erken atılan flare füze yaklaşmadan söner."],
      ["Flare ", sec(R.flareRegenS), "'de +1 yenilenir (yüke kadar)."],
      ["Radar füzesini flare kandırmaz: HUD ", b("DİK UÇ!"), " der. Füzeyi ", sec(R.radarBeamS), " boyunca saat 3 ya da 9 yönünde tut, iz kopar; ya da atanı ",
        "düşür ya da burnundan ", `${R.radarLeashDeg}°`, " dışına çık."]),
    sub("İsabet bölgeleri"),
    p("Her füze ve top isabeti nereye geldiğini zarla belirler. Can kaybının üstüne bazı isabetler uçağı kalıcı olarak bozar; ",
      "HUD'un sağ panelinde hasarlı parça sarı (1. seviye) ya da kırmızı (2. seviye) yanar."),
    list(
      [b("Kritik"), ": uçak tek isabette düşer. Füzede ", pct(R.missileCrit), ", top mermisinde %", num(R.bulletCrit * 100, 1), "."],
      [b("Motor"), ": azami hız ve itki seviye başına düşer (", pct(1 - R.dmgEngine1), ", sonra ", pct(1 - R.dmgEngine2), "). Füzede ",
        pct(R.missileEngine), ", top mermisinde %", num(R.bulletEngine * 100, 1), "."],
      [b("Kumanda"), ": yatış, burun ve sapma yavaşlar (", pct(1 - R.dmgControls1), ", sonra ", pct(1 - R.dmgControls2), "). Füzede ",
        pct(R.missileControls), ", top mermisinde %", num(R.bulletControls * 100, 1), "."],
      [b("Aviyonik"), ": kilitlenmek uzun sürer (×", num(R.dmgAvionics1), ", sonra ×", num(R.dmgAvionics2), "). Füzede ",
        pct(R.missileAvionics), ", top mermisinde %", num(R.bulletAvionics * 100, 1), "."],
      ["Hasar yeni doğuşta, üste ikmalde ve tamir paketiyle tamamen geçer."]),
    sub("Bomba (Üs Saldırısı)"),
    p("Tuş: ", b(bind(M.bomb, K.bomb, "bomb", kb)), ". Uçak başına ", b(String(R.bombs)), ` bomba${extraBombs()}; yalnız ikmalle dolar. Bomba uçağın hızıyla `,
      "ayrılır ve yerçekimiyle düşer (rüzgâr etkilemez): hedefin önünden bırak."),
    list(
      ["Patlama yarıçapı ", dist(R.bombRadius), ": yapıya en çok ", String(R.bombStructDmg), ", düşman uçağa en çok ", String(R.bombPlaneDmg),
        " hasar (merkezden uzaklaştıkça azalır)."],
      ["Top yapılara ", pct(R.structCannonMul), " hasar verir; füze yapıya kilitlenmez."]),
    note("warn", "Bombalamak, füze ya da top atmak korumanı bitirir. Bunlar ve flare atmak ikmal sayacını da sıfırlar."),
  ],

  modes: ({ aircraft }) => [
    sub(modeName("team")),
    list(
      [`NATO${fleet(aircraft, "nato")} Sovyet'e${fleet(aircraft, "soviet")} karşı. Takım başına `, `${R.teamMinPerSide}–${R.teamMaxPerSide}`,
        " pilot; boş koltukları botlar doldurur."],
      ["İlk ", b(`${R.teamKills} düşürme`), "ye ulaşan takım kazanır; ", b(`${R.roundMin} dk`), " dolunca önde olan, eşitse berabere."]),
    sub(modeName("ffa")),
    list(
      [`${R.ffaMin}–${R.ffaMax}`, " pilot, herkes herkese karşı."],
      ["İlk ", b(`${R.ffaKills} düşürme`), "ye ulaşan kazanır; ", `${R.roundMin} dk`, " dolunca en yüksek skor (eşitse berabere)."]),
    sub(modeName("base")),
    figure(targetsArt(), `Her üste ${R.targetsPerBase} hedef. Kendi üssünün uçaksavarı yakındaki düşmana ateş eder.`),
    p("Takımlı bir mod: amaç rakibin ", b(`${R.targetsPerBase} hedefinin`), " hepsini yıkmak. Düşürme sınırı yoktur; raund ",
      b(`${R.baseRoundMin} dk`), ". Süre dolunca kalan toplam hedef canı fazla olan kazanır; iki tarafın son hedefi aynı anda düşerse berabere."),
    targetTable(),
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
      ["Raund bitince skor tablosu ", sec(R.roundEndS), ` görünür, sonra yeni raund başlar. Tab (dokunmatik: ${T("board")} basılı) tabloyu açar.`],
      ["Ölünce ", sec(R.respawnS), ` sonra yeniden doğarsın; beklerken R (${T("replay")}) son saniyelerin tekrarını gösterir.`]),
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
