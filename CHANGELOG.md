# Changelog

All notable changes to the Todo extension are documented in this file.
The project uses Semantic Versioning (0.y.z until 1.0.0); a version is
assigned only when a phase is completed and approved (see `.goosehints`).

## 0.11.12 - 2026-10-02

### Fixed
- **The test suite was silently deleting your category colours.** The
  file-level tests wrote fixtures to `~/todo.md` and restored the file
  afterwards — but a running extension watches that file, so the fixture
  write fired its monitor, the refresh saw a document with no categories,
  and it pruned the entire `category-colors` map through `set_value`.
  Permanent, invisible, on every single test run. The tests now write to a
  temporary file, and a teardown check proves the real file is left alone.

### Fixed
- **A failed read no longer erases the colour map.** `readTodo` swallowed
  read errors and returned an empty document, which looked exactly like "the
  user deleted every category". A transient failure — an editor's atomic
  save, a rename window, a permission blip — was enough to lose every colour.
  `readTodo` now reports `ok`, and pruning is skipped when the read failed.

  A genuinely empty file is still treated as empty (the automatic dead-key
  pruning from the colours feature is unchanged).

### Added
- Guards for both, each verified by re-introducing the defect. Also fixed a
  duplicated test registration that counted 13 tests twice.

  Tests: 180 → 169 (the difference is the duplicate registration).

## 0.11.11 - 2026-10-02

### Fixed
- The menu's deferred refresh is now cancellable. Opening the menu schedules
  the rebuild with `GLib.idle_add` and the source id was thrown away, so
  turning the extension off while that callback was pending left it to run
  against an already-destroyed menu. The id is stored and removed in
  `disable()`, as the review guidelines require for every main loop source —
  including ones that already returned `SOURCE_REMOVE`.

### Added
- A static guard for it. Tests: 177 → 178.

## 0.11.10 - 2026-10-02

### Added
- Accessibility (audit D8). Screen readers can now use the menu:
  - the six icon-only buttons (new category, add task, move up, move down,
    delete, edit) announce what they do instead of just "button";
  - task rows carry `Atk.Role.CHECK_MENU_ITEM` with the `CHECKED` state and
    their text label attached, so a screen reader can tell a finished task
    from a pending one.

  `PopupBaseMenuItem` has no `checkAccessibleState()` — that method lives on
  `PopupSwitchMenuItem` — so the state is maintained where the row is built,
  which keeps it in sync because rows are rebuilt on every refresh.

  The audit also listed "the tab bar is not keyboard reachable" as a
  regression from the SEGV fix. That is not the case: `PopupMenuSection` does
  not override `get_focus_chain`, and St's default returns every visible
  child, so the plain `St.Button` tabs are in the menu's focus chain —
  confirmed by keypress test (↓ reaches the tabs, Enter activates one). No
  code change was needed.

## 0.11.9 - 2026-10-02

### Fixed
- **Checking a task did nothing on a file with Windows line endings.** A CR at
  the end of each line is a line terminator as far as a JavaScript regex is
  concerned, so the checkbox pattern never matched and the toggle was a silent
  no-op.
- **Editing a task destroyed its checkbox on such a file.** The same mismatch
  sent the edit down the "not a checkbox line" path, which replaces the line
  with plain text — `- [ ] a` became `b`. The task survived as text but lost
  its checkbox and vanished from the task list.

  `parseDocument` stripped the CR all along; the line-level helpers did not.
  Both now match without the CR and put it back.

### Changed
- Line endings are preserved: a file with Windows line endings is written back
  with Windows line endings. Previously the first document-level write
  (adding a task or a category) silently rewrote the whole file with LF.
  Line-level edits already kept them. A file with mixed endings is written
  with CRLF throughout.

  This makes a CRLF file round-trip byte-identically, like an LF one does.

### Added
- Eight tests covering the CRLF paths: toggle, edit, delete, the non-checkbox
  fallback, document-level writes, and round-trip in both directions.
  Tests: 167 → 175.

## 0.11.8 - 2026-10-02

### Fixed
- A category name containing a line break no longer corrupts the file. Typing
  `a` + Enter + `b` wrote `## a` followed by a stray `b` text line, and `a`
  was left as an orphan section.
- A name starting with `#` (`## Injected`, `# TODO`) is no longer written as a
  nested-looking heading.
- Pressing Enter on a name `addCategory` refuses no longer closes the entry
  silently. Empty, duplicate and unusable names leave the text on screen so it
  can be corrected, instead of looking like a dead button.

  Rejected names are refused outright rather than rewritten, so what gets
  stored is always exactly what was typed.

### Added
- `Storage.isUsableCategoryName()` plus tests for the rejection rules, and a
  static guard that the UI only closes the entry *after* the rejection check.
  Tests: 144 → 167.

  The first version of that guard was wrong: it searched the whole file for
  the closing assignment and matched an unrelated one in `_cancelEditing()`, so
  it passed against the exact bug it was written for. It now uses line windows.

  Note: two categories differing only in case (`work` / `Work`) are *not*
  treated as a conflict — the `category-colors` map is keyed by exact name, so
  they already have separate entries and each resolves correctly.

## 0.11.7 - 2026-10-02

### Fixed
- **Tasks written above an explicit `## General` heading were invisible**
  (audit D4). The lines before a file's first category heading were parked in a
  second item list that only the serializer read, so such tasks never appeared
  in the menu, and adding an inline tag or pressing ↑/↓ on them silently did
  nothing. The category now keeps one item list with a `preCount` marking where
  the heading belongs — the second list could not go stale.
- **A `# ` heading that is not the first line no longer jumps to the top of the
  file** (audit D2). Only a heading that opens the file is the document title;
  one further down stays inside the section it sits in. Previously adding a
  task or a category rewrote the whole document and hoisted that line to the
  top, shifting the user's blank lines with it.

  A file with no opening heading still gains the leading `# TODO` line — that
  is a locked rule, deliberately unchanged.

### Added
- Thirteen tests covering the preamble: round-trip fidelity, menu visibility,
  inline tags, reordering, moving across the heading boundary (allowed, the
  boundary follows, and the result is stable), and title position. Tests:
  131 → 144.

## 0.11.6 - 2026-10-02

### Fixed
- Starting a task edit or a per-category add entry while the "new category"
  entry was open left both on screen at once — two focusable text entries in the
  same menu, from a single interaction. `_startEditing()` and `_toggleAdd()`
  now close the new-category entry too, so the single-interaction rule holds
  across all three states.

### Added
- A static guard that actually enforces that rule. The two existing guards
  only ever compared two of the three edit-state fields, so the suite reported
  green on exactly this bug; the new one checks that opening any of the three
  states closes the other two (directly or through `_cancelEditing()`), and
  names the offending line and the missing fields. Tests: 130 → 131.

## 0.11.5 - 2026-10-02

### Fixed
- **Data loss (audit D1): an emptied todo file no longer wipes every category
  color, permanently.** The menu pruned dead color keys against the raw
  document, whose category list is empty when the file is empty — while the
  menu itself was rendering the implicit `General` header. So emptying
  `~/todo.md` (a stray `:dgg`, a `> todo.md` redirect, any script) and letting
  the file monitor fire deleted the whole color map through `set_value`, with
  no way to get it back. The header also rendered uncolored until the next
  refresh.

  The category list is now derived once, by `Storage.renderSections()`, and the
  prune goes through it — the menu rows and the prune can no longer disagree
  about which categories exist. Genuinely dead keys are still pruned.

### Added
- `Storage.renderSections()` — the single source of truth for "which
  categories exist right now" (pure, unit-tested).
- Regression coverage for the data-loss path, plus a static guard that pins the
  prune to `sections` so the UI half cannot drift back. Tests: 125 → 130.

## 0.11.4 - 2026-10-02

### Changed
- `metadata.json` `description` rewritten for extensions.gnome.org. It was
  a single 41-character sentence; it now states what the extension does, lists
  the shipped features as bullets, names the tested configuration, and
  **declares its file access** — the extension reads and writes one user file,
  so reviewers expect that spelled out. Format follows the review guidelines
  (`\n` paragraphs, `*` bullets). No behaviour change.

### Added
- A static guard keeps the description honest: it must declare file access,
  name the supported shell version, and use a bullet list. Tests: 124 → 125.

## 0.11.3 - 2026-10-02

### Fixed
- Comment integrity in `extension.js` (audit D7). Four defective JSDoc blocks
  are gone:
  - `_makeNewCategoryRow`: the docstring had been duplicated verbatim.
  - `_switchTo`: a truncated, **never-closed** docstring had swallowed four
    lines of dead code *and* `_todoPath()`'s own docstring; both are separated
    again.
  - `_makeTaskRow`: its docstring was stranded above `_capWidth`, leaving the
    method undocumented — moved back onto the method it describes.
  - `_addTask`: a pre-Phase-4 docstring with the wrong signature (`text` only,
    no `category`) sat above the current one.

  None of these were reachable by `node --check`: a duplicated, unclosed or
  misattached docstring is still valid JavaScript. Comment stripping confirms
  the change is comment-only — 584 code lines, token-for-token identical.

### Added
- Three static guards close that blind spot for good (`tests/run_tests.mjs`,
  over `extension.js`, `storage.js` and `prefs.js`): no duplicated JSDoc
  blocks, no live code swallowed by an unclosed one, and every doc block
  attached to a declaration. Each was verified by re-injecting the defect it
  guards against. Test count: 121 → 124.

## 0.11.2 - 2026-10-02

### Fixed
- `schemas/gschemas.compiled` is no longer committed. GNOME 45+ compiles the
  schema at install time, so the binary was dead weight in the package — and
  the single most frequent extensions.gnome.org rejection reason ("Please
  remove `schemas/gschemas.compiled`. Not needed for 45+ packages."). The XML
  stays; the compiled binary is now a gitignored build artifact (it is still
  produced locally, because the extension is installed through a symlink and
  `getSettings()` reads it at runtime).
- The static test that *required* the committed binary — which kept CI green by
  enforcing the rejection reason — is inverted: it now fails if the artifact
  can be tracked by git again.

## 0.11.1 - 2026-09-26

### Fixed
- The far-right `+` (new-category) button of the tab bar was pushed out of
  view: the tab scroller's `min-width` ate the full fixed menu width. The
  scroller now just expands into the remaining space (the menu box itself
  is force-sized), and the horizontal scrollbar still engages when the
  tabs overflow.

## 0.11.0 - 2026-09-26

### Added
- Fixed menu width: the menu frame never widens or shrinks with content
  (new `menu-width` setting, 300–2000 px, default 500 — the single width
  value replaces any min/max split).
- Fixed-width checkbox column at the start of every task row: an empty
  circle when pending, filled with the category color + a white check when
  done — checking a task can never widen the menu.
- Mouse wheel scrolls the category tab bar horizontally anywhere on the
  bar (St's own wheel handler routes the wheel to the vertical adjustment
  only, so `enable-mouse-scrolling` is disabled on the tab scroller).

### Changed
- The category tab bar is always horizontally scrollable: the `shrink`
  mode and the `tab-bar-mode` setting were removed entirely (scroll was
  made the permanent behavior; shrink can return later if needed).
- The tab bar is now a persistent actor: only the tab buttons are
  refilled on refresh, so the horizontal scroll position (and the content
  scroll position) survive every rebuild, including category switches —
  selecting a category no longer jumps to the top.
- More comfortable tab bar spacing/padding.

### Fixed
- The menu width no longer propagates the tabs' large minimum width: the
  menu box is force-sized via CSS `width` + `max-width` (CSS `min-width`
  alone never widens the natural width).
- A shell crash (SEGV): persistent rows attached to `menu.box` must be
  plain actors — `menu.removeAll()` destroys every `menu.box` child whose
  `_delegate` is a `PopupBaseMenuItem` (`popupMenu.js` :827-850).

## 0.10.0 - 2026-09-23

### Changed
- UI labels and the fallback category name are English: the default tab is
  `All` and tasks added without a category UI land under `## General`
  (existing files keep their own category names).

## 0.9.0 - 2026-09-23

### Added
- Scrollable menu content: the menu content area (headers + tasks) scrolls
  once it exceeds the height limit; the tab bar stays fixed above it
  (the shell's own `PopupSubMenu` scroll pattern, `popupMenu.js` 46.0).
- `max-menu-height` setting (200–2000 px, default 400) in the preferences —
  applied live, without a Shell reload.

### Changed
- The scroll area is a persistent part of the menu: content is refilled in
  place, so the scroll position survives every action (edit, move, add,
  delete). A tab switch intentionally starts at the top.

### Fixed
- The tab bar stays the first row above the scroll area.

## 0.8.0 - 2026-09-23

### Added
- Category tabs: a permanent tab bar above the content — `Tümü` (default)
  plus one tab per category. Tabs filter the menu to a single category; the
  active tab is remembered for the session and falls back to `Tümü` when its
  category disappears.
- New-category creation from the menu: a `+` button at the far right of the
  tab bar opens an inline name entry; the new category becomes the active
  tab and is automatically assigned the next palette color (wrapping around
  after the last palette entry).
- Tabs and headers carry the category color.

### Fixed
- Writing the new category file before assigning its auto color — the
  settings-change signal previously triggered the dead-key pruning before
  the file contained the category, erasing the color.

## 0.7.0 - 2026-09-23

### Added
- Category colors: assign a color to any category header from the new
  "Colors" preferences page — a GNOME-palette quick picker plus a free
  color dialog (`Gtk.ColorDialogButton`). Changes reach the panel menu
  instantly through GSettings.
- Dead color entries (categories that no longer exist in the file) are
  pruned automatically, so a later category reusing the name does not
  silently inherit the old color.

### Changed
- GSettings schema gained a `category-colors` map (`a{ss}`: category name
  → CSS hex color); colors are validated against a strict hex pattern
  before being applied as inline styles.

### Fixed
- Palette selection now keeps the color dialog button in sync.
- Prefs process no longer crashes on a missing static GTK helper
  (`Gtk.StyleContext.add_provider_for_display` is the GJS-exposed form).

## 0.6.0 - 2026-09-23

### Added
- Add tasks to any category: every category header (including empty ones)
  has a '+' button that opens an inline add entry for that exact category.
- An empty file starts with an implicit `Genel` header, so the first task
  can be added without hand-editing.

### Changed
- The top "Add a task…" entry and the 'No tasks' placeholder row were
  removed — adding is now exclusively per-category.
- `addTask(content, text, categoryName)` targets a named category (default
  `Genel`); a missing category is created at the end of the document.

### Fixed
- Opening a task edit no longer leaves a category add entry open (missed
  single-interaction reset); the invariant is now pinned by static checks.

## 0.5.0 - 2026-09-23

### Added
- Preferences window (GTK4 + Adwaita): set a custom path for your markdown
  todo file (empty = the default `~/todo.md`; `~`/`~/` expansion supported),
  with a reset-to-default button.
- GSettings schema (`todo-file-path`) with compiled schemas shipped in the
  extension directory.
- The file monitor live-reconnects when the path setting changes.
- GitHub Actions CI: unit/integration tests, strict schema compile and JS
  syntax checks on every push/PR.

### Changed
- File access is path-explicit: `readTodo(path)` / `writeTodo(path, content)`;
  pure path resolution (`~` expansion, default fallback) lives in storage.js.
- `writeTodo()` now requires `(path, content)` and throws loudly on a wrong
  call signature instead of silently writing an empty file.

### Fixed
- Write error log reported the default path instead of the actual path.

## 0.4.0 - 2026-09-17

### Changed
- Renamed the extension: the UUID is now `gnome-todo-md@ertugrulsefal.github.com`
  (previously the development-only `todo@ertugrul.local`) and the display
  name is "Todo MD". The extension directory, install and enable commands
  changed accordingly — reinstall (or re-symlink) to upgrade.

## 0.3.0 - 2026-09-15

### Added
- Categorized file format: `#` document title, `## Category` sections, and
  tasks with free-form `@tag(value)` pairs (ordered pairs, no whitelist,
  unknown tags are preserved and written back).
- Category section headers in the menu (non-clickable, bold); tasks are
  grouped under their category.
- Within-category move up/down buttons (hidden at the category edges);
  adjacent tasks swap positions and interleaved note/blank lines keep their
  slots.
- "Genel" fallback: tasks added without a category UI always land under a
  real `## Genel` heading in the file.
- Extensibility skeleton (no UI yet): `addCategory()` and `addTaskTag()`
  storage helpers, unit-tested in isolation.
- Atomic write path pinned: `Gio.File.replace_contents` (temp + rename) is
  the only write mechanism, enforced by a static guard plus end-to-end
  write/read round-trip tests.

### Changed
- Menu rows are built from the Document model; labels show tag-stripped text
  while the inline editor prefills the raw text so edits keep tags.
- Deliberate file normalizations: `[X]` → `[x]`, `##Name` → `## Name`,
  canonical `- [ ] ` task prefix, exactly one trailing newline, and a
  `# TODO` line added when the file has no H1.
- Non-task lines (notes, blanks) are preserved verbatim and never rendered
  in the menu.

### Fixed
- Byte-identical round-trip for unchanged files — including the real
  `~/todo.md` (implicit-Genel / preItems handling).

## 0.2.0 - 2026-09-14

### Added
- In-place task editing: an edit button on each row turns the label into a
  `St.Entry` (Enter saves, empty text cancels). Exactly one edit box can be
  open at any time (single `_editingIndex` invariant).
- Static API-regression checks in `tests/run_tests.mjs` guarding every past
  UI-layer mistake (idle_add arity, x_expand vs hexpand, GLib.Bytes, key
  signal names, forbidden CSS opacity, shell-version pin).

### Fixed
- `GLib.idle_add` was called with a single argument, so the deferred
  menu-open rebuild never ran (latent Phase 1 bug).
- Inline editing is keyboard-usable: the edit entry is focused after being
  mapped, and clicking the add-task entry reliably closes an open edit.

## 0.1.0 - 2026-09-07

### Added
- Panel menu listing tasks from `~/todo.md` (markdown checkbox format).
- Add tasks via a top entry (Enter), delete via a per-row trash button,
  check/uncheck by clicking a row.
- Live refresh when `~/todo.md` changes externally (`Gio.FileMonitor`).
- Completed tasks are struck through and faded.
- Pure storage layer (`storage.js`) with a unit/integration test suite and a
  smoke check that the extension stays `State: ACTIVE`.
