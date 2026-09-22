# Changelog

All notable changes to the Todo extension are documented in this file.
The project uses Semantic Versioning (0.y.z until 1.0.0); a version is
assigned only when a phase is completed and approved (see `.goosehints`).

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
