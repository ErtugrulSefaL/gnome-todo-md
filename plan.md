# GNOME Todo Extension — Plan

Teknik hedef: GNOME Shell 46, ESM, X11. Kod dili: İngilizce.
Depolama: `~/todo.md` (markdown checkbox; başlıklar/notlar korunur).

## Faz 1 — Çekirdek (panel menüsü: göster/ekle/sil/check-uncheck)

- [x] 1. İskelet: metadata.json + extension.js + minimal panel düğmesi
- [x] 2. storage.js — `~/todo.md` okuma/ayrıştırma (satırları koru)
- [x] 3. storage.js — yazma (checkbox güncelle, başlık/not koru, yeni görev sona)
- [x] 4. logic — storage içinde (A seçeneği): addTask / deleteTask / toggleTask
- [x] 5. UI — menüde görev listesi + tıklanabilir check/uncheck (Ornament.CHECK)
- [ ] 6. UI — üstte St.Entry ile ekleme (Enter ile)
- [ ] 7. UI — satır başına sil düğmesi (St.Button)
- [ ] 8. Entegrasyon + elle test + commit

## Faz 2 — Bildirimler + arşivleme (ileride)

- [ ] ...

## Faz 3 — Klavye kısayolu (ileride)

- [ ] ...

## Faz 4 — Masaüstü widget'ı (ileride)

- [ ] ...

## Test disiplini (her adımda)

- `Alt+F2 → r` ile GNOME Shell'i yeniden yükle.
- Hata takibi: `journalctl -f` veya Looking Glass (`lg`).
- Onayı alınmadan bir sonraki adıma geçme.