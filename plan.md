# GNOME Todo Extension — Plan

Teknik hedef: GNOME Shell 46, ESM, X11. Kod dili: İngilizce.
Depolama: `~/todo.md` (markdown checkbox; başlıklar/notlar korunur).

## Faz 1 — Çekirdek (panel menüsü: göster/ekle/sil/check-uncheck)

- [x] 1. İskelet: metadata.json + extension.js + minimal panel düğmesi
- [x] 2. storage.js — `~/todo.md` okuma/ayrıştırma (satırları koru)
- [x] 3. storage.js — yazma (checkbox güncelle, başlık/not koru, yeni görev sona)
- [x] 4. logic — storage içinde (A seçeneği): addTask / deleteTask / toggleTask
- [x] 5. UI — menüde görev listesi + tıklanabilir check/uncheck (Ornament.CHECK)
- [x] 6. UI — üstte St.Entry ile ekleme (Enter ile)
- [x] 7. UI — satır başına sil düğmesi (St.Button) — ikon boyutu polish backlog'a alındı
- [x] 8. Entegrasyon + elle test + commit

## Polish (fonksiyonel faz bittikten sonra)

- [x] Sil düğmesi çöp kutusu ikonunu menü boyutuna uydur (stylesheet.css / ikon ikon boyutu)
- [x] Sil düğmesini satırın en sağına yasla (Clutter x_expand + ActorAlign)

## Eklenen iyileştirmeler (Faz 1 sonrası)

- [x] Canlı dosya izleme: `~/todo.md` dışarıdan değişince menü anında yenilenir (Gio.FileMonitor)
- [x] Tamamlanan görevlerin üzeri çizilir (strikethrough) + soluklaştırılır (actor opacity)

## Faz 1.5 — Yerinde görev düzenleme (Faz 2 öncesi)

- [x] UI: satıra edit butonu (`document-edit-symbolic`) → satır yerinde St.Entry'e dönüşür
- [x] Tek-edit invariant: `_editingIndex` TEK state alanı; satır bazlı local state YASAK.
  Şu eylemler açık düzenlemeyi kapatır: başka edit butonu (replace), add-entry
  fokus, toggle, delete, add, menü kapanması, harici dosya değişimi.
  → Birden fazla açık edit kutusu yapısal olarak imkansız.
- [x] Enter = kaydet (boş metin = iptal); Escape GNOME native (menü kapatır,
      invariant edit'i iptal eder — capture fazında yakalanıyor)
- [x] Test (unit + smoke + manuel) + commit

## Faz 2 — Kategorizasyon, sıralama, etiketler (kaynak: faz2_plan.md)

Öncelik değişikliği (2026-09-14): Eski Faz 2 (bildirimler + arşivleme) ilk öncelik
olmaktan çıktı; Faz 2 artık bu bölümdeki özellikler (kullanıcı kararı).

Bu fazda mevcut CRUD (ekleme/işaretleme/güncelleme/silme) üzerine
kategorileştirme, aynı kategori içinde manuel sıralama ve serbest etiket (tag)
desteği ekleniyor.

### Kilitlenmiş tasarım kararları

Aşağıdaki kararlar tartışılıp kilitlendi — sorgulamadan temel alınır.

- **Dosya yapısı:** `#` tek satır doküman başlığı (içeriği önemsiz, sadece
  marker). Her `## Kategori Adı` bir kategori. Her kategori altındaki
  `- [ ] metin @tag(değer) ...` bir görev.
- **Kategorisiz görev yok:** `##` görülmeden önce rastlanan görev satırları
  otomatik olarak "Genel" kategorisine düşer. Serialize ederken "Genel" her
  zaman gerçek bir `## Genel` başlığı olarak yazılır (kullanıcı elle yazmamış
  olsa bile) — böylece dosya her zaman tutarlı ve elle düzenlemeye açık kalır.
- **Sıralama = satır pozisyonu.** Ayrı bir "order" / "priority index" alanı YOK.
  Bir görevi taşımak, o kategorinin task dizisinde index swap yapıp dosyayı
  yeniden yazmaktan ibaret.
- **Cross-category taşıma bu fazda yok.** Sadece aynı kategori içinde
  yukarı/aşağı.
- **Tamamlanan görev yerinde kalır**, sadece `[ ]` → `[x]`. Ayrı bir
  "Tamamlandı" bölümüne taşınmaz.
- **Etiketler tamamen serbest.** Parser `@(\w+)\(([^)]+)\)` kalıbına uyan HER
  şeyi bir key-value çifti olarak yakalar. Kodda `due`, `start` gibi sabit bir
  whitelist YOK — bilinmeyen bir tag adıyla karşılaşınca onu atmaz, olduğu gibi
  saklar ve geri yazar.
- **Tag sırası korunur:** Bir görevin etiketleri düz bir obje değil,
  `[[key, value], ...]` şeklinde sıralı bir liste olarak tutulmalı (JS obje key
  sırası garantili değildir, bu da dosyada anlamsız tag sırası kaymalarına yol
  açabilir).
- **Atomic write zorunlu.** Dosyanın tamamı her yazımda yeniden üretiliyor (bu
  normal ve sorun değil, veri boyutu çok küçük) ama yazma sırasında yarıda
  kesilme riskine karşı `Gio.File.replace_contents_async()` (veya eşdeğer güvenli
  replace deseni) kullanılmalı. Doğrudan truncate-and-write YOK.
  (2026-09-14 kararı: mevcut sync `replace_contents` temp+rename ile bu şartı
  zaten sağlıyor — async'e geçilmiyor.)
- **Uyumsuz satırlar korunur (2026-09-14 kararı):** Görev olmayan satırlar
  (notlar, düz liste öğeleri vb.) kategorilerine bağlı saklanır, serialize'da
  aynen geri yazılır, UI'da gösterilmez — sıfır veri kaybı. Her `##` satırı bir
  kategoridir (örn. mevcut `## Notes` bir kategori başlığı olur).
- **H1 eksikse eklenir (2026-09-14 kararı):** Dosyada `#` başlığı hiç yoksa
  serializer `# TODO` satırını ekler.
- **Checkbox normalize edilir (2026-09-14 kararı):** Parser `[x]` ve `[X]`
  ikisini de kabul eder; serializer her zaman küçük harf `[x]` yazar.
- **Tag key regex ASCII kalır (2026-09-14 kararı):** `@(\w+)\(([^)]+)\)` aynen
  kullanılır; Türkçe karakterli tag key kullanılmayacak (değer tarafı serbest).

### Bu fazda UI'da OLMAYACAK ama altyapı buna hazır olmalı

- **Kategori ekleme UI'ı bu fazda yok.** Ama kategori listesi
  (`Document.categories`) üzerinde ayrı, izole bir `addCategory(name)`
  fonksiyonu/metodu bulunmalı — henüz hiçbir buton onu çağırmasa bile, kod
  içinde bağımsız var olsun. İleride bir "+" butonu eklemek sadece bu
  fonksiyonu UI'a bağlamak olmalı, veri modelini yeniden yazmak olmamalı.
- **Tag ekleme UI'ı bu fazda yok.** Ama görev nesnesinin `tags` alanı zaten
  yukarıdaki sıralı liste yapısında olduğu için, ileride bir "tag ekle" formu
  sadece bu listeye yeni bir `[key, value]` push etmesi yeterli olacak şekilde
  tasarlanmalı.

### Mimari notlar (mevcut proje kurallarına uyum)

- Parser/serializer `storage.js` içinde saf fonksiyonlar; mevcut mutasyon
  fonksiyonları (addTask/deleteTask/toggleTask/editTask) parse → mutate →
  serialize sarmalayıcısı olarak kalır, string-in/string-out imzası korunur.
- UI ince kalır; `_editingIndex` tek-edit invariant aynen geçerli (yeni ↑/↓
  butonları dahil tüm satır aksiyonları açık düzenlemeyi kapatır).
- Byte-byte round-trip hedefi için görev satırının tag'lerden önceki ham metni
  ayrıca saklanmalı (yeniden birleştirmede boşluk kaymasın).

### Uygulama adımları (sırayla, her biri ayrı test + commit)

- [ ] 1. **Parser (okuma)** — Örnek bir `.md` dosyasını yukarıdaki kurallara
      göre `Document { categories: [{ name, tasks: [{ text, done, tags }], extras }] }`
      yapısına çevir ("extras" = görev olmayan satırlar; aynen korunur, UI'da
      gösterilmez). H1 satırı ham haliyle saklanır (içeriği yok sayılır ama
      round-trip için geri yazılır). "Genel" fallback davranışını dahil et.
      /goal: H1, birden fazla H2, tag'li/tag'siz görevler ve ilk `##`'den önceki
      görevler içeren elle hazırlanmış bir test dosyası doğru parse ediliyor
      (doğrulama: saf storage kodu — run_tests.mjs unit testi yeterli).
- [ ] 2. **Serializer (yazma)** — Yukarıdaki yapıyı geri markdown metnine çevir.
      Kategori/görev sırası ve tag sırası birebir korunmalı.
      /goal: değişiklik yapılmadan parse → serialize edilen bir dosya,
      orijinaliyle byte-byte aynı çıkıyor (round-trip testi).
- [ ] 3. **Atomic write doğrulaması** — Mevcut sync `Gio.File.replace_contents`
      yolu atomiktir (temp+rename; docs.gtk.org + /tmp rename deneyi). Async'e
      geçilmez; mevcut yazma, serializer'a bağlanır; atomiklik belgelenir
      (docs/verified-apis.md) ve truncate-and-write olmadığı test edilir.
      /goal: yazma sırasında (simüle ederek) kesinti olsa bile orijinal dosya
      yarım/bozuk kalmıyor; normal yazımlar da çalışmaya devam ediyor.
- [ ] 4. **"Genel" fallback davranışı** — UI'dan kategori seçmeden eklenen görev
      "Genel" altına düşsün ve dosyada gerçek bir `## Genel` başlığı olarak
      yazılsın.
      /goal: kategori seçmeden eklenen bir görev, kaydedilen dosyada `## Genel`
      altında görünüyor.
- [ ] 5. **Kategori başlıkları menüde** — (faz2_plan.md'de ayrı adım olarak
      yazmıyordu, tamamlayıcı eklendi) Her `## Kategori` menüde tıklanamaz bölüm
      başlığı olarak görünür; görevler kendi kategorisi altında gruplanır. Kullanılan
      PopupMenu deseni 46.0 kaynağından doğrulanacak.
      /goal: iki kategorili dosyada başlıklar doğru sırada, görevler doğru
      grupta görünüyor.
- [ ] 6. **Yukarı/aşağı taşıma** — Her görev satırının yanına ↑/↓ butonu ekle;
      tıklanınca ilgili kategorinin task dizisinde index swap yap, sonra kaydet.
      Kategorinin ilk öğesinde ↑, son öğesinde ↓ pasif/gizli olmalı.
      /goal: 5 görevlik bir kategoride 3. görevi iki kez yukarı taşımak onu
      1. sıraya getiriyor — hem UI'da hem kaydedilen dosyada satır sırası
      doğrulanıyor.
- [ ] 7. **Genişletilebilirlik iskeleti** — `addCategory(name)` fonksiyonunu
      (henüz UI'sız) ve tag listesine push eden bir yardımcı fonksiyonu ekle;
      ikisi de mevcut UI'dan çağrılmasa bile izole şekilde var olsun.
      /goal: Looking Glass üzerinden veya geçici bir test çağrısıyla
      `addCategory("Test")` ve tag push fonksiyonu, UI'a hiç dokunmadan manuel
      çağrılıp doğrulanabiliyor.

### Manuel test checklist'i (her adımdan sonra değil, faz sonunda genel geçiş)

- [ ] Boş dosyadan ilk görevi ekle → "Genel" altına düştü mü?
- [ ] Dosyaya elle `## İş` ekleyip extension'ı yeniden yükle → yeni kategori
      doğru okunuyor mu?
- [ ] Tag'li görev ekle/gözlemle → dosyada `@tag(değer)` bozulmadan duruyor mu?
- [ ] Bir görevi yukarı/aşağı taşı → dosyadaki satır sırası değişti mi?
- [ ] Bir görevi tamamla → kategorisinde kaldı mı, sadece `[x]` oldu mu?
- [ ] Extension'ı disable/enable et → veri kayıpsız geri geldi mi?

### Karara bağlananlar (2026-09-14, kullanıcı onaylı)

- Uyumsuz satırlar korunur (kategorisine bağlı, UI'da gösterilmez,
  serialize'da aynen geri yazılır); her `##` satırı bir kategoridir.
- Adım 3: sync `replace_contents` kalır — atomiklik doğrulanır, belgelenir,
  test edilir; `replace_contents_async`'e geçilmez.
- Tag key regex: ASCII `\w` aynen korunur (Türkçe key kullanılmayacak).
- H1 hiç yoksa serializer `# TODO` ekler.
- `- [X]` normalize edilir: serializer `[x]` yazar, parser ikisini de kabul eder.

## Faz 3 — Bildirimler + arşivleme (ileride)

- [ ] (eski Faz 2 — öncelik değişikliğiyle ertelendi; planlama Faz 2 bitince)
      Planlama notu: gjs.guide Notifications + messageTray.js 46.0 doğrulaması
      şart; arşivleme satır index'lerini kaydırır → `_editingIndex` invariant'ı
      ile uyum şart.

## Faz 4 — Klavye kısayolu (ileride)

- [ ] ...

## Faz 5 — Masaüstü widget'ı (ileride)

- [ ] ...

## Test disiplini (her adımda)

- `Alt+F2 → r` ile GNOME Shell'i yeniden yükle.
- Hata takibi: `journalctl -f` veya Looking Glass (`lg`).
- Onayı alınmadan bir sonraki adıma geçme.
