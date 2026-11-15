# EGO Submission Notes

Notes for the "Comments for reviewer" field on extensions.gnome.org. Update the
version line before each upload.

**Current upload: 0.23.0** (upload prepared 2026-11-15, user decision) — it closes
the three Shexli findings the previous upload was rejected on, and carries
drag-and-drop for tasks and categories, GNOME 46–51 support and every fix from
the 0.15.0 review window, plus this release's own fixes. It supersedes the
review is allowed (GNOME extensions maintainer, discourse.gnome.org/t/9205), and
the reviewer is asked on the review pages to look at this one instead:

> Version 0.23.0 supersedes 0.22.2 (rejected) and the still-pending 0.15.0 and
> 0.20.1 — please review this one instead. It closes the three Shexli findings
> the previous upload was rejected on, plus the fixes listed below. The notes on
> this upload describe what changed.

**Rejected: 0.22.2** (uploaded 2026-10-23, **rejected 2026-11-06**) — the
reviewer never read the code ("Didn't review. Shexli issues need to be addressed
first."). The rejection was the three Shexli gate findings (`EGO-X-004`
synchronous read, `EGO-L-002` six actors, `EGO-L-003` one signal); all three are
closed in 0.23.0 (see the notes below). **Exit criterion: the review page's
Shexli panel must show 0 findings** (`L-060`).

> The reviewer notes below are the 0.23.0 notes; the gate measurements are the
> 2026-11-15 run on `dist/todo-md@ertugrulsefal.github.com-0.23.0.zip`.

---

## Coding criteria (the two pages the reviewer linked)

The 0.22.2 rejection named `best-practices.html` and
`review-guidelines.html#rules`. Both live in the local clone at
`docs/gjs-guide/docs/extensions/review-guidelines/`; cite them by **file path +
line number**. Every code change is measured against them.

**Todo MD 0.23.0 — notes for the reviewer**

**What it does:** A panel menu over a plain markdown checkbox file (`~/todo.md`
by default, path configurable). Categories are `##` headings, rendered as tabs;
tasks support check/uncheck, inline edit, delete, drag-and-drop reorder, and
inline add per category. The source is split into 11 single-responsibility
modules (the lifecycle file dropped from 1672 to 282 lines); behaviour is
unchanged and `storage.js` keeps the pure string-in/string-out document logic.

**New since the 0.15.0 upload (shipped in 0.22.2):** drag-and-drop reordering — a
grip handle at the end of every row; the task moves inside its own category, with
an insertion line and a no-drop cursor over another category's rows — and
keyboard reordering with Alt+Up / Alt+Down on a focused row, which replaced the
old per-row up/down buttons. Categories reorder the same way: a tab is dragged
along the strip and the file's `##` order is rewritten to match; the tab bar is a
segmented control now (a raised pill for the active tab, the strip scrolls
itself, and its scrollbar appears only while the tabs actually overflow), the
task list and the tab strip keep their scroll position across rebuilds, every
icon-only button shares one flat round style, and the category action panel fades
in — skipped under reduced motion. `shell-version` now covers GNOME 46–51, and
the findings from this review window (a colour-map wipe on an unreadable file, a
blank line inventing a "General" category, theme-invisible controls and
scrollbars, an empty todo file on GNOME 51) are all fixed here.

**Drag-and-drop integration (disclosure):** reordering uses GNOME Shell's own
drag-and-drop module (`resource:///org/gnome/shell/ui/dnd.js`, `makeDraggable`)
rather than a reimplementation. One non-obvious detail, measured on GNOME 50:
a drag monitor's `dragDrop` must return `CONTINUE` — returning `SUCCESS` or
`FAILURE` makes the Shell skip its own cleanup, so the drag actor and the modal
grab leak and `drag-end` never fires. The drop itself is handled by the row's
`acceptDrop`.

**File access (disclosure):** The extension reads and writes exactly one
user-configured markdown file plus its own GSettings schema. No network access,
no subprocesses, no clipboard use. Reads are asynchronous (`load_contents_async`
+ `load_contents_finish`); writes go through `Gio.File.replace_contents`
(temp-file + rename, atomic). A `Gio.FileMonitor` on the file picks up external
edits live; the extension's own writes are recognised and do not trigger a
second rebuild.

**Asynchronous file IO (Shexli EGO-X-004) — closed in 0.23.0:** this was the one
genuine defect of the three. `storage.js` now reads the file with
`Gio.File.load_contents_async` + `load_contents_finish` and hands the parsed
`{tasks, other, raw, ok}` to a callback; `extension.js` caches the last read
(`_raw`/`_readOk`) so checking, editing, deleting and reordering stay
synchronous, and the first open shows a placeholder row while the read is in
flight. No call whose name ends in `load_contents`/`load_bytes` ships any more,
so the finding is gone. The write path (`replace_contents`, atomic temp-file +
rename) is synchronous by design and is flagged by neither analyzer. Context:
`.goose/audits/2026-11-08-ego-rejection.md`.

**Shell internals (`Main.panel.addToStatusArea`, popup menu, drag-and-drop):**
The standard indicator pattern from the gjs.guide "Getting Started" guide, plus
the Shell's own popup-menu and drag-and-drop modules. They live in GNOME Shell's
JS internals with no stability guarantee, so `shell-version` declares only the
versions this code has been regression-tested on: `["46", "47", "48", "49",
"50", "51"]`. The API probe plus the same manual regression checklist were run
per environment: Ubuntu 24.04 (GNOME 46), 24.10 (47), 25.04 (48), 25.10 (49),
26.04 (50, host) and 26.10 (51). The 0.23.0 run re-verified the asynchronous read
path on the host (GNOME 50) and in the 46, 47 and 51 VMs; 48 and 49 carry over
from the 0.22.0/0.22.2 rounds (same code). The checklist has 20 checks since
0.23.0 (0.22.1 had added the empty-todo-file case, for 19, and 0.23.0 added a
disable → enable cycle, run twice). A static guard pins the exact shell-version
list, so adding a version is always a deliberate act that follows a test.

**Lifecycle (Shexli EGO-L-002 / EGO-L-003) — closed in 0.23.0:** the analyzer
matches create→destroy by resource name within a scope and cannot trace
ownership, so the cleanup is now written the way the detector expects instead of
argued against. `disable()` unrolls the destroy loop into named
`if (this._x) { this._x.destroy(); this._x = null; }` blocks for
`_actionsDeleteItem`, `_colorRow`, `_contentSection`, `_dropLine`, `_tabDropLine`
and `_dragHint` (children before their owners), and `TabBar` owns its `+` button's
`clicked` signal — its constructor takes `{onNewCategory}`, so the object that
creates the button owns the handler and the button (with its signal) dies with
the tab bar when `disable()` destroys it. Both findings are gone. Context:
`.goose/audits/2026-11-08-ego-rejection.md`.

**Other fixes in 0.23.0:**
- **The empty-state row works on GNOME 46 and 47 again.** `menuView.js` passed
  `orientation: Clutter.Orientation.VERTICAL` into the `St.BoxLayout` constructor,
  but that property exists only from 48 on (`vertical` is the pre-48 name and is
  removed in 51), so the empty-state box could not be built on 46/47 — the same
  failure class 0.22.1 fixed for 51, from the other side. The box is now built
  plain and `compat.setVerticalOrientation()` applies whichever setter exists.
  Found by the 46/47/51 VM tour: the GNOME 46 probe went 58/59 → 59/59.
- **A stale read can no longer overwrite newer content.** `fileSync.js` captures a
  generation counter before an async read and drops the result when a write (or a
  path change) bumped it in the meantime; without the guard an in-flight read
  could restore pre-write content and the next interaction wrote it back.
- **A task drag no longer leaves an inline editor anchored to the wrong line**, the
  preferences window's first page is titled `General` again, and the module split's
  stale identifiers (which stopped the extension from enabling at all) are fixed —
  each covered by new static guards.

**Animation and accessibility:** the Shell patches `Clutter.Actor.ease()` to route
every duration through `enable-animations` / `slow-down-factor` automatically, so
no animation-setting handling is added; the reduce-motion gate
(`St.ReducedMotion`, GNOME 51+) stays, because that patch does not consult it. The
category action panel fades over 250 ms, matching the Shell's own submenu reveal
(it was 400 ms, which outlived the reveal and read as drift). Task rows keep the
Shell's own checkable-menu-item a11y pattern (`Atk.Role.CHECK_MENU_ITEM`, a
`label_actor`, and a `CHECKED` state when on), icon-only buttons carry accessible
names, and the manual regression checklist includes an Orca pass.

**Testing:** GNOME Shell 46 (Wayland and X11), 47, 48, 49 and 50 on Ubuntu
24.04, 24.10, 25.04, 25.10 and 26.04, and GNOME Shell 51 on Ubuntu 26.10. 284
unit tests cover the storage layer
(pure string-in/string-out functions, byte-identical round-trip) and the static
guards; the UI layer
was verified manually in every one of those shells against the same written
regression checklist (20 checks since 0.23.0), which includes an Orca
accessibility pass. The 0.23.0 run covered the host (GNOME 50) and the 46, 47 and
51 VMs; 48 and 49 carry over from the 0.22.0/0.22.2 rounds (same code).
Drag-and-drop was additionally verified in the GNOME 46 (X11), 47 and 48 VMs.

**Static analysis (2026-11-15 run on the 0.23.0 zip):** ego-lint reports **0
failed** — 214 passed, 56 warnings, 10 skipped (280 checks); every warning is
advisory and explained in the repository. Three of them are new in 0.23.0 and
follow directly from the Shexli fixes: `async/no-cancellable` +
`async/missing-cancellable` (the asynchronous read has no `Gio.Cancellable`),
`quality/constructor-resources` ×2 (`TabBar` connects in its constructor — the
shape that clears `EGO-L-003`), and `quality/redundant-cleanup` (the explicit
destroy guards that clear `EGO-L-002`). Each is a deliberate trade-off, not a
defect; the 0.22.2 `R-SLOP-01` pair on the `compat.js` JSDoc annotations is gone.

The Shexli analyzer the review page uses reports **one finding, `EGO-M-004`, and
nothing else** (0 warnings). `EGO-M-004` is the analyzer's own version table,
which stops at GNOME 50 (`shexli/analyzer/rules/metadata.py`: `if major > 50:
future.append(raw)`), so `"51"` reads as an implausible future release — not a
problem with the upload: GNOME 51.0 was released on 2026-09-16 and
extensions.gnome.org itself serves `shell_version=51`. ego-lint's
`metadata/future-shell-version` warning has the same cause. Dropping `51` from
the list would hand GNOME 51 users the older 0.21.0 upload, so it stays. EGO's
own build knows GNOME 51 (it does not show `EGO-M-004`), so the exit criterion is
"**the review page's panel shows 0 findings**", never "the local tool shows 0
findings". `tools/ego-gate.sh` runs the same analyzer on the built zip and fails
on any finding outside the allowlist (`EGO-M-004` only); CI runs it after the
unit tests.

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
- **Amendment (2026-11-15, user decision):** when a release has no UI change, the
  reused capture is **renamed to the shipping version** (`todo-md-0.20.3.png` →
  `todo-md-0.23.0.png`) and the README/EGO reference is updated; the old name does
  not stay behind. Rationale: the README and the EGO upload should point at the
  version being shipped. The cost is that the earlier references to the old name
  in the historical records (`docs/roadmap.md` §C "Public yüzey", `.goose/handoff.md`)
  keep the old path.

### Candidates that were evaluated (2026-10-11, kept for the record)

1. `org.freedesktop.portal.Screenshot` — **chosen** (see above).
2. A nested/devkit shell (`dbus-run-session gnome-shell --devkit --wayland`) —
   rejected: Ubuntu ships no `/usr/libexec/mutter-devkit`, so `--devkit` opens
   no window. It remains the right tool for driving a REAL session without
   touching the live one (used for the Faz 9 spike, headless + a virtual
   pointer), not for screenshots.

## Upload checklist — 0.22.2 (rejected 2026-11-06), for the record

- [ ] **Gate: `bash tools/ego-gate.sh`** — builds the zip, runs the same
      Shexli analyzer the review page uses, and fails on any finding outside
      the documented allowlist (`EGO-M-004` only: the analyzer's metadata table
      stops at GNOME 50). This is the CI gate; the review page's own panel is
      the final criterion.
- [x] Zip rebuilt from HEAD: `bash tools/make-package.sh` (output:
      `dist/todo-md@ertugrulsefal.github.com-<version>.zip`) — 0.22.2, 11 files
- [x] ego-lint on the extracted zip: 0 failed (252 checks, 213 passed, 29 warnings)
- [x] Shexli on the zip: **1 error + 3 warnings on 0.22.2** (`pip install shexli
      'tree-sitter==0.25.0'` — 0.26 segfaults; verify with a broken fixture first,
      the tool is version-gated and fails silently — see docs/verified-apis.md).
      The error is `EGO-M-004` on `shell-version` containing `"51"` and is the
      analyzer's version table (stops at 50), not the package — 0.20.3 and
      0.21.0 produced 0 errors / 3 warnings with the same code paths
- [x] `metadata.json` version-name matches the CHANGELOG release (0.22.2)
- [x] Notes above updated to the new version
- [x] Screenshot: `docs/screenshots/todo-md-0.20.3.png` present (real capture) and
      referenced by the README — no new capture for 0.22.2 (a static image cannot
      show the fade; the rule is to reuse the previous one). **Renamed to
      `todo-md-0.23.0.png` on 2026-11-15** — 0.23.0 has no UI change, so the same
      capture ships under the current name
- [x] Zip verified byte-identical to the published release asset
      (`releases/download/v0.22.2/…-0.22.2.zip`, md5 `80581fcf…`)
- [x] Uploaded to extensions.gnome.org (2026-10-23, user) → review page
      **`/review/77061`**, status `Unreviewed` when this note was written; the
      uploads before it (0.15.0 `/review/76160`, 0.20.1 `/review/76321`) are
      still in the queue and are superseded
- [x] EGO's own "Shexli (experimental)" panel for this upload: **3 warnings, no
      error** — the three findings the notes above answer one by one
- [ ] **EXIT CRITERION (added 2026-11-08, after the rejection): the review page's
      Shexli panel must show ZERO findings before an upload is considered done.**
      "3 warnings, no error" is not a pass — the reviewer reads the panel, not the
      notes, and rejected this upload on exactly those three warnings. The local
      tool's `EGO-M-004` is not the criterion (EGO's build knows GNOME 51 and does
      not show it); the panel is.
- Form fields: Name `Todo MD` · URL `https://github.com/ErtugrulSefaL/gnome-todo-md`
  · version auto-detected from the zip

---

## Upload checklist (pre-flight) — 0.23.0

- [x] **Gate: `bash tools/ego-gate.sh`** — builds the zip, runs the same Shexli
      analyzer the review page uses, and fails on any finding outside the
      documented allowlist (`EGO-M-004` only: the analyzer's metadata table stops
      at GNOME 50). Gate line on 2026-11-15: `OK: only the allowlisted
      finding(s) remain`. This is the CI gate; the review page's own panel is the
      final criterion.
- [x] Zip rebuilt from HEAD: `bash tools/make-package.sh` (output:
      `dist/todo-md@ertugrulsefal.github.com-0.23.0.zip`) — 44148 bytes, 16
      entries (11 modules + metadata.json + LICENSE + stylesheet.css + `schemas/`
      + `schemas/org.gnome.shell.extensions.todo-md.gschema.xml`), md5
      `1a8da8a03f463fec59bc0fc33e6ae25c`
- [x] ego-lint on the extracted zip: **0 failed** — 214 passed, 56 warnings, 10
      skipped (280 checks); every warning is advisory (see the notes above)
- [x] Shexli on the zip: **1 finding — `EGO-M-004` only, 0 warnings** (`shexli
      0.2.1`, `tree-sitter==0.25.0` — 0.26 segfaults; verify with a broken fixture
      first, the tool is version-gated and fails silently — see docs/verified-apis.md).
      `EGO-M-004` is the analyzer's own version table (stops at GNOME 50), not the
      package, and is the documented allowlist entry
- [x] `metadata.json` version-name matches the CHANGELOG release (0.23.0)
- [x] Reviewer notes above rewritten for 0.23.0 (the body had described 0.22.2)
- [x] Screenshot: `docs/screenshots/todo-md-0.23.0.png` present (renamed from the
      0.20.3 capture on 2026-11-15) and referenced by the README
      (`![…](docs/screenshots/todo-md-0.23.0.png)`) — 0.23.0 has no UI change
- [ ] Zip verified byte-identical to the published release asset
      (`releases/download/v0.23.0/…-0.23.0.zip`) — still open: no `v0.23.0` tag /
      GitHub release exists yet (the release is produced by CI on tag push)
- [ ] Uploaded to extensions.gnome.org (0.23.0, user) → new review page
- [ ] **EXIT CRITERION (added 2026-11-08, after the rejection): the review page's
      Shexli panel must show ZERO findings before an upload is considered done.**
      "warnings, no error" is not a pass — the reviewer reads the panel, not the
      notes, and rejected the 0.22.2 upload on exactly those three warnings. The
      local tool's `EGO-M-004` is not the criterion (EGO's build knows GNOME 51 and
      does not show it); the panel is. Check the panel on the new review page after
      the upload.
- Form fields: Name `Todo MD` · URL `https://github.com/ErtugrulSefaL/gnome-todo-md`
  · version auto-detected from the zip
