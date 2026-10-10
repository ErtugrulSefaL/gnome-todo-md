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
