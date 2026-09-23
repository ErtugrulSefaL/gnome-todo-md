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
| `GLib.idle_add(priority, func)` — TWO args | menu-open deferred rebuild | runtime proof (gjs): arity=2; 1-arg call throws "At least 2 arguments required"; callback never ran. Latent Phase-1 bug: menu open rebuild never executed (masked by monitor rebuilds) | OK (2026-09-08) |
| Escape handling in menus | edit cancel path | gnome-shell `46.0` `popupMenu.js` `_onCapturedEvent` (~:1422): KEY_Escape intercepted in the CAPTURE phase → menu.close(); key events never reach entry handlers → Escape branch in entry handlers is dead code | OK (2026-09-08) |
| St.Entry mouse click focus target | cancel-edit-on-add-focus | gnome-shell `46.0` `st-entry.c:1083` wires the inner Clutter.Text's button-press; key focus lands on the inner Clutter.Text, so `key-focus-in` on St.Entry does NOT fire on click; use `entry.get_clutter_text()` (st14 mirror: `Entry.get_clutter_text()`) | OK (2026-09-08) |
| `Actor.grab_key_focus()` requires mapped actor | focus edit entry | grab after `menu.addMenuItem(...)` (row on stage); unmapped actors cannot take key focus | OK (2026-09-08) |
| `Gio.File.replace_contents` is atomic for local files (temp + rename) | Faz 2 safe-write requirement | docs.gtk.org `gio/method.File.replace_contents.html`: "atomic renames are used when replacing local files' contents"; consistent with the /tmp rename experiment above; write path pinned by the static guard + end-to-end write/read round-trip test in `run_tests.mjs` | OK (2026-09-14) |
| `PopupBaseMenuItem` params `{reactive, activate, hover, style_class, can_focus}` | menu row construction (entry wrapper, edit row) | gnome-shell `46.0` `js/ui/popupMenu.js` `PopupBaseMenuItem._init` (:82-89, Params.parse) | OK (2026-09-14) |
| `PopupMenuItem(text, params)` exposes `.label` (St.Label); no first-class section-header widget exists in the shell | category header rows | gnome-shell `46.0` `js/ui/popupMenu.js` (:285-298); headers built as non-reactive PopupMenuItem + styled label (same pattern as the proven 'No tasks' row) | OK (2026-09-14) |
| `go-up-symbolic` / `go-down-symbolic` icons | task move buttons | present in local Adwaita icon theme (`/usr/share/icons/Adwaita/symbolic/actions/go-up-symbolic.svg`, `go-down-symbolic.svg`) | OK (2026-09-15) |
| `ExtensionBase.getSettings(schema)` — instance method; schema omitted → `metadata['settings-schema']`; loads the extension's `schemas/` subdir via `Gio.SettingsSchemaSource.new_from_directory(schemaDir, defaultSource, false)`, `lookup(schema, true)` throws when missing | Faz 3 settings infrastructure | gnome-shell `46.0` `js/extensions/sharedInternals.js:91-111` (runtime-verified with the compiled schema: default/set/reset); gjs.guide `topics/extension.md` (GNOME 45+ ESModule era — note: `topics/extension-utils.md` documents the pre-44 API and is outdated for this) | OK (2026-09-23) |
| `GLib.dir_make_tmp(template)` takes ONE argument in GJS (2-arg call warns "expected 1, got 2"); `Gio.File.delete(cancellable)` removes file/dir | temp-dir unit tests (Faz 3 step 2) | runtime proof (gjs): 2-arg call warns "expected 1, got 2", 1-arg returns a full usable path; file+dir delete verified; mirror gap: the GLib page is absent from the offline mirror, search engines returned nothing | OK (2026-09-23) |
| `ExtensionPreferences.fillPreferencesWindow(window)` + `this.getSettings()`; prefs import `resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js` | Faz 3 preferences window | gjs.guide `development/preferences.md` (GNOME 45+) + the guide's official example file; Adw.EntryRow is used via the Gtk.Editable `text` property (String r/w, verified on gjs-docs devdocs adw1) — libadwaita docs: "only minimal API and should be used with the Gtk.Editable API"; `add_suffix()`, `Gtk.Button.icon-name`, `Gtk.Align` verified | OK (2026-09-23) |
| GJS marshals an EMPTY Uint8Array to NULL → `g_file_replace_contents` aborts on `contents != NULL` (write silently skipped) | empty-file writes; CI on a clean env | runtime proof (gjs + CI runner): `TextEncoder().encode('')` has length 0 → GLib-GIO-CRITICAL, file untouched; writeTodo now rejects `''` loudly; test restore deletes an absent/empty pre-test file instead of writing `''` | OK (2026-09-23) |
| `Gtk.style_context_add_provider_for_display` (C name) is UNDEFINED in GJS; the exposed form is the CLASS-STATIC `Gtk.StyleContext.add_provider_for_display(display, provider, priority)` | Faz 5 prefs palette swatches | user-reported TypeError from the prefs process + runtime proof in gjs (with GTK4 init): C-name → `undefined`, class-static form → WORKS; docs.gtk.org documents `load_from_string` since 4.12 (GNOME 46 ships 4.14). LESSON: GTK4 C function names may surface in GJS as namespace/class statics — check BOTH forms at runtime before writing | OK (2026-09-23) |
| `St.Widget.set_style(css)` inline style (e.g. `color: #e01b24;`); `GLib.Variant` `a{ss}` dict round-trips through `recursiveUnpack()` with Unicode (Turkish) keys; `Gio.Settings.get_value/set_value/reset` on `a{ss}` keys | Faz 5 category colors | offline mirror st14 `st.widget` (set_style); runtime proof: `GLib.Variant.new('a{ss}', {'İş': '#e01b24'})` unpack/rebuild OK; schema default `@a{ss} {}` compiled `--strict` and read/written/reset via the sharedInternals.js getSettings flow | OK (2026-09-23) |
| `Gtk.ColorDialogButton` (GTK 4.10+): `dialog`/`rgba` properties, `notify::rgba` signal; `Adw.ActionRow.add_suffix()`; `Gtk.MenuButton`+`Gtk.Popover`; `Gdk.RGBA.parse()`/`red/green/blue` 0-1 floats | Faz 5 prefs color rows | docs.gtk.org gtk4 ColorDialogButton page ("suitable ... for selecting a color in a preference dialog"); devdocs adw1/gtk40 pages for add_suffix/MenuButton/Popover; runtime in the user's prefs process (palette + dialog verified) | OK (2026-09-23) |
| Scrollable popup menu content: `St.ScrollView` + `clip_to_allocation` + CSS `max-height` (scrollbar only engages once a max-height exists) wrapping a `PopupMenuSection` | Faz 6.5 scrollable menu | gnome-shell 46.0 `js/ui/popupMenu.js` `PopupSubMenu` (:1060-1071, quoted comment "the scrollbar will only take effect if a CSS max-height is set"); `PopupMenuSection` (:1192, `this.actor = this.box`); `addMenuItem` is just `box.add_child(menuItem.actor)` → raw actors attach via `menu.box.add_child` | OK (2026-09-24) |
| `PopupMenuSection` is a PopupMenuBase, NOT an actor — attach `section.actor` (= its box); `menu.removeAll()` only tracks items added via `addMenuItem` (a raw `menu.box.add_child` wrapper must be managed manually) | Faz 6.5 scroll wrapper lifecycle | gnome-shell 46.0 source (:1193, :765-768); user-reported blank menu when the section object itself was passed to add_child | OK (2026-09-24) |
| Persistent scroll wrapper keeps its `vadjustment` across content refills — rebuild content by `section.removeAll()` + refill instead of destroying the wrapper; `set_child_below_sibling` does NOT fix BoxLayout order (detach/re-attach does); `changed::` fires synchronously on `set_value`, so write the FILE before writing a settings map that a refresh prunes | Faz 6/6.5 scroll UX | user-reported jumps + runtime fixes (4897c13, efc8143, 2a9b041, 5539588); the shell pattern itself re-attaches nothing but our layout requirement comes from BoxLayout child order | OK (2026-09-24) |

## Known gaps of the offline mirror (do not trust blindly)

- Gio/GLib class pages may be missing (e.g. no `gio.file-monitor` page; only
  `gio.file#method-monitor`) — falls back to docs.gtk.org / GitLab source.
- Snapshot date: 2026-09-07. Newer GNOME Shell / mutter changes are not included.
- Shell **JS UI modules** (PopupMenu, PanelMenu, Main, MessageTray) are not GIR
  docs at all — verify in gnome-shell source (`js/ui/*.js`) at the version tag.

## Pending (verify before writing, when the phase starts)

- Phase 2 (categorization/ordering/tags): parser/serializer are pure `storage.js`
  logic (no new GNOME API risk); sync `Gio.File.replace_contents` stays (atomic —
  row above). Before rendering category headers, verify the PopupMenu
  section-header pattern in gnome-shell `46.0` `js/ui/popupMenu.js`.
- Phase 3 (notifications): `Main.notify` / MessageTray / Notification — read
  gjs.guide "Notifications" topic + gnome-shell `46.0` `js/ui/messageTray.js`
  BEFORE writing any code.
- Phase 3 (archiving): pure `storage.js` functions + tests first (no new API risk).
  Interaction note: archiving shifts line indexes → must go through the same
  `_editingIndex = -1` invariant used by add/toggle/delete (single-edit rule).
- Phase 4 (keybinding): `Shell.util`? / metadata `keybindings` + Settings schema —
  verify against gjs.guide + extension docs before implementing.
