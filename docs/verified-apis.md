# Verified API Log

Purpose: every GJS / GNOME Shell API used in this extension is verified against
official sources **before** it goes into code (VERIFY-BEFORE-WRITE hard rule in
`.goosehints`). This file is the evidence log — so future sessions never
re-guess an already-proven API.

## How to verify (workflow)

1. **Offline first:** `gjsdoc search <pkg> <term>` then `gjsdoc show <pkg> <page>`
   against the local mirror `~/.local/share/gjs-docs-offline/` (GNOME 46 docs:
   `st14~14`, `shell14~14`, `clutter14~14`, `meta14~14`, `gio20~2.0`, `glib20~2.0`, `gjs`).
2. **If missing / ambiguous / version-sensitive: verify online** — gjs.guide,
   gjs-docs.gnome.org, or GNOME GitLab source at a version tag
   (`https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/46.0/...`).
3. Record the outcome here: API → source (file:line) → date → verdict.

## Verification sources (what they are)

| Source | Notes |
|---|---|
| `gjsdoc` (offline mirror) | DevDocs static dump of gjs-docs.gnome.org, GNOME 46 tags. Fast, but a snapshot — can be incomplete (e.g. Gio class pages) — re-verify online when unsure. |
| gjs.guide | Authoritative extension development guide (ESM, topics, upgrade notes). |
| GNOME Shell source `46.0` tag | `js/ui/*.js` (PopupMenu, PanelMenu, Main) — JS UI modules are NOT in GIR docs; source is the ground truth. |
| mutter `46.0` tag | `clutter/clutter/*.c|h` — Clutter API ground truth for GNOME 46. |
| docs.gtk.org | GLib/Gio C reference (current; superset of GNOME 46 era APIs). |
| Local runtime tests | `tests/run_tests.mjs` proves storage-layer Gio calls work on this machine. |

## Verified APIs (as used in this project)

Date: 2026-09-07 (offline mirror downloaded 2026-09-07 from gjs-docs.gnome.org)

| API | Used for | Verified against | Verdict |
|---|---|---|---|
| ESM pattern: `export default class Ext extends Extension` from `resource:///org/gnome/shell/extensions/extension.js` | extension.js | gjs.guide "Getting Started" (identical skeleton); blogs.gnome.org ESM post | OK |
| `PanelMenu.Button(0.0, name, false)` | panel indicator | gnome-shell `46.0` `js/ui/panelMenu.js` → `_init(menuAlignment, nameText, dontCreateMenu)`; gjs.guide example | OK |
| `Main.panel.addToStatusArea(uuid, indicator)` | install indicator | gjs.guide "Getting Started" example | OK |
| `indicator.menu.connect('open-state-changed', ...)` | rebuild on menu open | gjs.guide example (uses `notify::open-state-changed` alternative); shell source uses same signal | OK |
| `PopupBaseMenuItem(params)` with `{activate, can_focus}` | task rows | gnome-shell `46.0` `js/ui/popupMenu.js:83-89` → `Params.parse` (reactive, activate, hover, style_class, can_focus) | OK |
| `PopupMenu.Ornament.CHECK` | checkbox ornament | gnome-shell `46.0` `popupMenu.js:17-23` enum (GNOME 46 adds `NO_DOT`, keeps `CHECK`); gjs.guide Popup Menu topic | OK |
| `item.setOrnament(...)` | checkbox ornament | gjs.guide Popup Menu topic; popupMenu.js `_ornamentIcon` | OK |
| `menu.addAction(title, callback, icon?)` | header actions | gnome-shell `46.0` `popupMenu.js:607` | OK |
| `menu.removeAll()` (destroys items) | rebuild rows | gnome-shell `46.0` `popupMenu.js:845` | OK |
| St.Entry `hint_text`, `can_focus` constructor props | add-task entry | gnome-shell `46.0` `src/st/st-entry.c:961` (`g_param_spec_string("hint-text",...)`); offline mirror `st14~14` page `st.entry` shows `hint-text String r/w` | OK |
| `entry.connect('key-release-event', ...)` + `event.get_key_symbol() === Clutter.KEY_Return` | Enter adds task | mutter `46.0` `clutter/clutter/clutter-keysyms.h:36` (`#define CLUTTER_KEY_Return 0xff0d`); GJS event API | OK |
| `set_x_expand(true)` / `set_x_align(Clutter.ActorAlign.*)` | layout on St actors | mutter `46.0` `clutter-actor.c` (`clutter_actor_set_x_expand`, `clutter_actor_set_x_align`) | OK |
| `new St.Button({child: ..., style_class: ...})` + `'clicked'` signal | delete buttons | St.Bin `child` property (`st-bin.c:210`), Button inherits St.Bin; `clicked` signal is St.Button API | OK |
| `label.opacity = <0-255>` (actor property, not CSS) | fade done tasks | Clutter.Actor `opacity` property | OK |
| Line-through via stylesheet.css (`.todo-done` class) | done tasks | St theme CSS support (gjs.guide styling; St.Style) | OK |
| `Gio.File.new_for_path()`, `file.load_contents(null)` → `[ok, bytes]` | read `~/todo.md` | docs.gtk.org GFile; proven by `tests/run_tests.mjs` on this machine | OK |
| `file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null)` with `Uint8Array` | write `~/todo.md` | docs.gtk.org; proven by tests (round-trip); `TextEncoder().encode()` yields Uint8Array | OK |
| `file.monitor(Gio.FileMonitorFlags.NONE, null)` + `changed` signal + `monitor.cancel()` | live reload | docs.gtk.org `Gio.FileMonitor`; `changed(monitor, file, other_file, event_type)` | OK |
| `GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, ...)` + `GLib.SOURCE_REMOVE` | defer refresh | GLib docs; runtime-proven | OK |
| FileMonitor survives atomic replace (rename) | risk check | Local experiment (`gjs` + `/tmp` file): in-place CHANGED → rename DELETED+CREATED → post-rename CHANGED still delivered | OK — live watching survives vim-style atomic writes |
| St.Button press/release consume their events (`return TRUE`) | edit/delete buttons never trigger the row's activate (toggle) | gnome-shell `46.0` `src/st/st-button.c` — `st_button_button_press` (:199) and `st_button_button_release` (:228) return TRUE when button mask matches | OK (2026-09-08) |
| `Clutter.Actor::key-focus-in` signal + `grab_key_focus()` | cancel edit when the add entry gains focus; focus the edit entry | offline mirror `clutter14~14` → `clutter.actor#signal-key-focus-in`, `clutter.actor#method-grab_key_focus` | OK (2026-09-08) |
| `Clutter.KEY_Escape` | cancel editing | mutter `46.0` `clutter-keysyms.h` → `#define CLUTTER_KEY_Escape 0xff1b` | OK (2026-09-08) |
| `document-edit-symbolic` icon | edit button glyph | present in local Adwaita icon theme (`/usr/share/icons/Adwaita/symbolic/actions/document-edit-symbolic.svg`) | OK (2026-09-08) |
| `St.Entry.set_text()` (constructor prop not assumed) | prefill edit entry | runtime-proven (used by add entry: `set_text('')`); constructor `text` prop not verified, deliberately avoided | OK |

## Known gaps of the offline mirror (do not trust blindly)

- Gio/GLib class pages may be missing (e.g. no `gio.file-monitor` page; only
  `gio.file#method-monitor`) — falls back to docs.gtk.org / GitLab source.
- Snapshot date: 2026-09-07. Newer GNOME Shell / mutter changes are not included.
- Shell **JS UI modules** (PopupMenu, PanelMenu, Main, MessageTray) are not GIR
  docs at all — verify in gnome-shell source (`js/ui/*.js`) at the version tag.

## Pending (verify before writing, when the phase starts)

- Phase 2 (notifications): `Main.notify` / MessageTray / Notification — read
  gjs.guide "Notifications" topic + gnome-shell `46.0` `js/ui/messageTray.js`
  BEFORE writing any code.
- Phase 2 (archiving): pure `storage.js` functions + tests first (no new API risk).
  Interaction note: archiving shifts line indexes → must go through the same
  `_editingIndex = -1` invariant used by add/toggle/delete (single-edit rule).
- Phase 3 (keybinding): `Shell.util`? / metadata `keybindings` + Settings schema —
  verify against gjs.guide + extension docs before implementing.
