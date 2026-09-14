# Todo (GNOME Shell Extension)

A minimal, fast todo list for the GNOME Shell panel, backed by a plain
**markdown checkbox** file (`~/todo.md`) — no database, no proprietary format,
no cloud. Readable in any editor, any device.

Target: **GNOME 46** (tested on Ubuntu 24.04, X11). Written in JavaScript
(ESModules, GJS).

## Why

Existing todo extensions for GNOME 46 were outdated (todo.txt, GNOME ≤45
APIs, broken builds) or lacked even basic categorization. This project keeps
it simple: one markdown file, live panel menu, nothing else.

## Features

- Panel indicator with a popup menu listing your tasks from `~/todo.md`
- Add task (Enter to submit), delete task, check/uncheck (click the row)
- Completed tasks get strikethrough + faded text (styled via `stylesheet.css`)
- Live reload: external edits to `~/todo.md` (vim, atomic writes, whatever)
  are picked up instantly via `Gio.FileMonitor`
- Data file is portable markdown: `- [ ] task` / `- [x] task`

## File layout

| Path | Purpose |
|---|---|
| `todo@ertugrul.local/extension.js` | UI layer: panel, menu, entry, rows |
| `todo@ertugrul.local/storage.js` | Pure functions: parse + mutate `~/todo.md` content |
| `todo@ertugrul.local/metadata.json` | Extension metadata (shell-version: 46) |
| `todo@ertugrul.local/stylesheet.css` | Menu styling |
| `tests/run_tests.mjs` | Unit/integration tests for `storage.js` (run with `gjs -m`) |
| `tests/smoke.sh` | Check the extension is `State: ACTIVE` |
| `docs/verified-apis.md` | VERIFY-BEFORE-WRITE evidence log (API → source → verdict) |
| `plan.md` / `test.md` | Phase plan and test report |

## Install

Symlink the extension folder into your user extensions directory:

```bash
mkdir -p ~/.local/share/gnome-shell/extensions
ln -s /home/ertugrul/projects/todo-extension/todo@ertugrul.local \
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

## Manual testing after a change

1. Reload Shell: `Alt+F2` → `r`
2. Check extension state: `gnome-extensions info todo@ertugrul.local` (or `./tests/smoke.sh`)
3. Exercise the menu: add / check / delete tasks, edit `~/todo.md` externally, watch live reload
4. Watch for errors: Looking Glass (`Alt+F2` → `lg`) or `journalctl -f`

## Roadmap

See `plan.md`. Phase 1 (core menu + live reload) and Phase 1.5 (in-place
editing) are complete. Next: Phase 2 (categorization, ordering, tags),
Phase 3 (notifications + archiving), Phase 4 (keyboard shortcut),
Phase 5 (desktop-pinned widget).

## License

GPL-3.0 — see `LICENSE`.
