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
- **Categories**: `## Category` sections render as non-clickable headers;
  tasks are grouped under them
- **Reordering**: move tasks up/down within their category
- **Tags**: free-form `@tag(value)` pairs on any task (ordered, unknown tags
  are preserved — no whitelist)
- Tasks added from the menu land under a real `## Genel` (general) section
- Inline editing (Enter saves), delete, check/uncheck (click the row)
- Completed tasks get strikethrough + faded text
- Live reload: external edits to `~/todo.md` (vim, atomic writes, whatever)
  are picked up instantly via `Gio.FileMonitor`

## The file format

```markdown
# My TODOs

## Genel

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
| `todo@ertugrul.local/extension.js` | UI layer: panel, menu, entry, rows |
| `todo@ertugrul.local/storage.js` | Pure functions: parse, mutate, serialize `~/todo.md` |
| `todo@ertugrul.local/metadata.json` | Extension metadata (shell-version: 46) |
| `todo@ertugrul.local/stylesheet.css` | Menu styling |
| `tests/run_tests.mjs` | Unit/integration tests for `storage.js` (run with `gjs`) |
| `tests/smoke.sh` | Check the extension is `State: ACTIVE` |
| `docs/verified-apis.md` | VERIFY-BEFORE-WRITE evidence log (API → source → verdict) |

## Install

```bash
git clone https://github.com/ErtugrulSefaL/gnome-todo-md
cd gnome-todo-md
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s "$(pwd)/todo@ertugrul.local" \
      ~/.local/share/gnome-shell/extensions/todo@ertugrul.local
```

Then reload GNOME Shell:

- X11: press `Alt+F2`, type `r`, Enter (or log out/in on Wayland)
- Enable: `gnome-extensions enable todo@ertugrul.local`

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
- [ ] Phase 3 — notifications + archiving
- [ ] Phase 4 — keyboard shortcut
- [ ] Phase 5 — desktop-pinned widget

## License

GPL-3.0 — see `LICENSE`.
