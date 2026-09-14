# Faz 2: Kategorizasyon, Sıralama, Etiketler

Bu fazda mevcut CRUD (ekleme/işaretleme/güncelleme/silme) üzerine
kategorileştirme, aynı kategori içinde manuel sıralama ve serbest
etiket (tag) desteği ekleniyor. Aşağıdaki kararlar tartışılıp
kilitlendi — Goose bunları sorgulamadan temel alsın.

## Kilitlenmiş tasarım kararları

- **Dosya yapısı:** `#` tek satır doküman başlığı (içeriği önemsiz,
  sadece marker). Her `## Kategori Adı` bir kategori. Her kategori
  altındaki `- [ ] metin @tag(değer) ...` bir görev.
- **Kategorisiz görev yok:** `##` görülmeden önce rastlanan görev
  satırları otomatik olarak "Genel" kategorisine düşer. Serialize
  ederken "Genel" her zaman gerçek bir `## Genel` başlığı olarak
  yazılır (kullanıcı elle yazmamış olsa bile) — böylece dosya her
  zaman tutarlı ve elle düzenlemeye açık kalır.
- **Sıralama = satır pozisyonu.** Ayrı bir "order" / "priority index"
  alanı YOK. Bir görevi taşımak, o kategorinin task dizisinde index
  swap yapıp dosyayı yeniden yazmaktan ibaret.
- **Cross-category taşıma bu fazda yok.** Sadece aynı kategori
  içinde yukarı/aşağı.
- **Tamamlanan görev yerinde kalır**, sadece `[ ]` → `[x]`. Ayrı bir
  "Tamamlandı" bölümüne taşınmaz.
- **Etiketler tamamen serbest.** Parser `@(\w+)\(([^)]+)\)` kalıbına
  uyan HER şeyi bir key-value çifti olarak yakalar. Kodda `due`,
  `start` gibi sabit bir whitelist YOK — bilinmeyen bir tag adıyla
  karşılaşınca onu atmaz, olduğu gibi saklar ve geri yazar.
- **Tag sırası korunur:** Bir görevin etiketleri düz bir obje değil,
  `[[key, value], ...]` şeklinde sıralı bir liste olarak tutulmalı
  (JS obje key sırası garantili değildir, bu da dosyada anlamsız
  tag sırası kaymalarına yol açabilir).
- **Atomic write zorunlu.** Dosyanın tamamı her yazımda yeniden
  üretiliyor (bu normal ve sorun değil, veri boyutu çok küçük) ama
  yazma sırasında yarıda kesilme riskine karşı `Gio.File.replace_
  contents_async()` (veya eşdeğer güvenli replace deseni) kullanılmalı.
  Doğrudan truncate-and-write YOK.

## Bu fazda UI'da OLMAYACAK ama altyapı buna hazır olmalı

- **Kategori ekleme UI'ı bu fazda yok.** Ama kategori listesi
  (`Document.categories`) üzerinde ayrı, izole bir `addCategory(name)`
  fonksiyonu/metodu bulunmalı — henüz hiçbir buton onu çağırmasa
  bile, kod içinde bağımsız var olsun. İleride bir "+" butonu
  eklemek sadece bu fonksiyonu UI'a bağlamak olmalı, veri modelini
  yeniden yazmak olmamalı.
- **Tag ekleme UI'ı bu fazda yok.** Ama görev nesnesinin `tags`
  alanı zaten yukarıdaki sıralı liste yapısında olduğu için, ileride
  bir "tag ekle" formu sadece bu listeye yeni bir `[key, value]`
  push etmesi yeterli olacak şekilde tasarlanmalı.

## Uygulama adımları (sırayla, her biri ayrı test + commit)

1. **Parser (okuma)** — Örnek bir `.md` dosyasını yukarıdaki kurallara
   göre `Document { categories: [{ name, tasks: [{ text, done, tags }] }] }`
   yapısına çevir. "Genel" fallback davranışını dahil et.
   - /goal: H1, birden fazla H2, tag'li/tag'siz görevler ve
     ilk `##`'den önceki görevler içeren elle hazırlanmış bir test
     dosyası doğru parse ediliyor (nested oturumda loglayarak
     doğrula).

2. **Serializer (yazma)** — Yukarıdaki yapıyı geri markdown metnine
   çevir. Kategori/görev sırası ve tag sırası birebir korunmalı.
   - /goal: değişiklik yapılmadan parse → serialize edilen bir
     dosya, orijinaliyle byte-byte aynı çıkıyor (round-trip testi).

3. **Atomic write entegrasyonu** — Mevcut yazma mekanizmasını
   `Gio.File.replace_contents_async()` tabanlı güvenli yazımla
   değiştir, serializer'a bağla.
   - /goal: yazma sırasında (simüle ederek) kesinti olsa bile
     orijinal dosya yarım/bozuk kalmıyor; normal yazımlar da
     çalışmaya devam ediyor.

4. **"Genel" fallback davranışı** — UI'dan kategori seçmeden eklenen
   görev "Genel" altına düşsün ve dosyada gerçek bir `## Genel`
   başlığı olarak yazılsın.
   - /goal: kategori seçmeden eklenen bir görev, kaydedilen dosyada
     `## Genel` altında görünüyor.

5. **Yukarı/aşağı taşıma** — Her görev satırının yanına ↑/↓ butonu
   ekle; tıklanınca ilgili kategorinin task dizisinde index swap
   yap, sonra kaydet. Kategorinin ilk öğesinde ↑, son öğesinde ↓
   pasif/gizli olmalı.
   - /goal: 5 görevlik bir kategoride 3. görevi iki kez yukarı
     taşımak onu 1. sıraya getiriyor — hem UI'da hem kaydedilen
     dosyada satır sırası doğrulanıyor.

6. **Genişletilebilirlik iskeleti** — `addCategory(name)` fonksiyonunu
   (henüz UI'sız) ve tag listesine push eden bir yardımcı fonksiyonu
   ekle; ikisi de mevcut UI'dan çağrılmasa bile izole şekilde var
   olsun.
   - /goal: Looking Glass üzerinden veya geçici bir test çağrısıyla
     `addCategory("Test")` ve tag push fonksiyonu, UI'a hiç
     dokunmadan manuel çağrılıp doğrulanabiliyor.

## Manuel test checklist'i (her adımdan sonra değil, faz sonunda genel geçiş)

- [ ] Boş dosyadan ilk görevi ekle → "Genel" altına düştü mü?
- [ ] Dosyaya elle `## İş` ekleyip extension'ı yeniden yükle → yeni
      kategori doğru okunuyor mu?
- [ ] Tag'li görev ekle/gözlemle → dosyada `@tag(değer)` bozulmadan
      duruyor mu?
- [ ] Bir görevi yukarı/aşağı taşı → dosyadaki satır sırası değişti mi?
- [ ] Bir görevi tamamla → kategorisinde kaldı mı, sadece `[x]` oldu mu?
- [ ] Extension'ı disable/enable et → veri kayıpsız geri geldi mi?
