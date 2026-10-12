# EGO Submission Notes

Notes for the "Comments for reviewer" field on extensions.gnome.org. Update the
version line before each upload. Last used for: **0.15.0** (review pending).
Next upload: **0.19.0** — GNOME 50 support plus verified support for 46-49 and
two bug fixes (do not upload while 0.15.0 is still under review).

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
(no stability guarantee), so `shell-version` declares only the versions this
code has been regression-tested on: `["46", "47", "48", "49", "50"]`. Each one
was validated individually — the API probe plus the same 18-point manual
regression checklist — in its own VM: Ubuntu 24.04 (GNOME 46), 24.10 (47),
25.04 (48), 25.10 (49) and 26.04 (50). A static guard pins the exact list, so
adding a version is always a deliberate act that follows a test.

**Lifecycle (Shexli EGO-L-002/EGO-L-003, static-analyzer false positives):**
`disable()` explicitly destroys every long-lived actor — the persistent scroll
wrapper (owner of the content section), the persistent tab bar (owner of the
new-category button and its signal), and the indicator — and disconnects all
six signals held on long-lived objects (4× GSettings, indicator menu, file
monitor). The analyzer cannot trace actor ownership; the objects it flags are
destroyed through their owners.

**Testing:** GNOME Shell 46, 47, 48, 49 and 50 on Ubuntu 24.04, 24.10, 25.04,
25.10 and 26.04 (all Wayland). 250 unit tests cover the storage layer (pure
string-in/string-out functions, byte-identical round-trip); the UI layer was
verified manually in every one of those shells against the same written
regression checklist (18 checks), which includes an Orca accessibility pass.

**Static analysis:** ego-lint reports 0 errors; Shexli reports 0 errors /
3 warnings, addressed above.

---

## Screenshot procedure (per upload)

🔴 **BROKEN ON GNOME 50 — the capture step must be re-solved before the next
upload.** The backup/restore discipline (steps 1-2) is unaffected and still
applies; step 3 is dead. Details after the procedure.

EGO wants a screenshot; the extension menu closes on focus loss, so the capture
must NOT steal focus. Original procedure (GNOME 46, Wayland):

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
3. ~~**Capture on Wayland:** install `gnome-screenshot` and run
   `gnome-screenshot -f file.png` while the menu is open.~~
   **DEAD on GNOME 50 — see "Why the old capture no longer works" below.**
4. **Crop to the menu only** (privacy: the full screen contains personal
   content). The agent can read and judge the crop via image reading.

### Why the old capture no longer works (verified 2026-10-11)

`gnome-screenshot` talks to `org.gnome.Shell.Screenshot`, whose
`DBusSenderChecker` allow-list was NARROWED in GNOME 50:

| GNOME 46.0 (`js/ui/screenshot.js`) | GNOME 50.1 |
|---|---|
| `org.gnome.SettingsDaemon.MediaKeys` | `org.gnome.SettingsDaemon.MediaKeys` |
| `org.freedesktop.impl.portal.desktop.gtk` | *(removed)* |
| `org.freedesktop.impl.portal.desktop.gnome` | `org.freedesktop.impl.portal.desktop.gnome` |
| `org.gnome.Screenshot` | **(removed)** |

Runtime proof on this machine (GNOME 50.1, Wayland):

```
$ gnome-screenshot -f /tmp/shot-test.png
** Message: Unable to use GNOME Shell's builtin screenshot interface,
            resorting to fallback X11.
Gdk-CRITICAL: gdk_pixbuf_get_from_surface: assertion 'width > 0 && height > 0' failed
$ ls /tmp/shot-test.png   -> no such file
```

The X11 fallback is gone as well (GNOME 50 removed X11), so no file is written.
X11 grabbers (`import`, `xwd`, `ffmpeg x11grab`) were already unusable on
Wayland, and the shell's own screenshot UI (`Print`) is interactive — it grabs
input, which closes the open menu.

### Candidates to evaluate at upload time

1. `org.freedesktop.portal.Screenshot` — the GNOME portal backend is still
   allow-listed; check whether it prompts (a dialog would close the menu).
2. A nested/devkit shell (`dbus-run-session gnome-shell --devkit --wayland`) or
   `gnome-shell-test-tool --extension <zip>`, capturing from inside that session
   so the live session is untouched.

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
