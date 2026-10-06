# Dogfight v2 — Tasarım (Spec)

Tarih: 2026-10-07 · Durum: uygulandı (feat/v2) · Önceki sürüm: `2026-10-06-dogfight-design.md` (v1, uygulandı)

Bu doküman v1 spec'inin üzerine yazılır: burada anılmayan her kural v1'deki gibi kalır.
Girdi: `.superpowers/sdd/v2/decisions.md` (sahip isteği + kontrolör kararları, bağlayıcı).
Belirsiz kalan her nokta burada karara bağlandı ve §17 **Kararlar** listesinde numarayla durur
(metin içinde `[K12]` gibi atıf).

## 1. Hedef ve kapsam

**Sahip şikâyeti:** "2 füze atınca yenisi için ölmek gerekiyor." **Sahip isteği:** seçilebilir haritalar
(ada, şehir, çöl, dağ), hava durumu, pistten kalkış, hangardan çıkış, iniş takımı; ayrıca önerilen
sekiz iyileştirmenin hepsi (oda listesi + Hızlı Oyna, mobil kontrol, füze hissi, kalıcı pilot
profili + liderlik tablosu, üs saldırısı modu, hızlı sohbet, metrikler, izleyici/killcam/tekrar).

**Başarı ölçütü:** canlı sürümde "Hızlı Oyna" → hangarda doğ → taksi → kalkış →
it dalaşı → füze bitince üsse in, dur, 3 sn'de ikmal → tekrar kalk. Dört harita, altı hava durumu,
üç mod (takımlı, FFA, üs saldırısı) bot ve insanlarla hatasız; telefonda yatay ekranda oynanabilir.

**Kapsam dışı (v2):** hesap/giriş (yalnız anonim pilot token'ı), serbest metin sohbet, raund içinde
değişen hava, lag compensation, sunucu tarafı tekrar kaydı, rüzgârın mermi/füze/bombaya etkisi.

## 2. Mimari değişiklikler

Yeni paketler (hepsi standart kütüphane; yeni dış bağımlılık yok):

```
internal/maps/      harita tipi, üs yerleşimi, düzleştirme, binalar, yapılar, uzamsal indeks
internal/weather/   hava tipi tablosu, seed'den rüzgâr
internal/pilot/     pilot token'ı: üretim, doğrulama, SHA-256 özeti
internal/stats/     kalıcı pilot istatistikleri: actor, JSON-lines günlük + anlık görüntü
internal/metrics/   Prometheus metin formatı (elle yazılmış), sayaç/gösterge/histogram
internal/rng/       seed'li splitmix (harita ve hava üretimi; sim kendi v1 RNG'sini korur)
```

Bağımlılık yönü (döngü yok): `geom, rng ← terrain ← maps ← sim ← {bot, mode} ← game ← {protocol, room}
← lobby ← server ← cmd`; `weather ← game`; `stats, pilot, metrics ← {room, server, cmd}`.
`sim` `maps`'i bilir, `maps` `sim`'i bilmez (takım yerine `Side int`: 0 NATO, 1 Sovyet).

Değişmeyen sınırlar: `sim` deterministik, I/O/zaman/global rastgelelik yok; global değişken yok
(sabit tablolar hariç); oda bir actor; her dosya ≤ ~300 satır (plan bölmeleri baştan yapar);
Go tek dış bağımlılık `github.com/coder/websocket`, client runtime bağımlılığı yalnız `three`.

Yeni/bölünen dosyalar planın "File Structure" bölümünde tek tek listelidir.

## 3. Simülasyon

Birimler, eksenler, `Dt = 1/60` v1 ile aynı. Burun yerel −Z. **Yön açısı (heading)** ψ:
`fwd = (−sin ψ, 0, −cos ψ)`, `ψ = atan2(−fwd.X, −fwd.Z)`; ψ azalınca sağa döner.

### 3.0 Uçuş modeli — geri bildirim #1 (FB-A)

Kontrolör kararı: v1 vektör dondurması bu değişiklik için **bir kez kaldırıldı**; `flight.json`
yeniden üretildi, ilk on senaryonun yeni özeti `vectors_frozen_test.go`'da yeniden donduruldu.

**Kontrol ataleti ve itme/çekme asimetrisi.** `FlightState.W` (gövde açısal hızı: X pitch, Y yaw,
Z roll; rad/s) eklenir. Çubuk artık hızı doğrudan değil **hedef hızı** belirler:

```
hedef = (in.Pitch·PitchRate·auth · (in.Pitch < 0 ? PushRatio : 1),
         −in.Yaw·YawRate·auth, −in.Roll·RollRate·max(auth, 0.5))
W.x = yaklaş(W.x, hedef.x, PitchAccel·PitchRate·Dt)   PushRatio = 0.55
W.y = yaklaş(W.y, hedef.y, YawAccel·YawRate·Dt)       PitchAccel = YawAccel = 2.5 (1/s)
W.z = yaklaş(W.z, hedef.z, RollAccel·RollRate·Dt)     RollAccel = 3.0 (1/s)
Rot = Rot · AxisAngle(W, |W|·Dt)
yaklaş(c, t, d) = c + clamp(t − c, −d, d)
```

Tam hıza çıkış: roll ~0.33 sn, pitch/yaw ~0.4 sn; bırakınca aynı sürede söner. Yerde (`stepGround`,
`settle`, kalkış) `W = 0`. Snapshot'ta `w` (1e-3 yuvarlı) gönderilir; tahmin `toFlight` ile alır.
Otopilot (`bot.Steer`, TS `steer`) `W`'yi alır: açıya P (pull 2.5→3.5), roll hızına D (0.1).

**İndüklenmiş sürükleme (enerji kaybı).** Hız adımına (tick başındaki `W` ile) eklenir:

```
n − 1 = speed · sqrt(W.x² + W.y²) / Gravity
speed += (thrust − k·speed² − g·fwd.Y − InducedDrag·(n − 1)²)·Dt      InducedDrag = 0.2
```

Köşe hızından 5 sn tam çekişli (83° yatış) dönüş: AB'siz F-16 −27.5, F-15 −30.4, MiG-29 −20.0,
Su-27 −24.1 m/s; AB ile −11.4 / −9.2 / −6.9 / −4.9 m/s (`TestInducedDragBleedsSustainedTurn`).
Düz uçuşta etkisi yoktur.

**Art yakıcı bütçesi.** `FlightState.ABHeat` (0..1) ve `ABLock`. `StepFlight` başında (hava ve yer):

```
ab = in.AB && !ABLock                          (bu tick yanan AB; Plane.AB bunu gösterir)
ABHeat = ab ? min(1, ABHeat + Dt/15) : max(0, ABHeat − Dt/25)
ABHeat ≥ 1 → ABLock = true ; ABLock && ABHeat ≤ 0.3 → ABLock = false
```

15 sn kesintisiz AB kilitler; kilit 17.5 sn sonra (0.3'te) açılır. Sunucu otoritesi; snapshot
`abh` (1e-3) ve `abl` taşır, tahmin aynısını uygular. Spawn'da 0. Botlar saldırıda ısı ≥ 0.7 iken AB
kullanmaz (kaçış ve arazi kaçınması için saklar).

### 3.1 Uçak tablosu (v2)

| Alan | F-16 | F-15 | MiG-29 | Su-27 |
|---|---|---|---|---|
| Füze / flare (v1: 2/6, 4/6, 2/8, 3/6) | **5 / 8** | **6 / 8** | **4 / 10** | **5 / 8** |
| Kalkış (rotate) hızı `RotateSpeed` (m/s) | 78 | 82 | 75 | 85 |

Diğer sütunlar v1 §3.1 gibi. Denge testi (`go test ./internal/game -run TestBalance -balance`)
her eşleşmede %38–62'de kalmalı (kontrolör kararı; ilk hedef %40–60'tı); dışarı taşarsa plan Task 3 yalnızca `LockRange` (±50 m adım) ve
`PitchRate` (±0.04 adım) ayarlar; füze/flare sayıları kontrolör kararıyla ±1 oynayabilir (F-16 4→5). Ayar
sonucu bu tabloya not düşülür.

Denge ölçümü (Task 3, 200 düello, zaman aşımı hariç): F16–F15 0.41, F16–MiG29 0.41, F16–Su27 0.45,
F15–MiG29 0.48, F15–Su27 0.47, MiG29–Su27 0.55. Ayarlar: `LockRange` F15 1000→1125 (kontrolör kararıyla
yarım adım), MiG29 900→750, Su27 1100→1150; F-16 füze 4→5 (kontrolör kararı: yükler ±1 serbest).
`PitchRate` değişmedi (v1 uçuş vektörlerini bozar). Test bandı kontrolör kararıyla %38–62 (eşleşme başına
~60–70 sonuçlanan düello, SE ≈ 6 puan).
Grup E sonrası (bot arazi kaçınması, tablo değişmedi): F16–F15 0.51, F16–MiG29 0.38, F16–Su27 0.54,
F15–MiG29 0.49, F15–Su27 0.55, MiG29–Su27 0.51. (MiG29 `LockRange` 725 denemesi F16–MiG29'u 0.41'e
çıkardı ama dag pistli maçında çakmayı 0.1/dk/bot sınırının üstüne taşıdı; uygulanmadı.)
FB-A sonrası (atalet, asimetri, indüklenmiş sürükleme, AB bütçesi, kalkansız power-up): uzun kilit
menzilleri baskın çıktı (MiG29–Su27 0.25, F15–MiG29 0.78). Ayar yalnız `LockRange`: F15 1125→1075,
MiG29 750→950, Su27 1150→1050 (F16 900 aynı). Sonuç: F16–F15 0.55, F16–MiG29 0.49, F16–Su27 0.55,
F15–MiG29 0.49, F15–Su27 0.48, MiG29–Su27 0.54 (zaman aşımı 0–11/200; düellolar artık sonuçlanıyor).

`AircraftInfo` (welcome) `rotateSpeed` alanını taşır; TS fizik sabiti tutmaz.

### 3.2 Füze ve flare yenileme

Tüm modlarda, uçak yaşarken:

- Füze sayısı **⌈yük/2⌉**'nin altındaysa **45 sn'de +1** (`MissileRegenTicks = 2700`; FB-A 6,
  önce: tam yüke kadar 20 sn'de +1). Yarının üstü yalnız ikmal (§3.7) ya da `missiles` power-up'ı
  (+2, yükte kırpılır) ile dolar.
- Flare sayısı maksimumun altındaysa **20 sn'de +1** (`FlareRegenTicks = 1200`; önce 10 sn).
- Hiçbir regen/power-up/ikmal/`Reseat`/yeniden doğma karışımı sayıyı yükün üstüne çıkaramaz
  (`TestMissilesNeverExceedLoadout`, 20 tohum × 200 rastgele işlem). Sunucuda yük aşımı hatası
  bulunmadı; "füze artıyor" algısı 20 sn'lik tam-yük regen'iydi.

Sayaç, sayı maksimumun altına ilk düştüğü tick'te başlar; her artıştan sonra hâlâ eksikse yeniden
kurulur, maksimumda sıfırlanır. Algoritma (Go, `sim/regen.go`):

```
regen(count, max, at, tick, every):
  count ≥ max      → at = 0
  at == 0          → at = tick + every
  tick ≥ at        → count++; at = (count < max) ? tick + every : 0
```

Power-up `missiles` (+2) ve ikmal (§3.7) sayaçları sıfırlar.

**Power-up dönüşü (FB-A 7):** kalkan (`shield`) kaldırıldı — "havadan kalkan alma boş iş". 8 nokta
sırayla `missiles, repair, turbo` (3 füze, 3 onarım, 2 turbo). `PUShield` enum'u ve protokoldeki
`"shield"` adı uyumluluk için durur ama hiç doğmaz; `Plane.ShieldUntil` ve snapshot `sh` kaldırıldı.

**Yerdeki uçağa füze yok (FB-A 8):** tekerleri yerde olan (`Ground`, her yerde) uçak kilitlenemez
(`updateLock` adayı atlar). Uçuştaki bir füze, hedefi **kesintisiz 1.5 sn** tekerde kalırsa
(`Plane.WheelsTicks ≥ MissileGroundLoseTicks = 90`) hedefi kalıcı olarak kaybeder (`Target = 0`) ve
güdümsüz düz devam eder; kısa bir dokun-kalk izi koparmaz (kontrolör kararı, düzeltme turu 1:
pist dokun-kalk istismarı). Top, bomba ve uçaksavar kuralları değişmez. Çimende 35 m/s altı
bekleyen uçak kilitlenemez (kabul edilmiş sınırlama; top ve bomba vurur).

**Füze yükleri** (`sim/loadout.go`, `sim/radar.go`; karar 72): pilot her doğuş için uçak seçim ekranında
yük seçer (`pick{kind, lo: ir|radar|mixed}`; uçak türüyle aynı kural: korumadaysa hemen, değilse sonraki doğuşta).
Tam yük `LoadoutCounts(tür, yük)` (n = §3.1 füze sayısı): **IR (kısa menzil)** n IR; **Radar (orta menzil)**
`max(1, ⌊n/2⌋)` radar; **Karışık** `⌊n/2⌋` IR + 1 radar. `Plane.Missiles` IR, `Plane.Radars` radar sayısıdır.
- **IR:** önceki füze (ateşle-unut, flare kuralları, kilit `LockSeconds = 1`, uçağın kilit menzili, 70 hasar).
- **Radar:** kilit menzili ×**2.2** (`RadarRangeMul`, hava çarpanı dahil), kilit **2 sn** (`RadarLockSeconds`),
  **50 hasar** (`RadarDmg`; denge, aşağıda). Yarı aktif: her tick atan uçak yaşamalı ve hedef onun burnunun
  **60°** (`RadarLeash`) içinde olmalı, yoksa füze hedefi kalıcı kaybeder (`Target = 0`, güdümsüz düz devam).
  Flare zarı atmaz. Beam: hedefin füze görüş hattı boyunca hızının mutlak değeri (`|v_hedef · (füze − hedef)/|…||`)
  **< 40 m/s** (`RadarBeamSpeed`) kesintisiz **90 tick** (1.5 sn, `RadarBeamTicks`) sürerse iz kopar (Doppler
  çentiği: kaçış — "drag" — izi koparmaz; `Missile.BeamTicks`).
- **Kilit ve seçim:** aday menzili, radar füzesi varken radar menzili, yoksa IR menzilidir. Kilidin türü
  (`Plane.LockKind`): radar varsa ve hedef IR menzilinin dışındaysa ya da IR kalmadıysa radar, değilse IR;
  `Locked` o türün kilit süresine ulaşınca (yükselen kenarda `EvLock{Missile}`). Tek füze tuşu (geçiş tuşu yok)
  kilidin türünü atar (`EvMissileLaunch{Missile}`).
- **Yenileme / power-up / ikmal tür başına:** her tür kendi sayacıyla (`MissileRegenAt`, `RadarRegenAt`) 45 sn'de
  +1, o türün yükünün ⌈yarısına⌉ kadar; `missiles` power-up'ı her türe `⌈2·yük_tür / n⌉` ekler (yükte kırpılır,
  iki sayaç sıfırlanır); ikmal her türü tam doldurur.
- **Denge:** `TestBalance` her iki bot Karışık'la: F16–F15 0.47, F16–MiG29 0.45, F16–Su27 0.47, F15–MiG29 0.58,
  F15–Su27 0.53, MiG29–Su27 0.46. Radar 70 hasarla ilk radar atışı düelloların ~%85'ini kazandırıyordu
  (kafa kafaya 1.2–1.4 km'den atılan radar füzesi beam'lenemiyor; menzil sırası F15 > Su27 > MiG29 > F16
  sonucu belirliyordu, F16 0.26); 50 hasar ve botların karşılık atışı bandı geri getirdi.

### 3.3 İniş takımı

- `FlightState` iki alan kazanır: `Gear` (takım açık) ve `Ground` (tekerler yerde). Sıfır değerler
  v1 havadaki davranışı verir.
- `Input` iki alan kazanır: `Gear bool` (istenen takım durumu, açık = true) ve `Brake bool` (fren,
  basılı tutulur). Takım **istenen durum** olarak gönderilir, tek seferlik "değiştir" olayı değil
  [K1]: kopan/tekrarlanan input'ta durum korunur.
- Kurallar (`gearState`, her tick, hız = adımdan önceki hız):
  1. `Ground` iken takım açık kalır (yerde toplanamaz).
  2. Havada takım açık ve hız > `GearMaxSpeed = 160` → takım zorla kapanır.
  3. İstenen açık, takım kapalı, hız ≤ `GearMaxDeploy = 140` → açılır. Hız 140'ın üstündeyse açılmaz;
     yavaşlayınca kendiliğinden açılır (istek sürdüğü için) [K1].
  4. İstenen kapalı → kapanır.
- Açılma/kapanma anlıktır (görsel animasyon client'ta) [K2].
- Takım açıkken sürükleme: `k_eff = k · (1 + GearDrag)`, `GearDrag = 0.8` (tam gazda F-16 dengesi
  ≈ 171 m/s → 160'ta takım kapanır; pratik tavan 160).
- Input'u olmayan uçak (oturum aç kalmış, bot yok) bir önceki takım isteğini korur:
  `Input{Throttle: p.Throttle, Gear: p.Gear}`.
- Tuşlar: **L** takım (iki şemada; klavye şemasında G flare olarak kalır), **B** fren (basılı).

### 3.4 Zemin modeli (Go `sim/ground.go`, TS `client/src/sim/ground.ts`, ortak vektörlerle sabit)

`StepFlight(fs, in, s, m)` imzası korunur; `FlightMods` genişler:

```go
type GroundSample struct { H float64; Surf maps.Surface } // zemin yüksekliği, yüzey türü
type FlightMods struct { Turbo bool; Wind geom.Vec3; Ground GroundSample }
```

`m.Ground`, çağıran tarafından tick başındaki `(Pos.X, Pos.Z)`'de örneklenir:
`H = terrain.Ground(x, z)`, `Surf = Map.SurfaceAt(x, z)` (`SurfNone=0`, `SurfRunway=1`, `SurfTaxi=2`;
taksi yolu, apron ve hangar zemini `SurfTaxi`).

**Sabitler:**

| Sabit | Değer | Anlam |
|---|---|---|
| `GearHeight` | 2.5 m | tekerdeyken uçak orijininin zeminden yüksekliği |
| `GroundThrust` | 0.3 | yerde itki çarpanı [K4] |
| `RollDecel` | 0.4 m/s² | yuvarlanma direnci |
| `BrakeDecel` | 8 m/s² | fren |
| `SteerMax` | 0.7 rad/s | burun tekeri dönüş üst sınırı |
| `SteerRadius` | 20 m | en küçük dönüş yarıçapı (oran ≤ v/20) |
| `SteerFadeSpeed` | 80 m/s | dönüş yetkisi 1 → 0.15'e bu hızda iner |
| `RotateRate` | 0.25 rad/s | tam pitch'te burun kaldırma hızı |
| `MaxGroundPitch` | 0.26 rad (15°) | yerde en büyük burun açısı |
| `LiftoffPitch` | 0.09 rad (≈5°) | bu açı + rotate hızında teker keser |
| `MaxSinkRate` | 6 m/s | temas anında en büyük düşüş hızı |
| `MaxTouchBank` | 20° | temas anında en büyük yatış |
| `TaxiMaxSpeed` | 35 m/s | `SurfTaxi` üstünde en büyük hız (düzeltme turu 2: 30 → 35, çimenle aynı) |
| `TaxiGovernor` | 28 m/s | pist dışında (taksi + çimen) itki (AB dahil) bu hızın üstüne itemez |

**Adım sırası** (Go ve TS aynı):

```
in = clamp(in); fs.Throttle = in.Throttle; speed = |Vel|
fs.Gear = gearState(fs, in, speed)
if fs.Ground: return stepGround(fs, in, s, m, speed)
... v1 hava adımı; tek fark:
    takım açıksa  speed += (thrust − k·(1+GearDrag)·speed² − g·fwd.Y)·Dt
    rüzgâr ≠ 0 ise Pos += (Vel + Wind)·Dt, değilse v1 ifadesi (Pos += Vel·Dt)
if fs.Gear && Pos.Y ≤ m.Ground.H + GearHeight: fs = settle(fs, m.Ground)   (FB-A: her zeminde; §3.5 yargılar)
return fs
```

`Gear=false` ve `Wind=0` iken hava yolu v1 ile işlem işlem aynıydı; FB-A (§3.0) hava yolunu bilerek
değiştirdi ve vektörler yeniden donduruldu.

**`stepGround`:**

```
ψ = heading(Rot.Forward()); θ = asin(clamp(fwd.Y))
k = Accel / MaxSpeed²
thrust = Accel·th  (AB: k·MaxSpeedAB²) ; turbo: ×1.69 ; sonra ×GroundThrust
decel  = RollDecel + (Brake ? BrakeDecel : 0)
speed  = max(0, speed + (thrust − k·(1+GearDrag)·speed² − decel)·Dt)
steer  = clamp(in.Yaw + in.Roll, −1, 1)
ψ     −= steer · min(SteerMax, speed/SteerRadius) · max(0.15, 1 − speed/SteerFadeSpeed) · Dt
θ      = (speed ≥ RotateSpeed && in.Pitch > 0) ? min(MaxGroundPitch, θ + RotateRate·in.Pitch·Dt)
                                               : max(0, θ − RotateRate·Dt)
Rot    = Norm(AxisAngle(Y, ψ) · AxisAngle(X, θ))        (kanatlar düz)
speed ≥ RotateSpeed && θ ≥ LiftoffPitch →  Ground=false; Vel = fwd(Rot)·speed; Pos += Vel·Dt   (kalkış)
aksi →  Vel = (−sin ψ, 0, −cos ψ)·speed; Pos += Vel·Dt; Pos.Y = H + GearHeight
```

**Engebeli zemin (FB-A 5, `Surf == SurfNone`):** `decel` ×`GrassRoll = 4`; adımın başında
önceki tick'in burun sallantısı çıkarılır (`θ −= bump(Pos, speed₀)`), sonunda eklenir
(`Rot = YawPitch(ψ, θ + bump(Pos', speed))`); `bump(x, z, v) = 0.012·min(1, v/35)·sin(0.9x+0.4z)·cos(0.5x−0.8z)`
rad. Yükseklik pürüzsüz kalır (tahmin/çizim titremesin diye sallantı tutumda). Taksi regülatörü
(28 m/s, AB dahil toplam itki) pist dışındaki her zeminde: `SurfTaxi` ve `SurfNone` (düzeltme turu 2:
hangardan tam gaz + AB ile düz çıkan uçak apron kenarından çimene 28 m/s ile geçip ölüyordu).

Yerde hız tabanı yoktur (havadaki 20 m/s tabanı yalnızca havada); rüzgâr yerde etkisizdir [K7].

**`settle`** (havadan yere geçiş): `ψ` korunur, `θ = clamp(asin(fwd.Y), 0, LiftoffPitch/2)` [K5],
`Vel` yatay bileşenin büyüklüğüyle yatay, `Pos.Y = H + GearHeight`, `Ground = true`. Böylece burun
yukarıda temas eden uçak hemen sekmez; pilot pitch'i bırakmazsa yeniden kalkabilir (pas geçme).

### 3.5 Temas, iniş geçerliliği ve çakma (`sim/landing.go`, yalnız Go)

World her canlı uçak için `before := p.FlightState` saklar, `StepFlight` sonrası:

1. `!before.Ground && after.Ground` (temas) → `LandingOK(before, surf)` yanlışsa `WCrash` ile ölüm.
   `LandingOK`: `before.Vel.Y ≥ −MaxSinkRate` ve `|bank(before.Rot)| ≤ MaxTouchBank` ve
   (`surf == SurfRunway` veya (`surf == SurfTaxi` ve yatay hız ≤ `TaxiMaxSpeed`) veya
   (`surf == SurfNone` ve zemin kuru (`Height ≥ 0`) ve eğim ≤ 12° ve yatay hız ≤ `GrassMaxSpeed = 35`)).
   `bank(q) = atan2(right.Y, up.Y)` (`right = q.Right()`, `up = q.Up()`).
2. `after.Ground` iken yeni konumdaki yüzey `SurfNone` ve (hız > 35 veya su veya eğim > 12°) → ölüm;
   `SurfTaxi` ve hız > `TaxiMaxSpeed` → ölüm. Eğim: `terrain.Ground` merkezi farkı (±2 m).
3. Takım kapalı temas: v1 kuralı (`Pos.Y ≤ Ground + 2 m` → ölüm) aynen. FB-A (geri bildirim #1,
   "azıcık çimene çıkalım, hemen ölüyoruz"): takım açıkken çimen/toprak artık 35 m/s'ye kadar
   tolere edilir (pistten taşma, taksi köşesi kesme); havadan çimene iniş pratikte mümkün değildir
   (stall hızı > 35). Botlar etkilenmez.
4. Bina/hangar duvarı/yapı ile temas: §3.9.

Yerdeki uçak (`Pos.Y = H + 2.5`) v1 çakma eşiğinin (`H + 2`) üstünde olduğu için ayrıca muaf
tutulmaz.

### 3.6 Kalkış türü, hangar spawn'ı, spawn koruması

Oda ayarı **Kalkış**: `hava` (varsayılan; FB-A 9 — önce `pist`) veya `pist`. Hızlı Oyna odası da
`hava` ile kurulur; eksik `start` alanı `hava` sayılır. `sim.Config.Start` (`StartAir=1`,
`StartRunway=2`; sıfır değer `StartAir` sayılır — eski testler ve denge düelloları havada başlar).

**`hava`:** v1 §3.5 gibi (1500 m, 200 m/s, 2 sn koruma, ateş edince biter); FB-A 9 ("2 ayrı
uçtan spawn, ortada buluşunca fight") ile takım bölgeleri haritanın iki ucunda simetrik:
NATO `x = −3200 ± 150`, Sovyet `x = +3200 ± 150`, `z ∈ [−1200, 1200]` (yanal dağılım), burun
merkeze dönük. FFA: 3000 m halkası, merkeze dönük. Burun yönündeki düz yol (spawn → merkez) üzerinde zemin
spawn irtifasına 150 m'den fazla yaklaşırsa o spawn yolun en yüksek noktası + 300 m'ye çıkar
(en çok `Ceiling − 100`; dağda FFA halkası). Test: 4 harita × seed 1–5.

**`pist`:**
- Üs seçimi: takımlı/üs modunda takımın üssü (`Side`: NATO 0, Sovyet 1); FFA'da `ID % 2` [K11].
- Hangar seçimi: üssün hangarları sırayla; hangar boş değilse (kendisi hariç, 25 m yatay yarıçap
  içinde canlı uçak varsa) veya hedef hangar yapısı yıkıldıysa (§3.10) sıradakine geçilir. Hepsi
  doluysa o üssün merkezi üstünde `hava` spawn'ı (1500 m, merkeze dönük) [K15].
- Durum: konum hangar zemini + `GearHeight`, yön hangarın dışa bakan yönü, `Vel = 0`,
  `Throttle = 0`, `Gear = Ground = true`, `RunwayStart = true`, `GroundProtect = true`, `Parked = true`
  (park freni: oyuncu ilk kez gaz > 0 ya da AB verene kadar uçak tutulur; spawn'dan sonraki ilk 0.5 sn
  (`ParkGraceTicks`) gaz yok sayılır; yerden kalkınca biter). Client şeması her yeni hayatta gazı 0'a çeker [K41].
- **Uçak değiştirme (`pist`):** hayat başına tek anlık değiştirme yalnız uçak kendi üssünde hâlâ
  yerdeyken (`GroundProtect`, `CanSwap`) yapılır, kalkıştan sonra yapılamaz; değiştirme uçağı korumalı olarak
  yeniden hangara park eder.
- **Koruma:** `GroundProtect` iken, tekerler yerde ve uçak **kendi üssünün** sınırları
  (`Base.Bounds`, `CanSwap` ile aynı denetim) içindeyken her tick `ProtectUntil = tick + 480`
  (kendi üssünde yerde olduğu sürece uzar). Üs sınırından tekerle çıkınca `GroundProtect = false`
  ve `ProtectUntil = min(ProtectUntil, tick)`: koruma sınırda biter (top, füze, bomba işler).
  Teker kesince `GroundProtect = false` → koruma kalkıştan 8 sn sonra biter. Ateş (top, füze, bomba)
  `GroundProtect = false` ve `ProtectUntil = min(ProtectUntil, tick + 120)` yapar (2 sn) [K29].
  `hava` hayatlarında ateş v1'deki gibi korumayı hemen bitirir.
- **Yerde çarpışma yok:** korumalı bir uçak ya da tekerleri yerde olan bir uçak içeren çift
  çarpışma (ram) sayılmaz: hasar da, kill de yok (pist kazaları kimseyi öldürmez).
- **Hayat kimliği:** `Plane.Life` her spawn'da +1. `Reseat` (koruma sırasında uçak değiştirme)
  `Life`'ı korur; uçak yeniden hangara park edilirse taze yer koruması alır, havada çıkarsa
  (hangar boş değil) `ProtectUntil = min(eski, tick + 120)` olur (hava spawn'ının 2 sn'si). `game.Pick`'teki "hayat başına bir
  anlık değiştirme" kontrolü `ProtectUntil` yerine `Life` ile yapılır (yerdeyken `ProtectUntil`
  her tick değiştiği için).

### 3.7 İkmal (üste durunca: pist, taksi yolu, apron)

`sim/rearm.go`: `Ground` ve yatay hız < 3 m/s ve uçak kendi üssünün sınırları (`Base.Bounds`)
içinde (FFA: herhangi bir üs [K11]) → `RearmTicks++`; 180 tick'e (3 sn) ulaşınca: can, füze, flare,
bomba (üs modunda) maksimuma, ısı 0, aşırı ısınma biter, yenileme sayaçları sıfır; `EvRearm` olayı;
sayaç 0. Koşul bozulursa sayaç 0; o tick'te atılan her top/füze atışı da sayacı 0 yapar (park
hâlinde kendini dolduran taret istismarı, kontrolör kararı). Snapshot'ta ilerleme `rr = RearmTicks/180`.

### 3.8 Rüzgâr

`sim/wind.go` (TS port `client/src/sim/wind.ts`, ortak vektör):

```go
func WindAt(base geom.Vec3, gust float64, tick int) geom.Vec3 {
	if gust == 0 { return base }
	t := float64(tick) * Dt
	along := gust * (0.6*math.Sin(2*math.Pi*t/7.3) + 0.4*math.Sin(2*math.Pi*t/2.9+1.3))
	cross := 0.5 * gust * math.Sin(2*math.Pi*t/5.1+0.7)
	d := base.Norm()
	side := geom.V(-d.Z, 0, d.X)
	return base.Add(d.Scale(along)).Add(side.Scale(cross))
}
```

World her tick `w := WindAt(cfg.Wind, cfg.Gust, tick)` hesaplar ve `FlightMods.Wind`'e koyar.
`Vel` hava hızıdır (snapshot'ta da); yer izi `Vel + Wind`. Rüzgâr mermi, füze, bomba ve yerdeki
uçağı etkilemez [K7]. Client tahmini rüzgârı tahmini tick'le hesaplar (`snapTick + 1 + i`) [K8];
sapma reconcile ile düzelir.

### 3.9 Binalar ve katı cisimler

`maps.Index` eksen hizalı kutulardan (AABB) bir ızgara indeksidir (100 m hücre). İçerik: şehir
binaları + hangar duvarları/çatıları (+ üs modunda sağlam yapılar ayrı listede, §3.10).

- `Sweep(a, b, r) (t float64, ok bool)`: `a→b` doğru parçasının `r` kadar büyütülmüş kutulara ilk
  giriş parametresi (slab testi; köşelerde muhafazakâr) [K17].
- Uçak: tick yolu (`prev → Pos`) `r = BuildingRadius = 5 m` ile `Sweep` → isabet `WCrash` ölümü
  (koruma yok sayılır, v1 çakması gibi).
- Mermi: `r = 0`; bina, yoldaki en yakın uçaktan önceyse mermi sessizce biter [K16].
- Füze: `r = 0`; isabet → `EvMissileGone` (client patlama çizer).
- Bina kutusu: taban kotu (merkez zemini − 2 m) → üst `zemin + yükseklik` (yazılı tanımdan 2 m
  uzun; kontrolör kararıyla kabul).
- Hangar ölçüleri: iç 40 m × 30 m, yükseklik 12 m, duvar 1 m; çatı `elev+11..elev+12`. Hangar
  içindeki uçak küresi (üst ucu `elev+7.5`) çatıya ve duvarlara (20 m) değmez.

### 3.10 Üs saldırısı: yapılar, bomba, uçaksavar (yalnız `base` modu)

**Yapılar** (her üste 6; `maps/structures.go`, üs yerel koordinatı `(u, v)`, §4.3):

| # | Tür | Konum (u, v) | Kutu (gen × yük × der) | Can |
|---|---|---|---|---|
| 0 | hangar (hangar 0) | (−250, 225) | 40 × 12 × 30 | 400 |
| 1 | hangar (hangar 5) | (250, 225) | 40 × 12 × 30 | 400 |
| 2 | yakıt tankı A | (420, 170) | 20 × 14 × 20 | 250 |
| 3 | yakıt tankı B | (500, 170) | 20 × 14 × 20 | 250 |
| 4 | radar | (−480, 180) | 12 × 18 × 12 | 300 |
| 5 | uçaksavar (AA) | (0, 320) | 16 × 5 × 16 | 350 |

Üs başına toplam 1950. Yapı kimliği `StructIDBase (1<<22) + side·8 + i`; `sim.StructTeam(id)`.
Yıkılan hangar yapısı o hangarı spawn için kapatır (duvarlar ayakta, kararmış çizilir) [K15].
Yıkılan yapı çarpışma kutusu olmaktan çıkar (enkaz).

**Hasar:** top mermisi düşman yapı kutusuna girerse `BulletDmg × 0.25 = 1.5` ve mermi biter.
Füze yapıyı hedeflemez; kutuya çarparsa patlar (hasarsız). Olaylar: `EvStructHit{Plane: yapıID,
Other: saldıran, Value: hasar, Pos}`, can 0'da `EvStructDown`. Yıkan pilota +2 skor [K14].

**Flare (yem)** (`sim/flare.go`; karar 71): flare uçaktan bırakılan, **2.5 sn** (`FlareLife = 150` tick)
yanan bir sim nesnesidir. Bırakıldığı tick'te uçağın konumunda, uçağın hızıyla doğar; her tick hız
`·(1 − 1.5·Dt)` ile söner, `Gravity` ile düşer, zemine değerse orada durup yanmaya devam eder. Bekleme
**1 sn** (`FlareCooldown = 60`), sayılar ve yenileme §3.2'deki gibi. Her tick (bırakma tick'i dahil, füzelerden
önce): yanan her flare için (bırakma sırası), bırakan uçağı **izleyen** her füze (fırlatma sırası) flare'e
**900 m** (`FlareRange`) içindeyse ve bu (füze, flare) çifti daha önce zar atmadıysa **bir kez** %65
(`FlareChance`, dünya PRNG'si) zar atar. Tutan zarda füze `Target = 0`, `Decoy = flareID` olur, `EvDecoy{Plane:
füze, Other: hedefi, By: atan, Pos: flare}` yayılır; füze dönüş sınırıyla flare'in konumuna güdümlenir ve
flare'e ulaşınca (`MissileFuse`) ya da flare söndüğü tick'te hasarsız `EvMissileGone` ile biter. Aldatılmış
füze hiçbir uçağa hasar vermez. Erken bırakılan flare yanmaya devam ettiği için yaklaşan füze 900 m'ye
girdiğinde yine zar atar; ikinci flare yeni bir çifttir (yeniden zar). Snapshot yalnız yanan flare'leri
taşır (`fx: [{id, p}]`, 10 cm; kimlikler `1<<26`'dan). Botlar: izleyen füze **800 m** (`FlareWarn`) içindeyken,
tepki süresinden sonra ve zorluk zarı (algılamada bir kez: kolay 0.3, normal 0.7, zor 0.95) tuttuysa füze
izlemeye devam ettikçe saniyede bir flare atar. HUD: izleyen füze < 800 m ve flare hazırsa (sayı > 0, son
flare'den ≥ 60 tick) "FÜZE UYARISI"nın altında yanıp sönen **FLARE!** (fare şeması SPACE, klavye G tuş
kapağı; dokunmatikte FLARE düğmesi yanar). Aldatmada hedefe yeşil "FÜZE ATLATILDI!" (1.5 sn) ve yükselen
iki ton, atana "Füzen flare'e kandı" (1.5 sn); füze flare'de küçük beyaz/turuncu bir pufla biter.
Client flare'i yalnız snapshot'tan çizer (flare başına bir görsel); `flare` olayı yalnız sestir.

**Bomba** (`sim/bomb.go`): uçak başına `Config.Bombs` (üs modunda 2; diğer modlarda 0), yalnız
ikmalle dolar. `Input.Bomb` tek seferlik; bekleme 30 tick. Bırakma: `Pos − up·2`, hız `Vel + (0,−2,0)`.
Her tick `Vel.Y −= Gravity(14)·Dt; Pos += Vel·Dt` (sürükleme/rüzgâr yok). Zemine, binaya ya da
yapıya değince patlar (en çok 30 sn). Yarıçap 40 m: düşman yapıya `260·(1 − d/40)` (d = patlama
noktasının kutuya uzaklığı, içerideyse 0), düşman uçağa `80·(1 − d/40)` (`WBomb`). Olaylar
`EvBombDrop{Plane: bombaID, By: sahibi, Pos, Vel}`, `EvBombHit{Plane: bombaID, By, Pos}`.
Bomba kimlikleri `1<<25`'ten başlar. Bırakma korumayı §3.6'daki gibi bitirir.

**Uçaksavar** (`sim/aa.go`): AA yapısı sağlamsa, kendisine 1500 m içindeki en yakın düşman canlı
uçağa her 20 tick'te bir mermi atar: hız 450 m/s, öne nişan (hedefin şu anki dönüşü sürer: hız burna `Slip` ile döner, rüzgâr eklenir;
karşılaşma süresi mermi uçuş süresinden birkaç kez yinelenir), eksen başına ±0.022 rad sapma (dünya PRNG'si), ömür 240 tick, hasar 7, silah `WAA`, sahibi 0.
Mermiler v1 mermi sistemini kullanır (`Bullet` alanları `Dmg`, `Weapon` eklenir). `EvFire{Plane: 0,
Other: yapıID, Weapon: WAA}` client'ta iz çizer. AA'nın öldürmesi kurbana −1 vermez [K13].

## 4. Haritalar (`internal/maps`, `internal/terrain`)

Oda ayarı **Harita**: `ada` (varsayılan), `sehir`, `col`, `dag` + seed. Her şey `(tür, seed)`'den
deterministik; ızgara v1 gibi 10 km × 10 km, 129 × 129 düğüm (78.125 m), oynanan alan ±4000 m.
Yükseklik quantize'ı (0.1 m) değişmez.

### 4.1 Üreteçler (`terrain/biomes.go`; `n`, v1 `noise`/`fbm`; `ss = smoothstep`)

- **ada:** v1 `Generate(seed)` formülü bit bit aynı (`IslandRaw`); `testdata/vectors/terrain.json`
  `Generate` için geçerli kalır.
- **sehir** (kıyı şehri):
  `plain = 12 + 18·fbm(x/2500, z/2500, 3)`;
  `hills = fbm(x/1200+11, z/1200−5, 4)^2.2 · 700 · ss(−2000, −3800, z)` (kuzeyde tepeler);
  `coast = ss(2600, 3600, z)` (güneyde deniz);
  `h = (plain + hills)·(1 − coast) − 40·coast`. Şehir bölgesi `x ∈ [−1500, 1500]`, `z ∈ [−1500, 2200]`.
- **col** (çöl):
  `dunes = 25·(0.5 + 0.5·sin((0.8x + 0.6z)/180 + 3·fbm(x/900, z/900, 2)))`;
  `m = fbm(x/1600+7, z/1600−3, 4)`; `mesa = ss(0.58, 0.62, m)·(220 + 120·fbm(x/500, z/500, 2))`;
  `c = |2·fbm(x/1100−9, z/1100+4, 3) − 1|`; `canyon = (1 − ss(0, 0.06, c))·90`;
  `h = max(6, 40 + dunes + mesa − canyon)`; vaha: merkez `(ox, oz) = ((r1−0.5)·1500, (r2−0.5)·1500)`
  (seed'li splitmix), `o = hypot(x−ox, z−oz)`, `h = min(h, lerp(−6, h, ss(120, 260, o)))`.
- **dag** (sıradağ):
  `ridge = 1 − |2·fbm(x/1300+3, z/1300−8, 5) − 1|`;
  `mount = ridge^2.2 · 2000 + fbm(x/600, z/600, 3)·250`;
  vadiler: `vW = 1 − ss(250, 900, |x + 2600|)`, `vE = 1 − ss(250, 900, |x − 2600|)`,
  `vC = 0.6·(1 − ss(250, 900, |z|))`, `v = max(vW, vE, vC)`; `h = 60 + mount·(1 − 0.9·v)`.

### 4.2 Üs yerleşimi ve düzleştirme (`maps/base.go`, `maps/flatten.go`)

Pist ekseni yalnızca dünya X veya Z'dir (tüm kutular eksen hizalı kalır) [K9]:

| Harita | NATO nominal merkez | Sovyet nominal merkez | Eksen | NATO iç yön | Sovyet iç yön |
|---|---|---|---|---|---|
| ada | (−2400, 0) | (2400, 0) | Z | +X | −X |
| sehir | (−2900, 0) | (2900, 0) | Z | +X | −X |
| col | (0, −2600) | (0, 2600) | X | +Z | −Z |
| dag | (−2600, 0) | (2600, 0) | Z | +X | −X |

- **Yer arama:** nominal merkez etrafında `dx, dz ∈ {−400, −200, 0, 200, 400}` (25 aday). Maliyet =
  ayak izi düğümlerinin yükseklik varyansı + 1000 × (yüksekliği `MinElev` altındaki düğüm sayısı).
  En küçük maliyet (eşitlikte ilk aday) seçilir.
- **Ayak izi** (yerel): `u ∈ [−1000, 1000]`, `v ∈ [−80, 360]`. Kot `elev = clamp(ortalama, 8, 350)`,
  sonra quantize edilmiş değere yuvarlanır (`(round((elev+500)·10))/10 − 500`).
- **Düzleştirme** (ham ızgarada, quantize'dan önce): ayak izi + 160 m pay içindeki düğümler `elev`;
  dışında `d` uzaklıktaki düğüm `lerp(elev, h, ss(0, 400, d))`. Pay ≥ 2 hücre olduğundan pist
  üstünde bilinear yükseklik tam `elev`'dir. Önce NATO, sonra Sovyet üssü düzleştirilir.
- **Yaklaşma koridoru** (yerel `u ∈ [−3400, −1160]`, `|v| ≤ 250`): ham yükseklik 2.9° süzülüş yolunun
  40 m altındaki `cap`'e indirilir, ama pist kotunun altına asla: `h = min(raw, max(cap, elev))`
  (kontrolör kararı N6; yazılı `max(cap, min(raw, elev))` alçak zemini yükseltiyordu, ilk biçim
  22 m hendek kazıyordu).

### 4.3 Üs düzeni (yerel `(u, v)`: `u` pist boyunca, `v` iç yöne; dünya = merkez + u·eksen + v·iç)

| Parça | u aralığı | v aralığı | Yüzey |
|---|---|---|---|
| Pist (1800 × 45 m) | ±900 | ±22.5 | Runway |
| Paralel taksi yolu | ±710 | 110..130 | Taxi |
| Bağlantılar | −710..−690 ve 690..710 | 22.5..110 | Taxi |
| Apron | ±300 | 130..210 | Taxi |
| Hangar zeminleri (6 adet, u = −250 + 100·i) | u_i ± 20 | 210..240 | Taxi |
| Üs sınırı (`Bounds`, ikmal/AA) | ±1000 | −80..360 | — |

Hangar kapısı `v = 210` (piste bakar); spawn noktası `(u_i, 226)`, yön `−iç` (piste doğru).
Taksi rotası (botlar ve rehber): kapı `(u_i, 205)` → apron çıkışı `(u_i, 120)` → taksi ucu
`(−700, 120)` → bekleme `(−700, 40)` → hizalanma `(−700, 0)`, yön `+u`; kalkış koşusu için 1600 m
pist kalır. İniş: eşik `(−850, 0)`, yön `+u`, yaklaşma noktası eşikten 2.5 km geride 125 m AGL (≈2.9° süzülüş). Nominal merkezler bu noktayı ve kalkış sonrası tırmanışı oyun alanı (±4000) içinde tutacak şekilde seçildi (X eksenli çöl üsleri `x = 0`'da).

Pist çizgileri, taksi kenarları, gece ışıkları client'ta bu tablodan çizilir.

### 4.4 Şehir binaları (`maps/buildings.go`, yalnız `sehir`)

Şehir bölgesinde 144 m adımla bloklar (120 m blok + 24 m sokak); blok başına 2 × 2 parsel, parsel
başına %70 ihtimalle bina (seed'li splitmix): taban `w, d ∈ [24, 44]`, parsel merkezinden ±6 m
kayma; `downtown = 1 − ss(0, 1600, hypot(x, z − 300))`; yükseklik `12 + r²·(25 + 140·downtown)`.
Taban kotu = merkezdeki zemin − 2 m. En çok `MaxBuildings = 1500` [K30]. Diğer haritalarda bina
yok (hangarlar ve yapılar her haritada var).

### 4.5 Welcome'daki harita bilgisi

`welcome.terrain` v1 gibi kalır. Yeni `welcome.map`:

```json
{ "kind": "sehir",
  "bases": [{ "side": "nato", "c": [x, y, z], "axis": [ax, az], "inner": [ix, iz],
              "areas": [[minX, minZ, maxX, maxZ, surf], ...], "hangars": [[x, y, z, heading], ...] }],
  "bld": [[minX, minY, minZ, maxX, maxY, maxZ], ...],
  "structs": [{ "id": n, "k": "hangar|fuel|radar|aa", "tm": "nato|soviet", "box": [6 sayı], "hp": max }] }
```

`bld` yalnız şehir binaları (hangar duvarlarını client sabitlerden çizer); sayılar 0.1 m'ye
yuvarlanır. `structs` yalnız üs modunda. Oda başına bir kez kodlanır (v1 arazi gibi).

## 5. Hava durumu (`internal/weather`)

Oda ayarı **Hava**. Raund içinde değişmez. Sunucu tarafı: kilit menzili çarpanı + rüzgâr; geri
kalanı görsel (client tablosu).

| Tür | Kilit × | Rüzgâr (m/s) | Esinti genliği | Sis (yakın / uzak, m) | Bulut (adet, taban–tavan m) | Işık |
|---|---|---|---|---|---|---|
| `acik` | 1.0 | 0 | 0 | 3000 / 14000 | 60, 1200–2400 | gündüz |
| `bulutlu` | 1.0 | 3 | 1 | 2000 / 11000 | 140, 700–1500 | gündüz × 0.8 |
| `sisli` | 0.6 | 0 | 0 | 600 / 3500 | 40, 900–1800 | gündüz × 0.7 |
| `yagmurlu` | 0.8 | 6 | 2 | 1200 / 7000 | 120, 600–1400 | gündüz × 0.6, yağmur |
| `firtina` | 0.7 | 10 | 6 | 800 / 5000 | 160, 500–1300 | × 0.45, yağmur + şimşek |
| `gece` | 1.0 | 2 | 0 | 1500 / 9000 | 30, 1200–2400 | gece: yıldız, ay, ışıklar parlar |

- Rüzgâr yönü: `a = 2π · splitmix(seed ^ 0x57494E44)`, `Wind = (cos a, 0, sin a) · hız`.
- Kilit menzili: `Spec.LockRange × LockMul` (sim `Config.LockRangeMul`, 0 → 1).
- Şimşek client'ta yerel PRNG ile 6–14 sn aralıkla (oyuncular arası eşzamanlı değil) [K26].
- `welcome.weather = { kind, wind: [x, y, z], gust, lockMul }`.

## 6. Modlar ve skor

- `team` ve `ffa` v1 gibi. Yeni: **`base` (Üs Saldırısı)** — takımlı varyant, takım başına 1–6,
  boş yerler bot. Kazanma: rakibin 6 yapısının hepsini yık; ya da **10 dk** sonunda kalan toplam
  yapı canı fazla olan; eşitse "Berabere". İki tarafın son yapısı aynı tick'te düşerse de
  "Berabere" (kontrolör kararı). Kill limiti yok [K25].
- `mode.Scoreboard` hedef canını izler: `SetObjective(nato, soviet float64)` (raund başında),
  `EvStructHit` → ilgili takımın canı düşer, `EvStructDown` → yıkana +2 skor. `ObjectiveHP(team)`.
- Ölüm puanı: saldıransız ölüm −1 (v1); **istisna:** `WAA` ile ölüm yalnızca ölüm sayar [K13].
- `game.Round` `WinnerTeam sim.Team` ve `WinnerID sim.ID` kazanır (istatistik için; isim
  çakışmasından bağımsız).

## 7. Botlar

- `bot.Env{Terrain *terrain.Map; Map *maps.Map; Mode mode.Kind; Wind geom.Vec3}` (`Wind` = havanın taban
  rüzgârı, hamlesiz); `Think(s *sim.Snapshot, env *Env) sim.Input`.
- **Pist başlangıcı** (durum makinesi, `bot/ground.go`): `Taxi` (rota noktaları, düzde hedef hız 25 m/s,
  köşeye 10 m/s ile girecek şekilde yavaşlar; sapma 25 m'den büyükse fren; noktaya 22 m kala
  sonrakine) → `LineUp` (pist yönüne dön, hız ≤ 10) → `Takeoff` (tam gaz + AB, rotate hızında pitch +1)
  → `Climb` (pitch hedefi 0.35 rad, 50 m AGL'de takım kapalı; 400 m AGL'nin üstünde daha dik ve harita
  kenarına yaklaşınca merkeze döner; 400 m AGL **ve** 2 km içindeki en yüksek zirvenin 200 m üstünde
  hava mantığına geçiş).
- **İkmale dönüş** (`bot/land.go`, `bot/approach.go`, `bot/runway.go`): füze 0 **ve** can < %50 **ve**
  2 km içinde havada düşman yok → `RTB` (yerdeki uçaklar — park, taksi, ikmal — sayılmaz; FFA'da üsteki
  her uçak düşmandır). Karar kilitlenir: füze yenilenmesi dönüşü iptal etmez; yalnız uçak hâlâ havadayken
  2 km'ye giren havadaki düşman dövüşe döndürür. Rota (pist ekseni `u`, eşikten ölçülür): dış bacağa katıl
  (eksenden ±200 m, alçak arazi tarafı; eşikten en az 1 km ileride) → dış bacak (−u yönü, eşikten 2.2 km
  öncesine kadar 0.25 eğimle 175 m'ye alçalış; arazi 8 sn ileride ve 250 m çevrede 120 m altta kalır,
  4 sn içinde 60 m'ye yaklaşan arazide ya da 2 sn içinde 30 m'ye yaklaşan bina/hangarda tam AB ile
  tırmanış) → merkez hattına doğru seviye dönüşle finale (yaklaşma koridorunun içinde) → süzülüş
  (≈2.9°, eşiğin 50 m ilerisine; hedef hız 100 m/s, eşiğe 3 km kala takım açık, taban rüzgârına karşı
  yengeç açısı: hava hızı = nişan·v − rüzgâr, 30 m altında kanatlar düz, 10 m AGL'de düzleşme). Pas
  geçme: eşiğe 600 m kala merkez hattından 12 m, süzülüşten +25/−15 m ya da pist yönünden 14°
  (`cos < 0.97`) sapmışsa; eşiğe 1.5 km kala pistte `u < 300` bölgesinde yerde başka uçak varsa. Hayat
  başına üç pas geçmeden sonra o hayatta yeniden dönüş yok (ikmal sayacı sıfırlar). Yönü pistle 45° içinde, süzülüşe inebilecek kadar alçak
  ve yakın bir uçak doğrudan finale girer → fren 45 m/s'ye → pist boyunca `u = +700` bağlantısından
  pisti boşaltır, taksi yolunda `u = +600`'de durup ikmal bekler (taksi yolu ve apron üs sınırı içindedir,
  §3.7) → taksi yolu ve bekleme noktası üzerinden kalkış başına.
- **Pist trafiği:** pistte hareket eden bir uçak, kalkış koşusu bölgesinde (hizalanma noktasından
  700 m ileriye kadar) duran bir uçak ya da 3 km içinde, 300 m AGL altında, piste hizalı bir uçak
  varken bot bekleme noktasında (`u = −700, v = 40`, pistin dışında) bekler; hizalanmışken de kalkış
  koşusuna başlamaz (yan yana iki uçakta küçük ID önce gider). Pistin uzak ucunda duran uçak engel
  sayılmaz. Bekleme en çok 25 sn sürer; sonra bot yine kalkar (duran uçağın içinden geçer, pist
  kazaları hasar vermez, §3.6).
- **Üs modu rolleri:** her takımın kendi uçakları ID sırasıyla dizilir; her ikinci uçak bombacı,
  diğerleri avcı (v1 saldırı mantığı) [K38]. Bombacı: bombası varsa en yakın sağlam düşman yapısına
  yaklaşma koridorundan 600 m AGL'de yaklaşır (sortie başına en çok 3 pas geçme, sonra avcı gibi dövüşür), balistik düşme noktası
  (`t`, `y(t) = zemin` çözümü) hedefe 30 m'den yakınken bırakır; bombası bitince "bomba 0 ve 2 km
  içinde düşman yok" ise ikmale döner (can koşulu yok), değilse avcı gibi dövüşür.
- Arazi kaçınma yerde çalışmaz; havada binalar da kaçınılır (öngörülen yol `Index.Sweep` ile).
- **Füze yükü ve savunma** (karar 72, `bot/missiles.go`): kolay IR, normal Karışık; zor duruma göre — gördüğü
  düşmanların yarısından çoğu yalnız IR taşıyorsa Radar (menzil üstünlüğü), değilse Karışık; her ölümde yeniden
  seçilir. Radar füzesi 1.5 km içinde (IR 1.2 km) tehdittir: zar (kolay 0.3, normal 0.7, zor 0.95) tutarsa bot
  flare atmaz, önce atana karşılık atar (atana kilidi kuruluyorsa ya da atan burnunun 30° içindeyse ve ona
  uçan füzesi yoksa burnu atanda tutar), sonra görüş hattına dik, yatay uçar (beam); IR'a karşı eski
  kaçış + flare. Kendi radar füzesi güdümdeyken hedefi burnunda tutar (power-up toplamadan önce).

## 8. Protokol v2

`protocol.Version = 2` (Go ve TS). v1 client'ı `hello` sürüm hatası alır (sayfa yenile).

**Client → sunucu (yeni/değişen):**
- `hello{v, name, tok?}` — `tok` 22 karakterlik base64url pilot token'ı (§10).
- `create{mode: team|ffa|base, size, diff, seed?, map?: ada|sehir|col|dag, wx?: acik|bulutlu|sisli|yagmurlu|firtina|gece,
  start?: pist|hava, vis?: acik|ozel}` — eksik alan varsayılanı: `ada`, `acik`, `hava` (FB-A 9), `acik` [K27]; geçersiz değer
  → `geçersiz oda ayarı`.
- `quick{}` — Hızlı Oyna (§9.2).
- `in{…, g?, br?, bo?}` — takım isteği, fren (basılı), bomba (tek sefer). Eski alanlar aynı.
- `chat{id: 1..6}` — hazır mesaj (§9.3).
- `pick{kind, lo?: ir|radar|mixed}` — füze yükü (§3.2); başka değer → `geçersiz mesaj`, yoksa yük değişmez.

**Sunucu → client (yeni/değişen):**
- `welcome{…, map, weather, start, tok?}` — `start` `pist|hava` (tekrar oynatmanın doğunca bitip bitmeyeceği için); `tok` yalnız sunucu yeni token ürettiyse.
- `AircraftInfo.rotateSpeed`.
- `snap.planes[]` yeni alanlar: `gr` (takım açık), `gd` (yerde), `rr` (ikmal 0..1), `bm` (bomba).
- `snap.bo[]` bombalar `{id, p, v}`; `snap.st[]` yapılar `{id, hp}` (yalnız üs modu, `omitempty`).
- `snap.planes[]` füze yükü (`omitempty`, IR'da hiçbiri yok): `lo` (1 radar, 2 karışık), `rm` (radar sayısı;
  `ms` IR sayısı), `lkk` (1: kilit radar için; `lp` o türün kilit süresine göre). `snap.missiles[].mk` ve
  `lock`/`mlaunch` olaylarında `mk` (1 radar). Ölçüm: 12 uçak, hepsi radar/karışık: +168 B (2415 → 2583 B).
- `snap.fx[]` yanan flare'ler `{id, p}` (`omitempty`; §3.2 Flare). `decoy` olayı: `a` füze, `b` hedefi, `o` atan, `p` flare.
- Olay türleri `k` += `rearm | bdrop | boom | shit | sdown | decoy`; silah `w` += `aa | bomb`; olay alanı
  `o` (sahip: `mlaunch` ve `bdrop` için atan uçak).
- `round` += `wt` (kazanan takım `nato|soviet`, varsa), `wid` (FFA kazanan ID), `obj{nato, soviet}`
  (üs modu kalan yapı canı).
- `chat{from, id}` — gönderenin ID'si, mesaj numarası.

Sınırlar: `MaxClientMsg = 1024` aynı; yeni alanlar `DecodeClient`'ta doğrulanır (bilinmeyen
`map/wx/start/vis` değeri `settings()` içinde reddedilir; `chat.id` 1..6 dışı → `geçersiz mesaj`).

## 9. Oda, lobi, Hızlı Oyna, sohbet

### 9.1 Oda ayarları ve görünürlük

`game.Settings` = `{Mode, Size, Difficulty, Seed, Map maps.Kind, Weather weather.Kind,
Start sim.StartMode, Listed bool}`. `Listed` (`vis=acik`) yalnız lobi listesi içindir; oyun
kullanmaz. Sıfır değerler: `Map=ada`, `Weather=acik`, `Start=hava` (yalnız Go içi varsayılan;
protokolden gelen eksik alan da `hava` olur).

### 9.2 Oda listesi ve Hızlı Oyna

- Oda actor'ı bir `room.Summary` (`Code, Mode, Map, Weather, Humans, Seats, Phase, LeftS, Listed, Seq`)
  yayınlar: katılma/ayrılmada ve her 60 tick'te `atomic.Pointer` ile (oda alanı, global değil).
  `Seats = rules.Slots()`, `LeftS = TicksLeft/60`, `Seq` lobi oluşturma sırası.
- `GET /api/rooms` → `{"rooms":[{"code","mode","map","wx","humans","seats","phase","left"}]}`,
  yalnız `Listed` odalar, sıralama: insan sayısı azalan, sonra en yeni. Yanıt 1 sn önbellekte.
- **Hızlı Oyna** WebSocket `quick` mesajıyla [K18]: lobi, `Listed` ve `Humans < Seats` odalardan
  insanı en çok olanı (eşitlikte en yeni) seçer ve katılır (katılma limitleri sayılır). Yarışta oda
  dolmuşsa ya da uygun oda yoksa varsayılan oda kurulur: `team`, takım başı 2, `normal`, rastgele seed,
  `ada`, `acik`, `hava` (FB-A 9; önce `pist`), `Listed` (kurma limiti sayılır).
- Ana sayfa listeyi 5 sn'de bir yeniler; her satırda "Katıl".

### 9.3 Hızlı sohbet

Mesajlar (ID → metin, Türkçe, client tablosu): 1 "Arkandayım!", 2 "Yardım lazım!",
3 "Hedefe saldırıyorum", 4 "Üsse dönüyorum", 5 "Tamam", 6 "Teşekkürler". Sunucu yalnız ID taşır
(serbest metin yok, moderasyon gerekmez). Takımlı/üs modunda yalnız takıma, FFA'da herkese.
Oyuncu başına 2 sn'de 1 mesaj; fazlası oda actor'ında sessizce düşer (bağlantı kesilmez) [K36].
Gösterim: kill feed alanında 5 sn. Tuşlar 1–6; mobilde sohbet düğmesi.

## 10. Kalıcı pilot profili

### 10.1 Token

- `pilot.New()`: 16 rastgele bayt (`crypto/rand`), base64url, dolgusuz (22 karakter).
- `pilot.Valid(tok)`: uzunluk 22, alfabe `[A-Za-z0-9_-]`, 16 bayta çözülür.
- `pilot.Hash(tok)`: `hex(sha256(tok))` — depoda ve bellekte yalnız özet; token ham hâliyle hiçbir
  yere yazılmaz, log'lanmaz, metrik etiketine girmez.
- `hello.tok` yok ya da geçersiz → sunucu yeni token üretir, `welcome.tok` ile yollar; client
  `localStorage["dogfight.pilot"]`'a yazar. HTTP'de yalnız `X-Pilot-Token` başlığıyla gelir (URL'de
  asla — log/Referer sızıntısı yok) [K19].

### 10.2 İstatistikler

Pilot başına: `name` (son kullanılan), `kills, deaths, crashes, wins, matches, fired, hits`,
`flight` (havada geçen tick), `kinds{kind: tick}` (en çok uçulan = favori), `week` (ISO hafta, UTC,
"2026-W41"), `weekKills`, `seen` (unix sn) [K20].

Oda actor'ı oturum başına sayar: `EvKill` (kurban: ölüm; `WCrash`/`WBounds` ve saldıransızsa
`crashes`; öldüren düşmansa `kills`), `EvMissileLaunch` (`By` → `fired`), füze `EvHit` (`Other` → `hits`),
her snapshot'ta canlı ve havadaysa `flight += 2`, `kinds[kind] += 2`. Raund bitişinde odadaki her
insan `matches++`, kazanan takım/ID ise `wins++` [K21]; sonra tüm sayaçlar `stats.Store`'a gider.
Kontrolör kararları (çiftlik önleme): `kills`/`weekKills` yalnız **insan** kurbanları ve yalnız
**listeli** (`vis=acik`) odalarda sayar (bot kill'leri pilot kartında `bk`); maç/galibiyet için
raundda ≥ 60 sn bulunmak ve en az bir kez havalanmış olmak gerekir (raund bitmeden ayrılmak maçı
silmez); `flight` yalnız havada ve yalnız `Playing` evresinde (raund sonu skor tablosu sayılmaz).
Aynı token'lı iki oturum (iki sekme) arasındaki kill kimseye yazılmaz. Depoda yeni pilot kaydı
ancak uçuşu ≥ 60 sn olan bir kayıtla açılır; var olan pilot her boş olmayan kaydı alır.
Liderlik tablosu dönemde 0 kill'li pilotu göstermez.
Ayrılmada ve oda kapanışında da gider.

### 10.3 Depo (`internal/stats`, yeni bağımlılık yok)

- Tek goroutine actor; `Record(Delta) bool` engellemez (1024'lük kanal, doluysa düşer ve
  `stats_dropped_total` artar).
- Dizin `-data` (üretimde `/data`, boşsa istatistik kapalı). Dosyalar: `pilots.jsonl` (günlük),
  `pilots.snap.json` (anlık görüntü). İzinler: dizin 0700, dosyalar 0600.
- Günlük satırı: `{"seq":n,"at":unix,"d":{Delta}}` (≤ 4 KB). Yazım bufio + her kayıt grubunda flush;
  fsync yalnız anlık görüntüde (en çok birkaç saniyelik kayıp kabul) [K31].
- Anlık görüntü: `{"v":1,"seq":sonUygulanan,"pilots":{özet: Pilot}}` → `*.tmp` yaz, fsync, kapat,
  `rename`, dizini fsync; sonra günlük sıfırlanır. Başlangıçta: anlık görüntü yüklenir, günlükte
  `seq > snap.seq` satırları uygulanır (yarım son satır yok sayılır). Böylece rename ile günlük
  kesme arasındaki çökme çift sayım yapmaz.
- Sıkıştırma: 10 dk'da bir ya da günlük 8 MB'ı geçince. Sınırlar: en çok 20 000 pilot (`MaxPilots`, bellek
  bütçesi; doluysa en eski `seen` çıkar), 180 günden eski `seen` sıkıştırmada silinir.

### 10.4 Uç noktalar

- `GET /api/leaderboard?period=week|all` → `{"period","week","top":[{"name","kills","deaths","wins","matches"}]}`,
  ilk 20 (week: bu haftanın `weekKills`'i, all: `kills`), 10 sn önbellek. Geçersiz `period` → 400.
- `GET /api/me` (başlık `X-Pilot-Token`) → `200 {"pilot":{…}}` kendi istatistiği + favori uçak; token yok/geçersiz/çok uzun/bilinmiyor → aynı gövde, başlık ve zaman sınıfıyla `200 {"pilot":null}` (ayırt edilemez; K2 kontrolcü kararı).
- İstatistik kapalıysa 503 `{"error":"istatistik kapalı"}`.
- Tüm `/api/*`: yalnız GET (HEAD), `Content-Type: application/json; charset=utf-8`,
  `Cache-Control: no-store`, adres başına 120/dk (patlama 30) ortak limit [K35], hata gövdeleri
  `{"error": "..."}`. CORS başlığı yok (yalnız aynı köken).

## 11. Gözlem (metrikler)

- Ayrı dinleyici `-metrics-addr` (boşsa kapalı; üretim `127.0.0.1:9090` — yalnız container içi
  loopback, edge ağında görünmez), yalnız `GET /metrics`, başka yol 404. nginx'e eklenmez, compose
  port yayınlamaz.
- Elle yazılmış Prometheus metin formatı (`internal/metrics`), `Registry` örneği `main`'de kurulur ve
  aşağı geçirilir (global yok):
  `dogfight_rooms`, `dogfight_humans`, `dogfight_bots`, `dogfight_conns` (gösterge);
  `dogfight_tick_seconds` (histogram, kovalar 1, 2, 4, 8, 12, 16.7, 25, 50 ms);
  `dogfight_tick_overruns_total` (> 16.7 ms), `dogfight_msgs_in_total`, `dogfight_msgs_out_total`,
  `dogfight_snap_drops_total`, `dogfight_stats_dropped_total`,
  `dogfight_rejects_total{reason}` (sabit küme: `conns-per-ip, conns-total, create-rate, join-rate,
  join-fail-rate, limiter-full, max-rooms, flood, api-rate`; bilinmeyen → `other`),
  `dogfight_api_requests_total{path}` (`rooms, leaderboard, me`), `go_goroutines`,
  `go_memstats_heap_alloc_bytes`.
- Her 60 sn tek satır özet log (`slog.Info("stats", rooms, humans, bots, conns, tick_p99_ms, overruns, drops)`).
- Distroless'ta curl yok: `-get URL` bayrağı gövdeyi stdout'a yazar →
  `docker exec dogfight /dogfight -get http://127.0.0.1:9090/metrics` [K23].

## 12. Client

### 12.1 Render

- **Paletler** (`render/palette.ts`): harita başına kum, alçak/yüksek çimen, kaya, kar, deniz tabanı,
  deniz rengi/opaklığı, kar çizgisi. `col`: deniz düzlemi opak kum rengi (ufuk), kar yok; `dag`:
  kar çizgisi 1100 m; `sehir`: çimen daha gri.
- **Üsler** (`render/bases.ts`): pist (koyu gri, beyaz orta çizgi kesikleri, eşik çizgileri — canvas
  doku), taksi/apron (açık gri), hangarlar (açık önlü kutu, çatı), gece kenar ışıkları (emissive
  noktalar, `toneMapped: false`).
- **Binalar** (`render/buildings.ts`): tek `InstancedMesh` kutu, örnek başına renk, flat shading.
- **İniş takımı** (`render/models/gear.ts`): 3 dikme + teker, `name = "gear"`; `PlaneRender.gear`
  görünürlüğü yönetir (kendi uçağım: tahmin; diğerleri: `gr`).
- **Hava** (`render/weather.ts`): sis/bulut/ışık tablodan; yağmur: kameraya bağlı 1500 çizgilik
  `LineSegments` (performans modunda 600); şimşek: ışık + gökyüzü parlaması 120 ms; gece: koyu
  gradyan, 800 yıldız (`Points`), soluk mavi ay ışığı, AB/iz/pist ışıkları zaten ton eşlemesiz.
- **Üs modu** (`render/structures.ts`): yakıt tankı (silindir), radar (kutu + dönen çanak), AA
  (kutu + namlu); yıkılınca kararır + duman; bombalar `Props`'ta; AA izleri turuncu tracer.

### 12.2 UI (DOM, `innerHTML` yok — v1 kuralı)

- **Ana sayfa:** isim, Hızlı Oyna, açık oda listesi (5 sn yenileme), liderlik tablosu (Hafta/Tüm
  zamanlar), "Pilot kartın" (token varsa `/api/me`), Oda Kur (Mod: Takımlı / Herkes Herkese /
  Üs Saldırısı; Boyut; Bot zorluğu; Harita; Hava; Kalkış: Pist/Havada; Görünürlük: Açık/Özel;
  Seed), Odaya Katıl.
- **HUD ekleri:** "TEKER" ışığı (açık yeşil, istenen ≠ gerçek iken yanıp söner), "FREN", ikmal çubuğu
  ("İKMAL %"), bomba sayısı (üs modu), kilit kutusunun yanında hedef uzaklığı ve menzil çubuğu
  (`uzaklık / (LockRange·lockMul)`), "MENZİL: x km" (uçağın etkin menzili [K12]), koni içinde menzil
  dışı düşman varsa "MENZİL DIŞI", gelen füze uyarısında en yakın füzenin uzaklığı ("FÜZE 1.2 km"),
  üs modunda üstte iki takımın yapı canı çubuğu.
- **Hızlı sohbet:** 1–6 tuşları; gelen mesaj kill feed'de `İsim: metin` (takım rengi), 5 sn.
- **Ayarlar:** şema (Fare / Klavye / Dokunmatik), füze kamerası (masaüstü açık, mobil kapalı),
  performans modu, eğimle nişan (yalnız dokunmatik), tuş listeleri (L, B, H, 1–6, R eklendi).
- **Düşman görünürlüğü (geri bildirim #1, madde 13):** düşman isim etiketi 1,2 km içinde ya da top
  hattının 8° içinde ve 3 km altında; düşman radar noktası yalnız 2,5 km içinde (dostlar ve üs
  hedefleri her zaman). **Bilinen sınırlama:** bu süzme yalnız görseldir; sunucu her snapshot'ta
  tüm uçakların konumunu her client'a göndermeye devam eder (değiştirilmiş bir client hepsini
  görebilir). Sunucu tarafı görünürlük süzmesi sonraya bırakıldı.

### 12.3 Mobil / dokunmatik

- `(pointer: coarse)` cihazda şema varsayılanı `touch`.
- Sol sanal çubuk: `(sx, sy)` birim disk, ölü bölge 0.12; `p = sy` (yukarı = burun yukarı, "Y ters"
  çevirir), `r = sx`; çubuk bırakılınca **asist**: otopilot kanatları düzler ve burnu ufka çeker
  (`steer(rot, yatay yön)`). Sol kenarda dikey gaz kaydırıcısı.
- Sağ düğmeler: ATEŞ (basılı), FÜZE, FLARE, AB (aç/kapa), TEKER, FREN (basılı), BOMBA (üs modu),
  SOHBET (6'lı menü).
- Eğimle nişan (isteğe bağlı, varsayılan kapalı): `DeviceOrientation` beta/gamma → çubuk; iOS'ta
  açarken `requestPermission()`.
- Dikey ekranda "Telefonu yan çevir" katmanı. HUD 700 px altında küçülür (radar 120 px, yazılar
  %80). Performans modu (mobilde varsayılan açık): piksel oranı 1, parçacık kapasitesi yarı, bulut
  yarı, yağmur 600.

### 12.4 Füze kamerası, killcam, izleyici, tekrar

- **Füze kamerası:** kendi `mlaunch`'ım (`o == you`) sonrası ekranın alt ortasında %25 genişlikte
  pencere (16:9), füzeyi 20 m arkadan izler; `mgone` ya da 6 sn sonunda kapanır. Ayarla kapanır;
  mobilde varsayılan kapalı. İkinci kamera + `setViewport/setScissor` ile aynı sahne.
- **Killcam:** ölünce kamera öldüreni (interpolasyonlu) yeniden doğana kadar izler; öldüren yoksa
  ölüm noktası etrafında döner. HUD: "İzliyorsun: <isim>".
- **İzleyici:** katılıp uçak seçmemiş oyuncu genel görünüm yerine canlı bir uçağı izler; tık / ← →
  ile değiştirir [K24].
- **Tekrar:** client snapshot halka tamponu (son 10 sn, 30 Hz; uçak konum/yönelim/canlılık + füzeler).
  Yeniden doğma beklerken "Tekrarı izle (R)"; oynatma kendi uçağımı ölümden 10 sn önceden izler;
  R/Esc ile geçilir. Oynatma sürerken input kilitli; `hava` kalkışında doğunca kendiliğinden biter,
  `pist`'te hangarda park hâlindeyken sürebilir [K22]. Sunucu değişikliği yok.

## 13. Güvenlik

| Yüzey | Önlem |
|---|---|
| `/api/rooms`, `/api/leaderboard`, `/api/me` | yalnız GET/HEAD; adres başına 120/dk ortak limit (v1 `limit.Keyed`, `-trust-proxy` ile gerçek IP); yanıt önbelleği (1 s / 10 s) sorgu maliyetini sabitler; JSON üretimi `encoding/json` (kaçışlı); CORS yok; `no-store`; sorgu parametresi yalnız `period` (beyaz liste) |
| Pilot token | 128 bit `crypto/rand`; yalnız SHA-256 özeti saklanır; log/metrik/URL'de yok; HTTP'de başlıkla; geçersiz biçim reddedilir (sabit uzunluk, alfabe); token tahmini 2^128 |
| İstatistik deposu | tek actor; satır ≤ 4 KB; isim `CleanName` sonrası (16 rune); pilot sayısı ve günlük boyutu sınırlı; dosya 0600, dizin 0700; atomik rename + seq ile çökme güvenli; bozuk satır atlanır, süreç düşmez |
| Hızlı sohbet | yalnız 1..6 ID, serbest metin yok; 2 sn'de 1 (oda), bağlantı başına genel mesaj limiti (v1) sayılır |
| Oda listesi | yalnız `Listed` odalar; kodu gizli oda listelenmez; isim yok, yalnız sayılar |
| `quick` | katılma ve kurma limitleri aynen (yarış durumunda kurma token'ı iade kuralı v1 gibi) |
| Metrik dinleyicisi | ayrı port, yayınlanmaz, nginx'te yok; etiket kümeleri sabit (kardinalite patlaması yok); IP/isim/token içermez; zaman aşımları (`ReadHeaderTimeout` 5 sn) |
| `/data` hacmi | kök FS read-only kalır; yalnız `/data` yazılabilir; uid 65532 |
| Dokunmatik/eğim | `Permissions-Policy` `accelerometer=(self), gyroscope=(self)` eklenir; kamera/mikrofon/konum kapalı kalır |
| Yeni input alanları | `g/br/bo` bool; `chat.id` aralık kontrolü; `create` alanları beyaz liste; CSP değişmez (`connect-src 'self'` fetch'i kapsar) |

## 14. Test ve doğrulama

- v1 testlerinin hepsi geçer; v1 uçuş vektör senaryolarının checkpoint'leri bayt bayt aynı kalır.
- **Yeni ortak vektörler:** `flight.json`'a 6 senaryo (taksi dönüşü, kalkış koşusu, iniş, fren,
  takım sürüklemesi/zorla kapanma, rüzgâr) + `wind` örnekleri; `maps.json` (4 harita × seed 1:
  üs düzenleri + 40 nokta için yüzey ve zemin yüksekliği) — TS `surfaceAt` ve `heightAt` doğrular.
- **Go birim:** yenileme, takım kuralları, zemin adımı, iniş geçerliliği, hangar spawn/koruma, ikmal,
  bina çarpışması, yapılar, bomba, AA, üs kuralları, harita üreteçleri (şekil özellikleri), düzleştirme,
  indeks, token, depo (çökme/kurtarma, seq), API (limit, önbellek, 404/400/503), metrik çıktısı.
- **Headless:** bot hangardan 60 sn içinde havada (4 harita × 3 seed); bot iniş + ikmal (5 seed'in en az
  4'ü); pistli 2v2 4 dk maç (3 seed ortalaması; pistte her ölüm hangar, taksi ve tırmanışla ~75 sn
  sürdüğü için 3 değil 4 dk): kill ≥ 5, bot başına çakma < 0.5/dk; üs modu 3v3 10 dk: en az bir yapı yıkılır.
- **Denge:** `-balance` %38–62 (kontrolör kararı, §3.1).
- **Uçtan uca:** Chrome masaüstü + mobil emülasyon (Playwright): Hızlı Oyna → hangar → kalkış → iniş →
  ikmal; dört harita × iki hava ekran görüntüsü; konsol hatasız; `/api/*` yanıtları; metrik `-get`.

## 15. Deploy

- `deploy/compose.yml`: `-data=/data`, `-metrics-addr=127.0.0.1:9090` bayrakları; adlı hacim `dogfight-data:/data`;
  `read_only: true` kalır; port yayını yok.
- `Dockerfile.runtime`: `/data` dizini imajda uid 65532'ye ait oluşturulur (aynı sabitlenmiş distroless
  imajından `COPY --from=… --chown=65532:65532 /home/nonroot /data`, imajda mod 0755); adlı hacim ilk
  bağlanışta bu sahipliği kopyalar; 0700 modunu sunucu açılışta `chmod` ile verir [K32]. Sunucu açılışta yazılabilirliği dener; yazılamazsa istatistiği kapatıp
  `stats disabled` log'lar (oyun çalışır).
- `scripts/deploy.sh` yalnız sağlıklı başlangıçtan sonra log'da `stats disabled` görürse uyarı basar.
  README: yeni bayraklar, `/data` yedeği (`docker run --rm -v dogfight-data:/data:ro … busybox@sha256:… tar`;
  canlı yedek bir sıkıştırmaya denk gelirse son dakikaları kaçırabilir — tutarlı kopya için durdur),
  metrik okuma komutu.

## 16. Uygulama sırası ve yayın noktaları

Gruplar: A sim çekirdeği → B haritalar → C zemin modeli → D hava → E botlar → F üs saldırısı →
J render → G protokol/oda/lobi → H kalıcılık → I gözlem → K UI → L mobil → M kameralar → N deploy.
J, G'den önce gelir: oda ayarları açılmadan önce üsler, binalar ve takım görünür olmalıdır (aksi
hâlde görünmez binaya çarpılır). Her grup sonunda oyun derlenir, testler geçer ve yayınlanabilir;
önerilen yayın noktaları: A, B, C+D, E+F, J, G+H+I, K+L, M+N.

## 17. Kararlar

Kontrolör kararlarının açık bıraktığı noktalar için verilen kararlar:

1. **Takım input'u istenen durumdur** (`in.g`), tetikleyici olay değil; 140 m/s üstünde istenirse
   yavaşlayınca kendiliğinden açılır. Kopan input'ta durum korunur.
2. Takım açılıp kapanması sim'de anlık; animasyon yalnız görsel.
3. Park = gaz 0 (zemin düz, kayma yok); pist spawn'ında ilk gaza kadar park freni [K41]. HUD "FREN" B basılıyken ve park freni tutarken.
4. Yerde itki ×0.3 (aksi hâlde 48 m/s² ile 60 m'de kalkılıyordu); F-16 tam gazda ≈ 8.5 sn / 410 m, art yakıcıyla ≈ 4.5 sn / 210 m koşu (burun tam yukarıda).
5. Temasta burun açısı `LiftoffPitch/2`'ye kırpılır (sekme yok); pitch tutulursa yeniden kalkar.
6. Taksi yolu, apron ve hangar zemini tek yüzey türü (`SurfTaxi`), sınır 35 m/s (FB-A düzeltme turu 2; önce 30).
7. Rüzgâr yalnız havadaki uçağın konumunu kaydırır; mermi, füze, bomba ve yerdeki uçak etkilenmez.
8. Client rüzgâr tahmini tick'i `snapTick + 1 + i` ile kestirir; fark reconcile ile düzelir.
9. Pist ekseni yalnız dünya X ya da Z (kutular eksen hizalı); harita başına eksen §4.2 tablosu.
10. Üs düzeni sabitleri §4.3 tablosundaki gibi (6 hangar, 100 m aralık).
11. FFA'da üs `ID % 2`; ikmal herhangi bir üste yapılabilir.
12. Füze "menzili" HUD'da `LockRange × lockMul` olarak gösterilir (kilit bu menzil dışında oluşmaz).
13. AA ile ölüm kurbana −1 vermez (yalnız ölüm).
14. Yapı yıkan pilota +2 skor (kill sayılmaz).
15. Yıkılan hedef-hangar spawn'a kapanır; tüm hangarlar dolu/yıkıksa üs üstünde havada doğulur.
16. Binaya giren mermi sunucuda sessizce biter; client izleri bina kırpması yapmaz.
17. Bina çarpışmasında uçak küresi 5 m (uçak-uçak 9 m'den küçük, hangardan çıkışa izin verir); büyütülmüş
    kutu köşelerde muhafazakâr.
18. Hızlı Oyna HTTP değil WebSocket `quick` mesajıdır (tek gidiş, mevcut limitler).
19. Token yalnız yeni üretildiğinde `welcome.tok` ile döner; HTTP'de `X-Pilot-Token` başlığı.
20. Haftalık tablo ISO hafta, UTC; pilot yalnız bu haftanın sayacını tutar (geçen hafta silinir).
21. Maç = raund sonunda odada olmak, raundda ≥ 60 sn ve en az bir kez havalanmış; galibiyet `Round.WinnerTeam`/`WinnerID` ile.
22. Tekrar yalnız ölü beklerken başlatılır; `hava`'da doğunca biter, `pist`'te park hâlinde sürebilir.
23. Metrik okuma için `-get URL` bayrağı (distroless'ta curl yok).
24. Seçim bekleyen oyuncu izleyici kamerasıyla canlı uçak izler; tık / ← → değiştirir.
25. Üs saldırısında kill limiti yok, süre 10 dk.
26. Hava tablosu sayıları §5; şimşek client'ta yerel, eşzamansız.
27. `create`'te eksik alan varsayılanı `ada / acik / hava / acik` (FB-A 9; önce `pist`); Go içi sıfır değer `Start=hava`
    (testler ve denge düelloları için).
28. Bomba sayıları §3.10 (2 adet, 40 m, 260/80 hasar, yerçekimi 14).
29. Pistten doğan uçakta ateş korumayı 2 sn'ye indirir; havadan doğanda v1 gibi hemen bitirir.
30. Binalar yalnız `sehir`'de, en çok 1500.
31. Depo: seq'li günlük, 10 dk / 8 MB sıkıştırma, fsync yalnız anlık görüntüde.
32. `/data` sahipliği imajda (distroless `/home/nonroot`'tan `COPY --chown`, 0755); 0700'ü sunucu açılışta verir; yazılamazsa istatistik kapalı,
    oyun açık. Deploy'da doğrulanır (plan Task 68).
33. Metrik etiketleri sabit kümeler.
34. Oda listesi sırası: insan sayısı azalan, sonra en yeni.
35. `/api/*` adres başına 120/dk, patlama 30, tek ortak limit.
36. Sohbet fazlası oda actor'ında sessizce düşer (bağlantı kesilmez).
37. Yapı canları §3.10 tablosu.
38. Üs modunda bot rolü takım içinde ID sırasıyla her ikinci uçak bombacı (ID paritesi tüm bombacıları bir tarafa veriyordu).
39. Rotate hızları 78 / 82 / 75 / 85 m/s.
40. Protokol sürümü 2; `in` mesajına yeni alanlar `g`, `br`, `bo`; `welcome.terrain` korunur, harita ek
    bilgisi `welcome.map`'te.

### 17.1 Uygulama sırasında verilen kontrolör kararları (spec davranışını değiştirenler)

Kayıt: `.superpowers/sdd/2026-10-07-dogfight-v2/progress.md` (`Ruling:` satırları). Gövdedeki ilgili
bölümler bu kararlara göre güncellendi.

41. **Pist spawn UX:** park freni ilk gaza kadar (0.5 sn tolerans), taksi yüzeyinde itki valisi, takip
    kamerası hangar/bina kutularıyla çarpışıp yaklaşır (§3.6, §3.4).
42. **Yükler ve kilit menzili:** F-16 5 füze (diğerleri §3.1); `LockRange` F-16 900, F-15 1075,
    MiG-29 950, Su-27 1050 m (FB-A sonrası, §3.1).
43. **Denge bandı** %38–62 (eşleşme başına ~60–70 sonuçlanan düello, SE ≈ 6 puan; §3.1, §14).
44. **Bot taksisi** düz bacakta 25 m/s, köşede 10 m/s (spec ilk hâli 12; 60 sn'de havada hedefi için, §7).
45. **Pistli maç kalite testi 4 dk** (3 seed ortalaması; pistte her ölüm ~75 sn, §14).
46. **Ram yok:** korumalı (yer koruması — yalnız kendi üssünde yerdeyken — ya da spawn koruması) ya da tekerleri yerde olan uçak içeren çift
    çarpışmaz — hasar ve kill yok (§3.6).
47. **İkmal ateşle sıfırlanır:** top/füze atışı `RearmTicks`'i 0 yapar (§3.7).
48. **Taksi valisi 28 m/s** pist dışındaki her zeminde (taksi yolu, apron, hangar, çimen), AB dahil (§3.4).
49. **Çimen ve taksi sınırı 35 m/s** (önce 30; §3.4, karar 6).
50. **Atalet ve asimetri:** `PushRatio = 0.55`, `PitchAccel = YawAccel = 2.5`, `RollAccel = 3.0` (§3.0).
51. **İndüklenmiş sürükleme 0.2** (test bandı 20–35 m/s açık; MiG-29 20, §3.0).
52. **AB ısısı:** 15 sn kesintisiz AB kilitler, 0.3'te açılır (§3.0).
53. **Füze yenilemesi** yalnız yükün yarısına kadar, 45 sn'de +1; flare 20 sn'de +1 (§3.2).
54. **Kalkan power-up'ı kaldırıldı** (§3.2).
55. **Tekerdeki uçağa kilit yok;** uçuştaki füze hedefi ancak hedef ≥ 1.5 sn kesintisiz tekerdeyse
    kaybeder (dokun-kalk istismarı kapalı; §3.2).
56. **Varsayılan kalkış `hava`,** takımlar haritanın iki ucundan; spawn → merkez yolu araziden
    ≥ 150 m (§3.6).
57. **`/api/me`** her eksik/bozuk/çok uzun/bilinmeyen token için aynı `200 {"pilot":null}`; bilinen →
    `200` pilot; istatistik kapalı → 503 (numaralandırma yok, konsol gürültüsü yok; §10.4).
58. **Liderlik:** yalnız insan kurbanlar, yalnız listeli odalarda; dönemde 0 kill'li pilot listelenmez (§10.2).
59. **Maç/galibiyet:** raundda ≥ 60 sn + en az bir kez havalanmış; uçuş süresi yalnız havada (§10.2).
60. **Bombacılar:** takım içinde her ikinci uçak; 600 m AGL, yaklaşma koridoru, sortie başına 3 pas
    geçme (§7, karar 38).
61. **Uçaksavar ayarı:** öne nişan rüzgârı ve hedefin dönüşünü katar, ±0.022 rad sapma, hasar 7;
    1.5 km içinde 20 sn oyalanan uçak ortalama canının ~%30–50'sini kaybeder; korumalı/tekerdeki
    uçağa ateş etmez (§3.10).
62. **Bina kutusu üstü** `zemin + yükseklik` (2 m uzun; §3.9).
63. **Yaklaşma koridoru tavanı** `h = min(raw, max(cap, elev))` (§4.2).
64. **Bomba patlaması** korumasız, tekerdeki düşman uçağa da hasar verir (düşman pistini bombalamak
    geçerli taktik; §3.10).
65. **Aynı tick'te iki üssün son yapısı düşerse beraberlik** (§6).
66. **Hızlı Oyna'da join token'ı yoksa** "çok fazla deneme, biraz bekle" (§9.2).
67. **Sunucu her uçağı göndermeye devam eder** (FB-B madde 13): görüş/mesafe süzmesi yok — bilinen sınırlama.
68. **Yer koruması yalnız kendi üssünde** (sahip kararı geri getirildi): tekerle üs sınırından çıkan
    korumasız kalır; hangar dolu olduğu için havaya düşen değiştirme 2 sn korunur (§3.6).
69. **İstatistik yalnız `Playing` evresinde sayılır:** raund sonu skor tablosunda uçuş süresi ve
    "en az bir kez havalanmış" bayrağı ilerlemez (§10.2).
70. **Aynı token'lı kill hiçbir şey saymaz** (iki sekme, tek pilot); **yeni pilot kaydı** yalnız
    tek kayıtta uçuş ≥ 60 sn ile açılır — ölüm ya da kill tek başına kayıt açmaz (§10.2).
71. **Flare yeniden tasarımı** (sahip/oyuncu geri bildirimi "flare işe yaramıyor"; 2026-10-06): flare 2.5 sn yanan
    sim nesnesi; izleyen her füze yanan flare'e 900 m'de (füze, flare) çifti başına bir kez %65 zar atar
    (önce: yalnız bırakma anında 600 m, son ~1.3 sn); aldatılan füze flare'i kovalar, flare'de ya da
    sönüşte hasarsız biter; `EvDecoy`/`decoy` olayı, "FÜZE ATLATILDI!" / "Füzen flare'e kandı" geri
    bildirimi; HUD FLARE! ipucu (< 800 m); botlar 800 m içinde saniyede bir flare. Bedel: füzeler zayıfladı
    (bot maçında füze isabeti ~%47 → ~%28; `TestBotsPlayARealMatch` taban 15 → 10 kill/3 dk). §3.2.
72. **Füze yükleri** (sahip isteği "farklı füze seçenekleri"; 2026-10-06): seçim ekranında IR (kısa menzil) /
    Radar (orta menzil; ×2.2 kilit menzili, 2 sn kilit, ⌊n/2⌋ ≥ 1 adet, yarı aktif 60°, flare'e bağışık, 1.5 sn
    beam'le kopar) / Karışık (⌊n/2⌋ IR + 1 radar; füze tuşu IR menzili dışında radar atar). Yenileme, power-up ve
    ikmal tür başına. HUD: türlü sayım, kilit kutusunda tür ve türün menzil çubuğu, FÜZE UYARISI'nda tür, radar
    için **DİK UÇ!**; radar füzesi ince mavi-beyaz iz. Denge için radar hasarı 50 (uygulayıcı kararı) ve bot
    karşılık atışı (§3.2, §7).
