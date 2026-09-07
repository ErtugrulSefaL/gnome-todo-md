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

- [ ] UI: satıra edit butonu (`document-edit-symbolic`) → satır yerinde St.Entry'e dönüşür
- [ ] Tek-edit invariant: `_editingIndex` TEK state alanı; satır bazlı local state YASAK.
  Şu eylemler açık düzenlemeyi kapatır: başka edit butonu (replace), add-entry
  fokus, toggle, delete, add, menü kapanması, harici dosya değişimi.
  → Birden fazla açık edit kutusu yapısal olarak imkansız.
- [ ] Enter = kaydet (boş metin = iptal), Escape = iptal
- [ ] Test (unit + smoke + manuel) + commit

## Faz 2 — Bildirimler + arşivleme (ileride)

- [ ] ...

## Faz 3 — Klavye kısayolu (ileride)

- [ ] ...

## Faz 4 — Masaüstü widget'ı (ileride)

- [ ] ...

## Test disiplini (her adımda)

- `Alt+F2 → r` ile GNOME Shell'i yeniden yükle.
- Hata takibi: `journalctl -f` veya Looking Glass (`lg`).
- Onayı alınmadan bir sonraki adıma geçme.\n
