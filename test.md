# Test Raporu — GNOME Todo Extension (Faz 1)

**Son güncelleme:** 2026-09-05
**Koşul ortamı:** GJS (`gjs -m tests/run_tests.mjs`) — gerçek `storage.js` modülü + gerçek `~/todo.md`
**Sonuç:** ✅ **18 geçti / 0 kaldı** (tümü başarılı) + sentaks/yapı/stil kontrolleri geçerli

> **Güvenlik:** Test suite, `~/todo.md`'yi başlangıçta anlık görüntüler (snapshot) alarak saklar ve her
> yazma testinden sonra **test edilmiş `Storage.writeTodo()` API'si** ile geri yükler. `teardown` testi,
> dosyanın teste öncesi içerikle **byte-byte aynı** olduğunu doğrular.

---

## ✅ Testler (18/18)

### 1. `splitLines()` — okuma & ayrıştırma

- [x] 3 görev tespit eder (checkbox satırları) — `["2:Buy milk:false","3:Write code:true","8:Call mom:false"]`
- [x] Görev alanları doğru: metin + done durumu
- [x] Başlıkları/notları/boş satırları `other` içinde korur (`# Title`, `## Notes`, `- plain`, boş satır)
- [x] CRLF satır sonlarını doğru işler
- [x] Boş string → görev/başlık yok, hata yok

### 2. `readTodo()`

- [x] Dosyayı okur, ham içerik + ayrıştırılmış görevler döner
- [x] Dosya yoksa boş model döner, istisna fırlatmaz

### 3. `toggleTask()` — check ⇄ uncheck

- [x] İşaretsiz (`[ ]`) → işaretli (`[x]`)
- [x] İşaretli (`[x]`) → işaretsiz (`[ ]`)
- [x] Checkbox olmayan satıra dokunmaz (no-op)
- [x] Geçersiz (sınır dışı) satır indeksi → no-op, dosya değişmez

### 4. `deleteTask()` — silme

- [x] Belirtilen satırı siler (görev satırı)
- [x] Başlık/başka satırı da siler (indeks bazlı)
- [x] Geçersiz indeks → no-op

### 5. `addTask()` — ekleme

- [x] Görevi dosya sonuna işaretsiz (`- [ ]`) ekler
- [x] Boş dosyada temiz başlar (başta gereksiz boş satır yok)
- [x] Sonda yeni satır yoksa ekler (satır birleşmesini önler)

### 6. `writeTodo()` → `readTodo()` (kalıcılık)

- [x] Yazma → okuma round-trip: içerik korunur, görev doğru ayrışır

### 7. Teardown / bütünlük

- [x] Testler sonrası `~/todo.md` ön-test içeriğiyle **byte-byte aynı** (kullanıcı verisi korundu)

### 8. Sentaks / yapı / stil (polish sonrası tam faz kontrolü)

- [x] `extension.js`, `storage.js`, `tests/run_tests.mjs` sentaks OK
- [x] `metadata.json` geçerli (uuid, `shell-version: ["46"]`, name)
- [x] `stylesheet.css` yerinde ve dolu (sil ikonu boyutu)
- [x] Test suite koşusu hâlâ **18/0**
- [x] `~/todo.md` korundu

---

## 🧪 Testleri çalıştır

```bash
cd ~/projects/todo-extension
gjs -m tests/run_tests.mjs
```

Beklenen çıktı (son satırlar):

```
[PASS] teardown: ~/todo.md byte-identical to pre-test content
SUMMARY: 18 passed, 0 failed (out of 18)
RESULT_OK=true
```

---

## 🗒 Notlar

- Testler, storage'ın **saf işlevleri** (splitLines/toggle/delete/add) için gerçek `storage.js` modülünü
  kullanır; dosya I/O testleri gerçek `~/todo.md` üzerinde yapılır ve mutlaka geri yüklenir.
- UI katmanı (menü, St.Entry, sil düğmesi) elle doğrulandı ve kullanıcı tarafından onaylandı.
- Sil düğmesi çöp kutusu ikonunun **büyük görünmesi** fonksiyonel değil kozmetik bir konudur —
  polish backlog'da (bkz. `plan.md`).

## Git geçmişi (Faz 1)

```
cbe7982 docs(plan): close Phase 1 (integration verified); add polish backlog for trash icon size
a8e982d feat: per-task delete button in todo menu rows
5f68ffb fix: use key-release-event (Clutter) instead of nonexistent key::release signal on St.Entry
806cee5 feat: add new-task entry box at top of todo menu (Enter to add)
196c1dd fix: writeTodo must pass Uint8Array to replace_contents (GLib.Bytes type mismatch)
1448874 fix: pre-fill todo menu on enable so an empty popup is not suppressed
f0179c8 fix: delay menu population with GLib.idle_add; use TextDecoder for reliable file decoding
3e1a4b2 feat: todo menu lists tasks with clickable check/uncheck, refresh on open
a2ebe5a feat: storage write operations (toggle/delete/add) and writeTodo persist to ~/todo.md
9604d47 feat: storage module reading and parsing ~/todo.md (preserve non-checkbox lines)
245fc87 feat: initial skeleton with panel indicator (metadata.json + extension.js)
```