# gnome-todo-md (GNOME Shell Extension)

A minimal, fast todo list for the GNOME Shell panel, backed by a plain
**markdown checkbox** file (`~/todo.md`) — no database, no proprietary format,
no cloud. Readable in any editor, on any device.

Target: **GNOME 46** (tested on Ubuntu 24.04, X11). Written in JavaScript
(ESModules, GJS).

## Why

Existing todo extensions for GNOME 46 were outdated (todo.txt, GNOME ≤45
APIs, broken builds) or lacked even basic categorization. This project keeps
it simple: one markdown file, live panel menu, nothing else.

## Features

- Panel indicator with a popup menu listing your tasks from `~/todo.md`
- **Fixed menu width** (user-adjustable): the menu frame never widens or
  shrinks with content; long texts truncate with an ellipsis
- **Tabs**: a permanent, horizontally scrollable tab bar (`All` + one tab
  per category) filters the menu to a single category; the scroll position
  survives every rebuild and the mouse wheel scrolls the bar anywhere. A
  **`+` at the far right** creates a new category (auto-colored from the
  palette, in order, wrapping around); tabs and headers carry the category
  color
- **Scrollable menu**: content taller than the configured limit scrolls;
  the tab bar stays fixed and both scroll positions survive every action
  (including category switches)
- **Checkbox column**: every task row starts with a fixed-width circle —
  filled with the category color + a check when done — so checking a task
  can never widen the menu
- **Categories**: `## Category` sections render as non-clickable headers;
  tasks are grouped under them — every category header (including empty
  ones) has a **`+` button** that opens an inline entry to add a task right
  there; an empty file starts with an implicit `General` section
- **Reordering**: move tasks up/down within their category
- **Category colors**: assign a color to any category header from the
  preferences window (GNOME palette quick-picks or a free color dialog);
  changes apply to the panel menu instantly and dead entries are pruned
  automatically
- **Tags**: free-form `@tag(value)` pairs on any task (ordered, unknown tags
  are preserved — no whitelist)
- Inline editing (Enter saves), delete, check/uncheck (click the row)
- Completed tasks get strikethrough + faded text
- Live reload: external edits to `~/todo.md` (vim, atomic writes, whatever)
  are picked up instantly via `Gio.FileMonitor`

## Settings

Point the extension at any markdown file via the preferences window:

```bash
gnome-extensions prefs gnome-todo-md@ertugrulsefal.github.com
```

(Or: Extensions app → Todo MD → the gear icon.)

- The **Todo file path** entry defaults to `~/todo.md` (an empty value
  means the default); `~` and `~/` paths are expanded to your home directory.
- The todo file is watched live; changing the path re-wires the watcher
  immediately — no Shell reload needed.
- **Max menu height** (200–2000 px, default 400) limits the scrollable
  content area.
- **Menu width** (300–2000 px, default 500) fixes the menu frame width;
  long task texts truncate with an ellipsis and the tab bar scrolls
  horizontally at this width.

## The file format

```markdown
# My TODOs

## General

- [ ] buy milk @due(mon)
- [x] already done

## Work

- [ ] report @p(1)
```

Anything that is not a `##` heading or a checkbox line (notes, blank lines)
is preserved verbatim on every rewrite — the file stays hand-editable.

## File layout

| Path | Purpose |
|---|---|
| `gnome-todo-md@ertugrulsefal.github.com/extension.js` | UI layer: panel, menu, entry, rows |
| `gnome-todo-md@ertugrulsefal.github.com/storage.js` | Pure functions: parse, mutate, serialize `~/todo.md` |
| `gnome-todo-md@ertugrulsefal.github.com/metadata.json` | Extension metadata (shell-version: 46) |
| `gnome-todo-md@ertugrulsefal.github.com/stylesheet.css` | Menu styling |
| `tests/run_tests.mjs` | Unit/integration tests for `storage.js` (run with `gjs`) |
| `tests/smoke.sh` | Check the extension is `State: ACTIVE` |
| `docs/verified-apis.md` | VERIFY-BEFORE-WRITE evidence log (API → source → verdict) |

## Install

```bash
git clone https://github.com/ErtugrulSefaL/gnome-todo-md
cd gnome-todo-md
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$(pwd)/gnome-todo-md@ertugrulsefal.github.com" \
      ~/.local/share/gnome-shell/extensions/gnome-todo-md@ertugrulsefal.github.com
```

Then reload GNOME Shell:

- X11: press `Alt+F2`, type `r`, Enter (or log out/in on Wayland)
- Enable: `gnome-extensions enable gnome-todo-md@ertugrulsefal.github.com`

## Test

```bash
# storage logic (no GNOME Shell needed)
gjs -m tests/run_tests.mjs

# extension state check (after any UI change + Shell reload)
./tests/smoke.sh
```

Tests snapshot `~/todo.md` before running and restore it byte-identically.

## Roadmap

- [x] Phase 1 — core menu (list / add / delete / check) + live reload
- [x] Phase 1.5 — in-place task editing
- [x] Phase 2 — categories, within-category ordering, free-form tags
- [x] Phase 3 — settings + custom todo file path
- [x] Phase 4 — add tasks to any category (per-category `+`)
- [x] Phase 5 — category colors (settings + preferences picker)
- [x] Phase 6 — category tabs + in-menu category creation
- [x] Phase 6.5 — scrollable menu with a configurable max height
- [x] Phase 6.6 — fixed menu width, always-scrollable persistent tab bar,
      fixed checkbox column, wheel scrolling, scroll position preservation
- [ ] Phase 7 — live date tags (`@due`/`@start`)
- [ ] Phase 8 — notifications + archiving
- [ ] Phase 9 — keyboard shortcut
- [ ] Phase 10 — desktop-pinned widget

## License

GPL-3.0 — see `LICENSE`.
