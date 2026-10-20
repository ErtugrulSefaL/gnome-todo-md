# EGO Submission Notes

Notes for the "Comments for reviewer" field on extensions.gnome.org. Update the
version line before each upload.

**Current upload: 0.20.1** — drag-and-drop reordering, the insertion-line fix,
GNOME 46–50 support and every fix from the 0.15.0 review window. It supersedes
the 0.15.0 upload that is still waiting for review; uploading over a pending
review is allowed (GNOME extensions maintainer, discourse.gnome.org/t/9205), and
the reviewer is asked on the review page to look at this one instead:

> Version 0.20.1 supersedes 0.15.0 — please review this one instead. It contains
> the fixes for everything reported so far, plus drag-and-drop reordering. The
> notes on this upload describe what changed.

---

**Todo MD 0.20.1 — notes for the reviewer**

**What it does:** A panel menu over a plain markdown checkbox file (`~/todo.md`
by default, path configurable). Categories are `##` headings, rendered as tabs;
tasks support check/uncheck, inline edit, delete, drag-and-drop reorder, and
inline add per category.

**New since the 0.15.0 upload:** drag-and-drop reordering — a grip handle at the
end of every row; the task moves inside its own category, with an insertion line
and a no-drop cursor over another category's rows — and keyboard reordering with
Alt+Up / Alt+Down on a focused row, which replaced the old per-row up/down
buttons. `shell-version` now covers GNOME 46–50, and the findings from this
review window (a colour-map wipe on an unreadable file, a blank line inventing a
"General" category, theme-invisible controls and scrollbars) are all fixed here.

**Drag-and-drop integration (disclosure):** reordering uses GNOME Shell's own
drag-and-drop module (`resource:///org/gnome/shell/ui/dnd.js`, `makeDraggable`)
rather than a reimplementation. One non-obvious detail, measured on GNOME 50:
a drag monitor's `dragDrop` must return `CONTINUE` — returning `SUCCESS` or
`FAILURE` makes the Shell skip its own cleanup, so the drag actor and the modal
grab leak and `drag-end` never fires. The drop itself is handled by the row's
`acceptDrop`.

**File access (disclosure):** The extension reads and writes exactly one
user-configured markdown file plus its own GSettings schema. No network access,
no subprocesses, no clipboard use. Writes go through `Gio.File.replace_contents`
(temp-file + rename, atomic). A `Gio.FileMonitor` on the file picks up external
edits live; the extension's own writes are recognised and do not trigger a
second rebuild.

**Synchronous file IO (Shexli EGO-X-004):** Deliberate. The todo file is small
(a user's task list, typically < 100 lines); it is read once per menu refresh
and written only on user actions. An async implementation would restructure
every mutation path for no practical latency benefit at this size. Happy to
change it if you consider it a requirement.

**Shell internals (`Main.panel.addToStatusArea`, popup menu, drag-and-drop):**
The standard indicator pattern from the gjs.guide "Getting Started" guide, plus
the Shell's own popup-menu and drag-and-drop modules. They live in GNOME Shell's
JS internals with no stability guarantee, so `shell-version` declares only the
versions this code has been regression-tested on: `["46", "47", "48", "49",
"50"]`. Each one was validated individually — the API probe plus the same
18-point manual regression checklist — in its own VM: Ubuntu 24.04 (GNOME 46),
24.10 (47), 25.04 (48), 25.10 (49) and 26.04 (50). A static guard pins the exact
list, so adding a version is always a deliberate act that follows a test.

**Lifecycle (Shexli EGO-L-002/EGO-L-003, static-analyzer false positives):**
`disable()` explicitly destroys every long-lived actor — the persistent scroll
wrapper (owner of the content section), the persistent tab bar (owner of the
new-category button and its signal), the indicator and the drag insertion line —
and disconnects every signal held on long-lived objects (4× GSettings, indicator
menu, file monitor, `St.Settings` colour scheme). The analyzer cannot trace
actor ownership; the objects it flags are destroyed through their owners.

**Testing:** GNOME Shell 46 (Wayland and X11), 47, 48, 49 and 50 on Ubuntu
24.04, 24.10, 25.04, 25.10 and 26.04. 249 unit tests cover the storage layer
(pure string-in/string-out functions, byte-identical round-trip); the UI layer
was verified manually in every one of those shells against the same written
regression checklist (18 checks), which includes an Orca accessibility pass.
Drag-and-drop was additionally verified in the GNOME 46 (X11), 47 and 48 VMs.

**Static analysis:** ego-lint reports no hard failures (its remaining findings
are warnings, all pre-existing and explained in the repository); Shexli reports
0 errors / 3 warnings, addressed above.

---

## Screenshot procedure (per upload)

EGO wants a screenshot; the extension menu closes on focus loss, so the capture
must NOT steal focus. Procedure (GNOME 50, Wayland):

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
3. **Capture while the menu is OPEN:**
   ```
   tools/ego-screenshot.sh /tmp/ego-full.png
   ```
   No dialog, no input grab, no focus change — the menu survives the capture
   (see "Why the portal does work" below). `gnome-screenshot` is dead here.
4. **Crop to the menu only** (privacy: the full screen contains personal
   content). The script crops as its second argument:
   ```
   tools/ego-screenshot.sh ~/Pictures/ego-menu.png 700x520+1700+40
   ```
   The agent can read and judge the crop via image reading.

   Measured example on this machine (3840x1080, menu at the top-right, panel
   indicator just above it) — adjust so the menu fills the frame:
   ```
   tools/ego-screenshot.sh /tmp/ego-full.png           # 3840x1080
   magick /tmp/ego-full.png -crop 520x500+3320+30 +repage /tmp/ego-menu.png
   ```

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

### Why the portal does work (verified 2026-10-12)

`org.gnome.Shell.Screenshot`'s `DBusSenderChecker` does not compare names as
strings: it resolves every allow-listed WELL-KNOWN name to its current unique
owner with `Gio.DBus.watch_name` (`misc/util.js`). So any caller that reaches
the Shell THROUGH an allow-listed name passes — and
`org.freedesktop.impl.portal.desktop.gnome` is still on the list. That makes
the xdg-desktop-portal route the supported one.

Runtime proof (GNOME 50.1, Wayland):

```
$ tools/ego-screenshot.sh /tmp/ego-full.png
saved: /tmp/ego-full.png
/tmp/ego-full.png PNG 3840x1080 8-bit sRGB 2.48MiB
```

The portal answered `Response code 0` immediately — **no permission dialog, no
input grab, no focus change** — and the capture contains the Shell's own UI
(panel and menus), which is exactly what an EGO screenshot needs. Compare with
the shell's own `Print` UI, which grabs input and would close the open menu.

End-to-end check (2026-10-12, extension menu left OPEN on the panel):

```
$ tools/ego-screenshot.sh /tmp/ego-full.png      # 3840x1080, menu still open
$ magick /tmp/ego-full.png -crop 520x500+3320+30 +repage /tmp/ego-menu.png
```

The crop shows the tab bar (All / Cyber / Python / … with per-category
colours), the category headers with their ⋮ action button, the task rows with
their done/undone state and the drag handle at the end of every row — i.e. the
menu survived the capture intact.

Tool: `tools/ego-screenshot.sh [out.png] [WxH+X+Y]` (crop uses ImageMagick).

### Where a screenshot lives (storage rule, 2026-10-20)

- Screenshots are archived **in the repository**: `docs/screenshots/todo-md-<version>.png`,
  named after the **version the image actually shows** (not after the version
  that is being uploaded next). The same file serves the README and the EGO
  upload.
- Take one only when a screenshot is actually captured **and** an upload is
  decided — not once per version. A version with no new capture reuses the
  previous image.
- Division of labour: **the user takes and crops the image**; the agent only
  prepares the path (a placeholder file if the README needs to reference it
  before the real capture exists) and wires it into the README. The agent never
  edits or crops the image itself.

### Candidates that were evaluated (2026-10-11, kept for the record)

1. `org.freedesktop.portal.Screenshot` — **chosen** (see above).
2. A nested/devkit shell (`dbus-run-session gnome-shell --devkit --wayland`) —
   rejected: Ubuntu ships no `/usr/libexec/mutter-devkit`, so `--devkit` opens
   no window. It remains the right tool for driving a REAL session without
   touching the live one (used for the Faz 9 spike, headless + a virtual
   pointer), not for screenshots.

## Upload checklist (pre-flight)

- [ ] Zip rebuilt from HEAD: `bash tools/make-package.sh` (output:
      `dist/todo-md@ertugrulsefal.github.com-<version>.zip`)
- [ ] ego-lint on the extracted zip: 0 failed
- [ ] Shexli on the zip: 0 errors (`pip install shexli 'tree-sitter==0.25.0'` —
      0.26 segfaults; verify with a broken fixture first, the tool is
      version-gated and fails silently — see docs/verified-apis.md)
- [ ] `metadata.json` version-name matches the CHANGELOG release
- [ ] Notes above updated to the new version
- [ ] Screenshot: `docs/screenshots/todo-md-<version>.png` present (real capture,
      not a placeholder) and referenced by the README
- Form fields: Name `Todo MD` · URL `https://github.com/ErtugrulSefaL/gnome-todo-md`
  · version auto-detected from the zip
