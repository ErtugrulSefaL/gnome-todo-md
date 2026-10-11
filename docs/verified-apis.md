# Verified API Log

Purpose: every GJS / GNOME Shell API used in this extension is verified against
official sources **before** it goes into code (VERIFY-BEFORE-WRITE hard rule in
`.goosehints`). This file is the evidence log — so future sessions never
re-guess an already-proven API.

## How to verify (workflow)

1. **The INSTALLED Shell first** — it is the ground truth and always matches the
   version under test: `tools/shell-api.sh extract /org/gnome/shell/ui/<file>.js`
   (the Shell's own JS, out of the GResource in `libshell-<N>.so`) and
   `tools/shell-api.sh probe` (every API this extension uses, against the
   installed typelibs; exits non-zero if one is missing).
2. **Offline mirror** for prose/API pages: `gjsdoc search <pkg> <term>`, then
   `gjsdoc show <pkg> <page>`. WARNING: FROZEN — see the sources table.
3. **If still ambiguous: verify online** — gjs.guide (a porting page per release)
   or GNOME GitLab source at a version tag
   (`https://gitlab.gnome.org/GNOME/gnome-shell/-/raw/<tag>/js/ui/...`).
4. Record the outcome here: API → source (file:line) → **version tag** → date →
   verdict. Citations are ALWAYS version-tagged: `46.0 :827-850` means "proven
   against gnome-shell 46.0, at those lines". Never read a bare line number as
   version-independent — that is exactly what policy E=2 keeps out of the
   source comments.

## Verification sources (what they are)

| Source | Notes |
|---|---|
| **Installed Shell** (`tools/shell-api.sh`) | PRIMARY since 2026-10-11. The Shell's own JS via GResource (`libshell-<N>.so`), the GI typelibs (`St-<N>`, `Clutter-<N>`) and a 56-API probe. Always matches the version under test; `<N>` is auto-detected so it survives GNOME 51+. |
| `gjsdoc` (offline mirror) | FROZEN as of 2026-10-11: gjs-docs.gnome.org no longer serves the docset JSON (`/<slug>/index.json` and `/<slug>/db.json` both answer with the SPA HTML shell, for every slug), so the mirror cannot be extended. The `st14~14` set already on disk still works offline. |
| gjs.guide | Authoritative extension development guide (ESM, topics, a porting page per release). |
| GNOME Shell source, version tag | `js/ui/*.js` (PopupMenu, PanelMenu, Main) — JS UI modules are NOT in GIR docs; the source is the ground truth. Tags used so far: `46.0`, `50.1`. |
| mutter source, version tag | `clutter/clutter/*.c|h` — Clutter API ground truth. |
| docs.gtk.org | GLib/Gio C reference (current; a superset of older-era APIs). |
| Local runtime tests | `tests/run_tests.mjs` proves storage-layer Gio calls work on this machine; `test.md` §4 records the manual UI runs per shell version. |

## Verified APIs (as used in this project)

Date: 2026-09-07 (offline mirror downloaded 2026-09-07 from gjs-docs.gnome.org)

Every citation below is version-tagged (`46.0 :NNNN` = proven against
gnome-shell 46.0). The load-bearing ones were re-verified against GNOME 50.1 in
the section "GNOME 50 port (2026-10-11)" further down.

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
| `menu.removeAll()` destroys every `menu.box` child whose `_delegate` is a PopupBaseMenuItem (popupMenu.js 46.0 :827-850 `_getMenuItems` → `destroy()`) — persistent rows on `menu.box` must be plain actors | v0.11.0 persistent tab bar | journal SEGV 21:26:11 (`clutter_actor_remove_child` assertion + disposed-object access); fixed + static guard | OK (2026-09-26) |
| CSS `min-width` only raises the computed minimum (`st-theme-node.c :3936`); `width` raises the natural (`:3943`), `max-width` clamps it (`:3944-45`) — a fixed popup frame needs `width` + `max-width` on `menu.box` | v0.11.0 fixed menu width | source + user test (menu shrank with short content) | OK (2026-09-26) |
| St.Label's internal Clutter.Text defaults to PANGO_ELLIPSIZE_END (`st-label.c :336`); ellipsized labels report a small min width → scroll caps squeeze instead of scrolling; horizontal-scroll content needs `EllipsizeMode.NONE` | v0.11.0 tab bar labels | source + user test | OK (2026-09-26) |
| StScrollView's scroll-event handler consumes wheel events (`st-scroll-view.c :751` returns TRUE) and routes UP/DOWN to the VADJUSTMENT only (`:771`); horizontal wheel needs `enable-mouse-scrolling: false` + own `scroll-event` handler | v0.11.0 tab bar wheel scroll | source + user test | OK (2026-09-26) |
| `import Atk from 'gi://Atk'` — `St.Widget` exposes `accessible_role` (Atk.Role, r/w), `label_actor` (Clutter.Actor, r/w), `set_accessible_name`, and the method `add_accessible_state(state: Atk.StateType)` / `remove_accessible_state` | audit D8 task-row semantics + icon-button names | offline mirror `st14~14` page `st.widget` (property table: "accessible_role Type Atk.Role Flags Read/Write", "label_actor Type Clutter.Actor Flags Read/Write"; method list entry `add_accessible_state (state)` with "Parameters: state (Atk.StateType)"). `gi://Atk` is available because the shell itself imports it (`popupMenu.js` 46.0 `:Atk.Role.CHECK_MENU_ITEM`) | OK (2026-10-02) |
| **TRAP:** `PopupBaseMenuItem` never sets `label_actor` — `PopupMenuItem` does (`popupMenu.js` 46.0 `:296`), and our rows are built from `new PopupBaseMenuItem()` with no options. So assigning `row.label_actor = <St.Label>` is meaningful here; passing a `label` option to the constructor would create a second, competing label actor | audit D8 implementation choice | gnome-shell `46.0` `js/ui/popupMenu.js` `PopupMenuItem._init` (:286-298) vs `PopupBaseMenuItem._init` (:82-89, params only) | OK (2026-10-02) |
| The shell's own checkable-menu-item a11y pattern: set `accessible_role = Atk.Role.CHECK_MENU_ITEM`, set `label_actor`, then `add_accessible_state(Atk.StateType.CHECKED)` when on — mirrored by `PopupSwitchMenuItem.checkAccessibleState()` (`:490-500`) and its `_init` (`:428-430`). Copying it keeps an extension row indistinguishable from a shell row for AT | audit D8 | gnome-shell `46.0` `js/ui/popupMenu.js` `:428-430`, `:485-500` | OK (2026-10-02) |
| `overlay_scrollbars` mechanics (VERIFIED IN SOURCE, MEASURED AS A FAILURE) — `true` sets `account_for_hscrollbar/vscrollbar = FALSE` and zeroes the reserved size (`st-scroll-view.c` 46.0 :451, :458, :652), so an overlay bar overlaps the content instead of sitting beside it. Measured 2026-10-03 with `overlay_scrollbars: true` on both menu scrollers: the **vertical** bar drew OVER the task rows and took no pointer events (the user: "it moved on top of the task", "cannot be touched, as if it were behind"), and the **horizontal** bar on the tab strip never appeared at all. Visibility of an overlay bar is left to the theme: GNOME 46's `data/stylesheet.css` has no scrollbar rules (the appearance ships inside the theme's gresource). Conclusion: overlay is the wrong tool for this menu; `St.PolicyType.AUTOMATIC` with the theme's own styling is the working baseline | scrollbar appearance | gnome-shell `46.0` `src/st/st-scroll-view.c` (read) + user testing on this machine — the code behaved as documented and still failed the requirement | REJECTED (2026-10-03) |
| `GLib.idle_add` returns a **source id**; store it and cancel with `GLib.Source.remove(id)` in `disable()` (and before re-arming the same source). A callback returning `GLib.SOURCE_REMOVE` frees itself but the guidelines still require the teardown path, and a pending idle would otherwise call back into a destroyed menu | audit S6 | GLib docs (`g_source_remove`); review-guidelines "Remove main loop sources"; runtime-proven in the running shell after `Alt+F2 → r` | OK (2026-10-02) |

## External static analyzers (EGO-side evidence, 2026-10-10)

Run on `dist/todo-md@ertugrulsefal.github.com-0.15.0.zip` (built by `tools/make-package.sh`).

### ego-lint (`.goose/tools/gnome-extension-reviewer/ego-lint`)

0 FAILED, 190 passed, 25 warnings. Dispositions:
- `resource-tracking/no-destroy-method` ×20 (advisory) — row actors are destroyed
  with the menu tree on every rebuild (`menu.removeAll()` / `remove_all_children()`);
  long-lived actors are explicitly destroyed in `disable()` (extension.js:157-168).
- `lifecycle/signal-balance` (8 connects / 6 disconnects) — verified clean by hand:
  the 6 disconnects are exactly the signals on LONG-LIVED objects (4× `_settings`,
  `_indicator.menu`, `_todoMonitor`); every remaining `.connect()` is on an actor
  owned by the menu/prefs tree, whose handlers die with the actor.
- `metadata/shell-version-current` — RESOLVED 2026-10-11: `shell-version` is now
  `["50"]` (the version this code was regression-tested on). Policy: only
  verified versions are declared (R3, `AGENTS.md`); 46–49 are added after the VM
  regression runs, never optimistically.
- `quality/private-api` (`Main.panel.addToStatusArea`, extension.js:122) — known,
  disclosed in the EGO submission notes.
- `license` (repo dir lint only) — LICENSE lives at the repo root; the zip root
  gets it via `make-package.sh`. Verified present in the zip.

### Shexli (EGO's own recommended analyzer, PyPI `shexli` 0.2.1)

Install pin (durable): `pip install shexli tree-sitter==0.25.0` — pip otherwise
pulls `tree-sitter 0.26.0` while `tree_sitter_javascript 0.25.0` is compiled
against the 0.25 ABI → **segfault** on multi-file packages (reproduced twice,
exit 139; fixed by the pin, 3× stability re-run all clean).

⚠️ **The tool is version-gated and fails SILENT**: if `metadata.json`'s
`shell-version` does not parse, `target_versions: []` and NO rule fires — it
reports "clean (0 findings)" on anything. Verified with a deliberately broken
fixture (eval, `spawn_command_line_async`, `gschemas.compiled`): with
`shell-version: ["3.2"]` → silent clean; with `["46"]` → the fixture is caught
(EGO-P-006). Never trust a Shexli pass without a self-test fixture.

Shexli result on our zip: 0 errors, 3 warnings —
- `EGO-X-004` sync file IO (`Gio.File.load_contents`, storage.js:434): REAL,
  known design decision. Disclosed to the reviewer: small user file, read once
  per menu refresh, atomic `replace_contents` for writes. (An async refactor
  would be a major structural change; deferred.)
- `EGO-L-002` (`_contentSection` not destroyed): FALSE POSITIVE —
  `disable()` destroys the persistent wrapper that owns the section
  (`this._scrollWrapper.destroy()`, extension.js:157-161) and nulls the field.
- `EGO-L-003` (`newCategoryButton.connect` never disconnected): FALSE POSITIVE —
  `disable()` destroys the tab bar (`this._tabBar.bar.destroy()`,
  extension.js:163-166), which destroys the button and its handlers.

## GNOME 50 port (2026-10-11) — re-verification, 46.0 vs 50.1

Context: the extension was `OUT_OF_DATE` on GNOME Shell 50.1 purely because
`metadata.json` still declared `shell-version: ["46"]`. Before widening it, the
whole API surface was re-checked against the INSTALLED Shell: its own JS out of
the GResource in `/usr/lib/gnome-shell/libshell-18.so`, plus the `St-18` /
`Clutter-18` typelibs. Reproduce with `tools/shell-api.sh`.

**Result: no API this extension uses changed between 46.0 and 50.1.**

| Claim (46.0 citation -> 50.1 equivalent) | Verdict |
|---|---|
| `_getMenuItems()` filter `instanceof PopupBaseMenuItem \|\| PopupMenuSection` (46.0 :827-831 -> 50.1 :914-919) | identical — the SEGV invariant still holds |
| `PopupBaseMenuItem._init` params `{reactive, activate, hover, style_class, can_focus}` and `this._delegate = this` (46.0 :82-97 -> 50.1 :66-89) | identical |
| `PopupSubMenu(sourceActor, sourceArrow)` ctor (46.0 :1054 -> 50.1 :1148) | identical |
| `PopupSubMenu._onKeyPressEvent` -> `this.sourceActor._delegate.active = true` (46.0 :1176 -> 50.1 :1270) | identical — our panel's `sourceActor` is a PopupBaseMenuItem, which sets `_delegate` |
| `PopupMenuSection()` -> `this.actor = this.box` (46.0 :1192-1197 -> 50.1 :1286-1291) | identical |
| `PanelMenu.Button._init(menuAlignment, nameText, dontCreateMenu)` (46.0 :98 -> 50.1 :96) | identical |
| `Main.panel.addToStatusArea(role, indicator, position, box)` (panel.js) | unchanged |
| `St.Label.label_actor` | present (now on `St.Widget`; our rows are St-based) |
| `GLib.idle_add(prio, fn)` / `GLib.Source.remove` | still present (`idle_add_once` added alongside) |
| prefs: `Gtk.ColorDialogButton`, `CssProvider.load_from_string`, `StyleContext.add_provider_for_display`, `Adw.{EntryRow,SpinRow,ActionRow}` | present on GTK 4.22.4 / libadwaita 1.9.1 |

**Differences that do NOT touch us** (46.0 -> 50.1): `Clutter.ClickAction` ->
`Clutter.ClickGesture` (internal to PopupBaseMenuItem / PanelMenu); the
`selected` style class -> `:selected` pseudo-class; St `vertical` ->
`orientation` (deprecated in 48, removed in 51); `PopupMenu`'s internal ctor
argument list.

**Runtime confirmation:** full manual regression on GNOME Shell 50.1 / Wayland —
18/18 checks green (`test.md` §4). The six points static analysis could not prove
(inline PopupSubMenu rendering, the right-click path, width forcing, horizontal
wheel scrolling, theme colours, Orca) all passed.

**Tooling added:** `tools/shell-api.sh` — `info` / `list` / `extract` / `probe`.
`probe` checks 56 APIs against the installed typelibs; run it after every GNOME
upgrade.

**Known forward breakage (GNOME 51, NOT addressed yet):** `PopupMenu.open()` /
`close()` take a parameters object; event signals are deprecated in favour of
controllers; St `vertical` is gone; `St.ButtonMask` members were renamed. See
`roadmap.md` §D.

## Faz 7 (2026-10-10) — category action panel (design H)

Source of truth: gnome-shell **46.0** `js/ui/popupMenu.js` and `js/ui/panelMenu.js`
(raw files at the `46.0` tag), plus the offline mirror for Clutter/St.

### The menu machinery (why a floating popup is not an option)

| Fact | Evidence |
|---|---|
| The panel menu lives in `Main.uiGroup`; its modal grab is pushed by `PopupMenuManager` | panelMenu.js :132; popupMenu.js :1379 `Main.pushModal(menu.actor, …)` |
| Opening a managed menu **closes the previously active one** | popupMenu.js :1381 `oldMenu?.close(FADE)` |
| A `PopupMenu` **closes itself when its `sourceActor` unmaps** | popupMenu.js :889-892 (`notify::mapped`) |
| Outside click closes a menu only when the event target is **not contained** in the menu actor (`contains` is recursive) | popupMenu.js :1345, :1440 |
| `removeAll()` destroys only box children whose `_delegate` is a `PopupBaseMenuItem` **or** a `PopupMenuSection` | popupMenu.js :827-850 |
| `addMenuItem()` wires `activate` → `itemActivated()` → `_getTopMenu().close()` | popupMenu.js :694-701, :646-651 |
| `_setParent()` is only called by `addMenuItem` → a directly-added actor keeps `_parent === null` | popupMenu.js :611-616, :834 |

Consequence: the action panel is an **inline** expander inside the menu
(GNOME's own idiom), never a second top-level popup.

### APIs used (verified)

| API | Evidence | Use |
|---|---|---|
| `PopupMenu.PopupSubMenu(sourceActor, arrow)` — `popup-sub-menu` styled `St.ScrollView`, hidden initially, `open/close` animate the height | popupMenu.js :1053-1192 | The panel |
| `sourceActor` / `focusActor` are plain properties set in the constructor | :552-553 | Re-targeting the shared panel per header |
| `PopupSubMenu._onKeyPressEvent` dereferences `sourceActor._delegate.active` on Left | :1160-1164 | Why `sourceActor` is set to the **header row** (a menu item), not to an `St.Button` |
| `_needsScrollbar()` reads the TOP menu's CSS `max-height`; `.popup-sub-menu` has none | :1084-1090; `data/theme/.../_popovers.scss` :74-82 | No stray scrollbar |
| `PopupMenuItem.label` is an `St.Label` | :285-300 | Two-step delete ("Confirm delete?") |
| `PopupBaseMenuItem.sensitive` + `setSensitive`/`syncSensitive` | :73-74, :224-250 | The passive "Change color" entry |
| `PopupBaseMenuItem` is itself an `St.BoxLayout` with a `Clutter.ClickAction`; `get actor()` returns `this` | :67-131 | Items can be added with `box.add_child(item.actor)` |
| `Clutter.Event.get_button()`, `Actor::button-press-event`, `CLUTTER_EVENT_STOP` stops scene-graph propagation | mirror: clutter.event / clutter.actor | Right-click on a tab; the press never reaches the tab's click action |
| `Clutter.Actor.get_parent()`, `remove_child()`, `St.Entry.text`, `Clutter.Text.set_selection()` | mirror: clutter.actor / st.entry / clutter.text | Detach per refresh; prefilled rename entry |

### Not used on purpose

- `PopupSubMenuMenuItem`: it is a `PopupBaseMenuItem` — on the menu box it is
  destroyed by `removeAll()` (the 2026-09-26 SEGV shape).
- `Main.uiGroup` + `Main.panel.menuManager` for a second popup: it would close
  the open menu and then close itself (two facts in the table above).
- `PopupSubMenu._arrow` (private): the arrow actor is kept invisible instead of
  being re-pointed per open.

## Faz 8 (2026-10-10) — in-menu colour picker

- **No new shell API.** `St.Button` (`toggle_mode` + `set_checked`, the tab
  pattern), inline `background-color` (the checkbox pattern) and an
  `St.BoxLayout` row added to the `PopupSubMenu` box (already verified in the
  Faz 7 section).
- **Palette source (why teal/pink).** The HIG's two neutrals — brown `#986a44`,
  gray `#9a9996` — were dropped as illegible category-header TEXT on the menu's
  dark background (user decision 2026-10-10). The replacements come from the
  modern Adwaita accent palette: libadwaita **1.7** `src/stylesheet/_colors.scss`
  (`--accent-teal: #2190a4`, `--accent-pink: #d56199`). Version pinned because
  GTK 4.14's `gtk/theme/Default/_colors-public.scss` and libadwaita 1.5/1.6
  `_palette.scss` define **no** teal/pink (checked, not assumed).
- Icon `action-unavailable-symbolic` verified present in the local Adwaita icon
  theme (`/usr/share/icons/Adwaita/symbolic/actions/`), not guessed.

## Known gaps of the offline mirror (do not trust blindly)

- **FROZEN (2026-10-11):** the mirror can no longer be refreshed. gjs-docs.gnome.org
  answers every `/<slug>/index.json` and `/<slug>/db.json` with the SPA HTML
  shell (5941/5938 bytes) instead of the docset JSON, so `tools/gjs-docs-mirror.sh`
  fails for every slug. The set already on disk still works offline; for anything
  newer use the installed Shell (`tools/shell-api.sh`).
- Gio/GLib class pages may be missing (e.g. no `gio.file-monitor` page; only
  `gio.file#method-monitor`) — falls back to docs.gtk.org / GitLab source.
- Snapshot date: 2026-09-07 (GNOME 46 / `st14~14`). Newer GNOME Shell / mutter
  changes are not included.
- Shell **JS UI modules** (PopupMenu, PanelMenu, Main, MessageTray) are not GIR
  docs at all — verify in gnome-shell source (`js/ui/*.js`) at the version tag.

## Pending (verify before writing, when the phase starts)

- Faz 9 (task drag-and-drop): `Clutter.ClickAction`/`TapAction` were REMOVED in
  GNOME 49 — any dnd design must be built on `Clutter.ClickGesture` /
  `LongPressGesture` / a `Clutter.DragGesture`, verified against the INSTALLED
  Shell first (`tools/shell-api.sh extract /org/gnome/shell/ui/...`).
- Faz 14 (notifications): `Main.notify` / MessageTray / Notification — read the
  gjs.guide "Notifications" topic + the shell's `js/ui/messageTray.js` at the
  version tag BEFORE writing any code.
- Phase 3 (archiving): pure `storage.js` functions + tests first (no new API risk).
  Interaction note: archiving shifts line indexes → must go through the same
  `_editingIndex = -1` invariant used by add/toggle/delete (single-edit rule).
- Phase 4 (keybinding): `Shell.util`? / metadata `keybindings` + Settings schema —
  verify against gjs.guide + extension docs before implementing.

