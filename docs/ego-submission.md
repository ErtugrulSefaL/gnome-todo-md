# EGO Submission Notes

Notes for the "Comments for reviewer" field on extensions.gnome.org. Update the
version line before each upload. Last used for: **0.15.0**.

---

**Todo MD 0.15.0 — notes for the reviewer**

**What it does:** A panel menu over a plain markdown checkbox file (`~/todo.md`
by default, path configurable). Categories are `##` headings, rendered as tabs;
tasks support check/uncheck, inline edit, delete, reorder, and inline add per
category.

**File access (disclosure):** The extension reads and writes exactly one
user-configured markdown file plus its own GSettings schema. No network access,
no subprocesses, no clipboard use. Writes go through `Gio.File.replace_contents`
(temp-file + rename, atomic). A `Gio.FileMonitor` on the file picks up external
edits live.

**Synchronous file IO (Shexli EGO-X-004):** Deliberate. The todo file is small
(a user's task list, typically < 100 lines); it is read once per menu refresh
and written only on user actions. An async implementation would restructure
every mutation path for no practical latency benefit at this size. Happy to
change it if you consider it a requirement.

**`Main.panel.addToStatusArea`:** The standard indicator pattern from the
gjs.guide "Getting Started" guide. It lives in GNOME Shell's own JS internals
(no stability guarantee), so `shell-version` is pinned to `"46"` — the only
version this was tested on.

**Lifecycle (Shexli EGO-L-002/EGO-L-003, static-analyzer false positives):**
`disable()` explicitly destroys every long-lived actor — the persistent scroll
wrapper (owner of the content section), the persistent tab bar (owner of the
new-category button and its signal), and the indicator — and disconnects all
six signals held on long-lived objects (4× GSettings, indicator menu, file
monitor). The analyzer cannot trace actor ownership; the objects it flags are
destroyed through their owners.

**Testing:** GNOME Shell 46.0 on Ubuntu 24.04 (X11). 180 unit tests cover the
storage layer (pure string-in/string-out functions, byte-identical
round-trip); the UI layer was verified manually per change (Orca accessibility
pass included).

**Static analysis:** ego-lint reports 0 errors; Shexli reports 0 errors /
3 warnings, addressed above.

---

## Screenshot procedure (per upload)

EGO wants a screenshot; the extension menu closes on focus loss, so capture it
while open. This session's proven procedure (GNOME 46, **Wayland** session):

1. **Back up first:** `cp ~/todo.md ~/.todo-backup/todo.md.<ts>` (record md5)
   and `dconf read /org/gnome/shell/extensions/todo-md/category-colors` into a
   backup file. Restore byte-identically afterwards and verify by md5.
   ⚠️ RACE (hit 2026-10-10): the file monitor fires on the restore `cp`, and a
   refresh that runs while the demo colour map is still set prunes ALL demo
   keys and writes `{}` — its commit can land AFTER your `dconf write` (two
   separate dconf clients, no cross-client commit ordering). So after
   restoring the map, WAIT a few seconds, READ IT BACK, and re-write if it was
   wiped. Verify stability before calling the restore done.
2. **Demo content:** write an attractive English markdown todo file (varied
   done/undone states) and set demo category colors via
   `dconf write /org/gnome/shell/extensions/todo-md/category-colors "{...}"`.
   NOTE: no blank line between the `# title` and the first `##` heading — a
   blank line there becomes an implicit empty 'General' section in the menu.
3. **Capture on Wayland:** X11 grabbers (`import`, `xwd`, `ffmpeg x11grab`)
   CANNOT see the Wayland compositor (xwd fails BadMatch @ X_GetImage), and
   calling `org.gnome.Shell.Screenshot` via gdbus is denied — gnome-shell 46.0
   `js/ui/screenshot.js:2433-2455` allow-lists only a few well-known names,
   including `org.gnome.Screenshot`. Install `gnome-screenshot` (uses that
   allow-listed name) and run `gnome-screenshot -f file.png` while the menu is
   open — works headless, no focus steal, no dialog.
4. **Crop to the menu only** (privacy: the full screen contains personal
   content). The agent can read and judge the crop via image reading.

## Upload checklist (pre-flight)

- [ ] Zip rebuilt from HEAD: `bash tools/make-package.sh` (output:
      `dist/todo-md@ertugrulsefal.github.com-<version>.zip`)
- [ ] ego-lint on the extracted zip: 0 failed
- [ ] Shexli on the zip: 0 errors (`pip install shexli 'tree-sitter==0.25.0'` —
      0.26 segfaults; verify with a broken fixture first, the tool is
      version-gated and fails silently — see docs/verified-apis.md)
- [ ] `metadata.json` version-name matches the CHANGELOG release
- [ ] Notes above updated to the new version
- Form fields: Name `Todo MD` · URL `https://github.com/ErtugrulSefaL/gnome-todo-md`
  · version auto-detected from the zip
