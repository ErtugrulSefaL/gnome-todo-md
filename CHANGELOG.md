# Changelog

All notable changes to the Todo extension are documented in this file.
The project uses Semantic Versioning (0.y.z until 1.0.0); a version is
assigned only when a phase is completed and approved (see `.goosehints`).

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
