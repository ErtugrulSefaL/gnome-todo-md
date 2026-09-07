# Test Raporu — GNOME Todo Extension (Faz 1)

**Son güncelleme:** 2026-09-07
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

## Git geçmişi (Faz 1 + iyileştirmeler)

```
d1bba59 fix: apply completed-task fade via actor opacity instead of CSS opacity
ee3d947 style: fade completed task labels (opacity) so strikethrough reads as muted
61d6184 style: strikethrough completed task labels
063f8cf fix: rebuild todo menu on every file change (drop unreliable isOpen gate)
dc58465 feat: watch ~/todo.md via Gio file monitor so external edits appear live
2eaf28a docs: mark polish + Phase 1 complete; add final syntax/style checks to test.md
2182bc9 fix: use Clutter x_expand (not GTK hexpand) so delete button pins right
9e8c4da fix: use GObject set() for hexpand/x_align (set_hexpand doesn't exist on St.Label)
038fa82 style: pin delete trash button to the far right of each task row
86c33c3 style: shrink trash icon to fit menu rows via stylesheet.css
a936a9e test: add GJS unit+integration test suite for Phase 1 and test.md report
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
## Faz 1.5 — Yerinde görev düzenleme (2026-09-08)

- Unit/integration: `gjs -m tests/run_tests.mjs` → 22/22 passed (storage tarafı
  değişmedi; `editTask` zaten 3 testle kaplıydı: checkbox state korunumu,
  görev metni güncellemesi, checkbox olmayan satır davranışı).
- Smoke: `./tests/smoke.sh` → OK: todo@ertugrul.local is ACTIVE (reload sonrası).
- Manuel test listesi (kullanıcı):
  1. Edit butonuna bas → satır Entry'e dönüşür, metin prefill + odaklı
  2. Enter ile kaydet; Escape ile iptal; boş metinle Enter → iptal (silme yok)
  3. Edit açıkken başka edit butonu → yalnızca yeni satır açık (tek invariant)
  4. Edit açıkken add alanına tıkla / toggle / delete / menü kapat → edit kapanır
  5. Edit açıkken ~/todo.md'yi vim ile değiştir → edit kapanır, liste tazelenir
  6. Delete butonu satır toggle'ını tetiklememeye devam ediyor mu (style rename sonrası)

## Faz 1.5 — Fix turu (2026-09-08, kullanıcı testi sonrası)

Kullanıcı raporu: Escape'te menü kapanıp tekrar açılınca edit kutusu açık kalıyordu;
add alanına tıklamak edit'i kapatmıyordu.

Kökler (kanıtlı): (1) GLib.idle_add tek-arg çağrısı Faz 1'den beri exception
fırlatıyordu → menü açılış rebuild'i hiç çalışmıyordu (monitor maskeliyordu);
(2) tıklama focus'u St.Entry'nin içteki Clutter.Text'ine gidiyor → key-focus-in
tetiklenmiyordu; (3) grab_key_focus eksikti → edit entry odaklanmıyordu;
(4) Escape'i capture fazında MenuManager kesiyor → entry'de yakalanamaz (native
davranış kabul: Escape = menü kapat, invariant edit'i iptal eder).

Fix commit'leri: e4a56fd (idle_add imzası), 24523eb (edit UX).
