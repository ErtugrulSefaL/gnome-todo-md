# Changelog

All notable changes to the Todo extension are documented in this file.
The project uses Semantic Versioning (0.y.z until 1.0.0); a version is
assigned only when a phase is completed and approved (see `.goosehints`).

## 0.22.2 - 2026-10-23

### Added
- **`compat.js`: a version shim for the Shell APIs that changed shape.** `PopupMenu`
  and `PopupSubMenu` `open()`/`close()` take an `animate` boolean up to GNOME 50 and
  a params object (`open(params = {})`) from GNOME 51. `compat.popupArgs()` detects
  the shape at runtime from the method's arity and returns the argument the running
  Shell expects, so one code base keeps working across 46-51 without a per-version
  branch.
- **The category action panel fades in over 400 ms.** The Shell reveals a submenu
  with a fixed 250 ms height ease, which reads as instant at the panel's size; an
  opacity ease on the panel's own actor makes the reveal visible. The Shell's
  `open()`/`close()` bookkeeping is untouched — no height animation is reimplemented
  and `_needsScrollbar` stays the Shell's business. Under reduced motion the fade is
  skipped, as GNOME's own animations are.

### Fixed
- **GNOME 46-50: the reduce-motion read would have aborted the whole menu build.**
  `St.ReducedMotion` exists only from GNOME 51 on (verified: `undefined` on 46-50,
  absent from the 46-49 API docs); on 46-50 the fade's
  `St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE` comparison threw a
  `TypeError` in the middle of the rebuild — the same failure shape as 0.22.1's
  removed `St.BoxLayout` property. The read is now guarded by an existence check and
  the static guard checks for that guard, not just for the expression.

### Notes
- Animation is not verifiable in a VM: GNOME 51 calls
  `St.Settings.inhibit_animations()` whenever the compositor is not hardware
  accelerated (`js/ui/main.js` `_shouldEnableAnimations()`), which disables every
  animation including the Shell's own. The fade was verified on the host (GNOME 50);
  VM runs cover behaviour, not motion.
- `compat.js` ships in the package: `tools/make-package.sh`, the CI syntax check and
  the unit tests all know it.

## 0.22.1 - 2026-10-23

### Fixed
- **GNOME 51: the empty-state row aborted the whole menu build.** With a todo file
  that names no category, the guidance row's box was built with
  `new St.BoxLayout({vertical: true})`. GNOME 51 removed that property from
  `St.BoxLayout`, so the constructor threw `No property vertical on StBoxLayout`;
  because the row is built in the middle of the menu rebuild, the rest of the
  menu never appeared — nothing opened, the strip's `+` did nothing, and the
  extension ended up in ERROR. It now uses `orientation:
  Clutter.Orientation.VERTICAL`, which exists on 46 through 51. The 0.22.0
  verification round missed it because its todo fixture has categories, so the
  empty-state branch never ran.

### Notes
- A static guard now forbids `vertical:` in the shell-side JS, and the API probe
  checks `St.BoxLayout.orientation`. The probe is a fixed list: a green run does
  not mean every API the code uses still exists — that is what the static guards
  and the manual pass are for.
- 0.22.0's notes said the APIs this extension uses are identical on 51. That was
  wrong for this one call; corrected above.
- The manual regression checklist gained a 19th item: an empty todo file, which is
  what this defect needed to show. Earlier runs are recorded as 18/18.

## 0.22.0 - 2026-10-23

### Added
- **Support for GNOME Shell 51.** `shell-version` now reads
  `["46", "47", "48", "49", "50", "51"]`, so the same zip still serves every
  supported release. GNOME 51 was validated on CachyOS (Arch, Wayland) with the
  API probe (58 checks, all present) plus the same 18-check manual regression run
  the other versions went through. As for 46–50, the extension needed no source
  change to run on 51 — see 0.22.1 for the one API that regression run did not
  reach.
- The static guard now pins the declared list to exactly those six versions, and
  the metadata description names every one of them.

### Notes
- GNOME 51 realigned mutter's introspection version with the GNOME major:
  Clutter, Cogl, Meta, St and Shell go from 18 straight to 51 (19–50 never
  exist). The probe therefore needs the distro-specific typelib directory for
  51 — `/usr/lib/mutter-51` on Arch/CachyOS, not Debian's
  `/usr/lib/<arch>/mutter-<N>`. Measured, see `docs/verified-apis.md`.

## 0.21.0 - 2026-10-22

### Added
- **Category tabs can be reordered by dragging them.** The whole tab is the
  handle — no grip — and the strip shows an upright insertion line in the gap the
  tab would land in. The file's `##` heading order is rewritten to match, so the
  new order is what any editor sees too. A tab that cannot move refuses the drop
  and says why in a hint under the strip: the implicit `General` has no heading of
  its own to move, and a section holding content above its heading can only keep
  that boundary while it stays first (so position 0 is a fixed anchor for those).
  The strip scrolls itself while the pointer rests near an edge, and a plain click
  on a tab still switches tabs.

### Notes
- The move is a pure `storage.js` function (`moveCategoryTo`), and the reasons it
  refuses are exported next to it, so the menu's feedback and the write cannot
  disagree. 14 unit tests, including a 16-combination loss-less fuzz.
- Verified on GNOME Shell 50.1 (host) and on the 46 (Wayland **and** X11), 47, 48
  and 49 test VMs.
- The no-drop cursor during a refused drag is only drawn on GNOME 48+: 46 and 47
  ask the cursor theme for `dnd-unsupported-target`, which neither Adwaita nor
  Yaru ships, so the cursor there does not change. The refusal itself — nothing
  written, tab back in place — works on every version, and the hint label carries
  the reason. Measured per version; see `docs/verified-apis.md`.

## 0.20.3 - 2026-10-13

### Changed
- **Every icon-only button now shares one flat round style.** The category
  header's ⋮, the task rows' edit / delete / drag handle and the tab bar's `+`
  used to be small grey pills with a 3px radius; they are 28px circles now, with
  no chrome of their own and a translucent layer on hover and press, so the
  menu's icon buttons read as one family.
- The category ⋮ icon gets its own icon size. Yaru draws `view-more-symbolic`
  as hairlines — roughly a fifth of Adwaita's dot size — so at the icon buttons'
  shared 12px it was almost invisible.

### Fixed
- **Task texts and category headers are vertically centred again.** The taller
  buttons stretched every row, and an `St.Label` without its own vertical
  alignment draws its text at the top of the stretched box.

### Notes
- Verified on GNOME Shell 50.1 (host).

## 0.20.2 - 2026-10-13

### Changed
- **The category tab bar is a segmented control now.** The tabs used to be a
  tightly packed row of joined grey `.button` pills with a barely distinguishable
  active state (the theme's `.button:checked` only darkens by about 8 %). The
  strip now carries a full-width recessed track, the tabs are transparent with
  the category colour as their text, and the active tab is a raised pill. The
  `+` button became a flat round icon button so the row reads as one strip.
- The tabs are spaced apart — the old `spacing` was set on the outer box layout,
  so the tabs themselves had none — and backgrounds cross-fade over 120 ms.

### Fixed
- **The horizontal scrollbar was visible even when the tabs fit.** With
  `vscrollbar_policy: NEVER`, `StScrollView` compares the content *width*
  against the rail's *height* (`st-scroll-view.c`, `st_scroll_view_allocate`;
  present in 46.0, 48.0 and 50.1), which is true for any tab row, so the bar was
  always shown. The vertical policy is `AUTOMATIC` again, which uses the branch
  that compares width against width; the bar now appears only while the tabs
  actually overflow. The tabs are vertically centred so the rail's reserved
  scrollbar space cannot stretch them.

### Notes
- Verified on GNOME Shell 50.1 (host). Tab labels keep the category colour, so
  no contrast logic was needed; the light and dark variants use the existing
  `.todo-light` / `.todo-dark` scoping.

## 0.20.1 - 2026-10-12

### Fixed
- **The drag insertion line was invisible on GNOME 46, 47 and 48**, in both
  themes. `panelMenu.js` adds the menu actor to `Main.uiGroup`, and
  `PopupMenu.open()` raises it above every sibling in that group
  (`set_child_above_sibling(actor, null)` — `popupMenu.js:982` on 46.0 and
  `:1069` on 50.1), so the line, a later sibling, ended up behind the menu's
  background. It is now raised once per drag. This was version-independent: on
  GNOME 50 the menu background is semi-transparent, which is why the line only
  looked faint there instead of vanishing.
- The line also reads softer now: alpha 0.85 / 0.95 → **0.65 / 0.75**.

### Notes
- Verified on GNOME 46 (X11), 47 and 48 (Wayland), each in its own VM: drag,
  drop, the no-drop refusal, the insertion line and the Alt+Up/Alt+Down keyboard
  path all behave, and the rest of the extension is unaffected.
- Tooling: `tools/vm-setup.sh` now takes the project path as an argument, so an
  SSH-reachable VM can copy the project instead of mounting it over virtiofs and
  still use the same script (schema compile, fixture, probe, report).

## 0.20.0 - 2026-10-12

### Added
- **Drag-and-drop reordering.** Every task row now ends in a grip handle
  (`list-drag-handle-symbolic`). Dragging it lifts a clone of the row, shows an
  insertion line where the task will land, and reorders the task inside its
  category on drop. The drop stays inside the category: on the "All" tab a drop
  on another category's row is refused — the cursor becomes a no-drop cursor,
  the line disappears and the row snaps back. The menu stays open and usable for
  the whole drag.
- **Keyboard reordering on a focused row: Alt+Up / Alt+Down.** It replaces the
  per-row up/down buttons, which were removed: they were the ugliest part of a
  row, and at the top and bottom of a category they were dead, insensitive
  buttons. The moved row keeps the key focus, so pressing the combination again
  walks the task further.

### Changed
- `Storage.moveTask` (adjacent swap) was replaced by `Storage.moveTaskTo`, a
  "move this task into that task's slot" operation. It keeps interleaved
  note/blank lines in their slots, keeps the `## General` heading boundary
  honest, and returns the content unchanged for every rejected move
  (cross-category, unknown index, no-op).
- The file monitor no longer rebuilds the menu for the extension's OWN writes —
  it compares the file against the content the menu just rendered. One action is
  now one rebuild instead of two or three.

### Notes
- Verified on GNOME Shell 50.1 (Wayland). Before a line of UI code was written,
  the Shell's own drag-and-drop framework
  (`resource:///org/gnome/shell/ui/dnd.js`) was proven to work inside a panel
  popup menu with an isolated headless shell driven by a virtual pointer; the
  findings and the exact integration rules are recorded in
  `docs/verified-apis.md`.
- GNOME 46/47/48 take the older internal path of that same module
  (`button-press-event` plus a stage grab, instead of `St.DndStartGesture`).
  The public API is identical, but drag-and-drop has NOT been regression-tested
  on those shells yet; nothing else about the extension changes there.

## 0.19.0 - 2026-10-12

### Added
- **Support for GNOME Shell 46, 47, 48 and 49.** `shell-version` now reads
  `["46", "47", "48", "49", "50"]`, so a single zip serves every supported
  release. Each one was validated the same way — the API probe (58 checks) plus
  a manual regression run (18 checks) in its own VM: Ubuntu 24.04 (GNOME 46),
  24.10 (47), 25.04 (48), 25.10 (49) and 26.04 (50).
- No source change was needed for any of those shells: a source comparison had
  already shown the APIs this extension uses are identical across 46–50, and the
  regression runs confirmed it in practice.

### Fixed
- Two defects the runs turned up, both independent of the shell version, are
  included here: a blank line after the title no longer invents a "General"
  category (0.18.1), and the checkbox/swatch rings and the extension's own
  scrollbars now follow the shell's colour scheme, so they are visible on the
  light theme too (0.18.2).

### Notes
- The release policy is now exercised end to end: `shell-version` may only name
  versions that passed a manual regression run, and a static guard pins the
  exact list — widening it is always a deliberate act that follows a test.

## 0.18.2 - 2026-10-12

### Fixed
- **Both shell themes are supported now.** On the light theme the unchecked
  checkbox ring and the colour-picker rings were hard-coded white and vanished
  against a light menu, and neither scrollbar was visible at all — the theme
  draws the handles at an effective ~2px in a pale grey. The extension now reads
  the shell colour scheme, tags the menu box `.todo-dark` / `.todo-light`, and
  every theme-dependent colour — the checkbox ring, both swatch rings and the
  handles of its own two scroll views — is scoped under that tag. The scrollbar
  rules are scoped to the extension's scroll views, so the shell's own
  scrollbars keep the theme's look. CSS alone cannot do this: St's stylesheet
  grammar has no `currentColor`.

### Tests
- 250 unit tests (5 new static guards for the theme rules); 6/6 injected
  mutations caught — including a file-wide regex that had to be tightened to
  window the unscoped base rule. `tools/shell-api.sh probe` now also checks
  `St.Settings.color_scheme` and `St.SystemColorScheme` (58 checks).

## 0.18.1 - 2026-10-12

### Fixed
- **A blank line after the title no longer invents a "General" category.** In a
  file like

  ```
  # Todo

  ## Work
  ```

  the blank line between the title and the first heading was parsed as
  heading-less content, so the menu showed a General section that held nothing
  and — because the parser marks such fallback categories as implicit — could
  not be renamed or deleted. A fallback category containing only blank lines is
  now kept as `preamble` and emitted right after the title, so the written file
  is byte-for-byte what it was. Real heading-less content (an orphan task, a
  note) still forms the implicit General, and a blank line after a heading still
  belongs to that category.

### Tests
- 245 unit tests (10 new for the preamble rule). A 12-case old-vs-new
  comparison confirms the serialized bytes are unchanged in every case — only
  the phantom category disappears.

## 0.18.0 - 2026-10-12

### Changed
- **GNOME 50 support.** `shell-version` is now `["50"]`. The extension had been
  `OUT_OF_DATE` on GNOME Shell 50.1 — the Shell refuses to load an extension
  whose `shell-version` does not include the running major, so it was not
  running at all. No code change was needed: a source comparison of every API
  this extension touches (gnome-shell 46.0 vs the 50.1 modules extracted from
  `libshell-18.so`) found them identical, and a full manual regression on 50.1
  confirmed it.
- The description no longer advertises the per-header `+` button removed in
  0.16.0, and its compatibility line now reads GNOME 50 / Ubuntu 26.04 /
  Wayland instead of GNOME 46 / Ubuntu 24.04 / X11.

### Added
- `tools/shell-api.sh` — the Shell's own JS (read straight out of the GResource
  embedded in `libshell-<N>.so`) plus a probe of all 56 APIs this extension
  uses, checked against the installed typelibs. Version-agnostic; exits
  non-zero if an API has disappeared. Run it after every GNOME upgrade.
- `tools/gjs-docs-mirror.sh` — refreshes the offline gjs-docs mirror. It
  currently fails for every slug: gjs-docs.gnome.org stopped serving the
  docset JSON and answers with its SPA HTML shell instead.

### Notes
- The multi-version release policy is now explicit: one code base, one zip, and
  `shell-version` lists only versions verified by a manual regression run.
  Older branches (46-49) are added one at a time, after their own test runs.
- Known issue, not yet fixed: the EGO screenshot procedure is broken on GNOME 50
  — the Shell narrowed the D-Bus allow-list of `org.gnome.Shell.Screenshot` and
  dropped `org.gnome.Screenshot`, so `gnome-screenshot` no longer writes a file.

### Tests
- 235 unit tests green. Manual regression on GNOME Shell 50.1 / Wayland: 18/18
  checks (menu, tabs, action panel, colour picker, task rows, scrolling, prefs,
  Orca, theme). `tools/shell-api.sh probe` reports 56/56 present.

## 0.17.0 - 2026-10-11

### Added
- **Faz 8 — the in-menu colour picker.** 'Change color' in the category action
  panel now opens a row of eight palette swatches plus a "remove colour" button,
  inside the same panel. The swatch matching the category's current colour is
  ringed (and the ring is also the screen-reader state), so the picker shows the
  truth instead of only offering choices.

### Changed
- The palette's two HIG neutrals are replaced: brown `#986a44` → **teal
  `#2190a4`**, gray `#9a9996` → **pink `#d56199`** (user decision: both read
  poorly as category-header TEXT on the dark menu). The replacements come from
  the modern Adwaita accent palette (libadwaita 1.7). The prefs quick palette
  shares the same source, so it follows automatically.
- `storage.js` gains `CATEGORY_PALETTE_NAMES` (spoken names, index-aligned with
  the palette) and the pure `setCategoryColor` (hex validation, `__proto__`
  refusal) — the colour decision stays testable outside the UI.

### Notes
- Applying a colour writes the settings map and nothing else: a colour lives in
  GSettings only, so the "file first" rule (L-018) does not apply on this path.
  A guard pins that, so a later reviewer cannot mistake it for a missing write.
- The picker is a panel sub-state, not a sixth interaction field: the
  five-field single-interaction invariant is unchanged.

### Tests
- 235 unit tests (6 new), 6 new static guards, all mutation-tested (8/8).

## 0.16.0 - 2026-10-10

### Added
- **Faz 7 — category delete / rename + a per-category action menu.** The `+`
  button in every category header became a `...` action button; it expands the
  shell's own inline submenu (`PopupSubMenu`) directly below that header:
  - **Add task** — the inline add entry (the old `+` behaviour)
  - **Change color** — visible but inactive (Faz 8 turns it on)
  - **Rename** — a prefilled entry; the stored colour follows the new name
  - **Delete** — red, two-step: the first click asks "Confirm delete?" and the
    second removes the category with its tasks and drops its colour
- Three triggers for the same panel: the `...` button, right-click on the
  category tab, right-click on the category name row.

### Changed
- `storage.js` gains the pure `deleteCategory`, `renameCategory`,
  `moveCategoryColor` and `removeCategoryColor` — every rejection path returns
  the content byte-identically.
- The single-interaction invariant grew from three fields to five (task edit,
  category add, new-category entry, category rename, action panel) and is reset
  in ONE helper, so two inline interactions can never be open together.

### Fixed
- Renaming from a category tab no longer falls back to `All`: `set_value` fires
  `changed::` synchronously and that refresh dropped a category the file no
  longer had (L-040).
- Renaming the explicit `## General` that carries the pre-heading preamble no
  longer produces an unstable round-trip (L-038).
- A deliberate delete now drops the colour even when the deleted category was
  the file's last heading (the accidental-heading-loss rule used to keep it).

### Tests
- 221 unit tests (15 new), 12 new static guards, all mutation-tested (12/12),
  plus a 147-assert contract probe against `parseDocument`/`serializeDocument`.

## 0.15.0 - 2026-10-03

### Changed
- **A1 complete: the entry point is now lifecycle + state + assembly.**
  `extension.js` 998 → **668** lines across three steps:
  - `tabBar.js` (0.13.0) — the persistent category strip
  - `rowFactory.js` (0.14.0, extended here) — task rows, the inline add/edit
    entries and the menu-width cap

  `_makeNewCategoryRow` deliberately stayed put: it is a workflow (validate the
  name, write the file, assign the auto-colour, switch tab), not a row builder,
  and it carries the audit D5 (rejected names) and N4 (failed write) logic —
  moving it would have scattered the most heavily guarded code in the project.

  EGO's best practices ask for small entry points but do not require them; the
  remaining 668 lines are the enable/disable lifecycle, the edit-state fields and
  `_refreshTodoMenu`, which owns the persistent-actor ordering (that ordering is
  what stops `menu.removeAll()` from destroying the tab bar — shell SEGV,
  2026-09-26).

### Tests
- Two new static guards, both aimed at failure modes the A1 split kept producing:
  - **every named import resolves to a real export** — a dropped `export` or a
    typo'd imported name is an import *runtime* error that nothing else caught.
  - **no module uses a binding it did not import** — the `Storage is not defined`
    class, which emptied the entire menu and was visible only after
    `Alt+F2 → r`.
- 179 → 180 tests; three new mutants killed (dropped `export` on `capWidth`,
  dropped `export` on `TabBar`, typo'd import name).

## 0.14.0 - 2026-10-03

### Added
- **`rowFactory.js`**: task rows moved out of `extension.js` into a `RowFactory`
  class. The menu width and the five row actions are injected, so the module
  holds no state of its own. This is where roadmap features #1 (a colour control
  on the category header) and #2 (drag-and-drop reordering) land.

  `extension.js`: 890 → 738 lines. The row body was moved verbatim; only the six
  `this.<action>(…)` calls were repointed at injected callbacks.

### Fixed
- `rowFactory.js` shipped for one test cycle without `import * as Storage` —
  `ReferenceError: Storage is not defined` at the first row, which emptied the
  menu (no tasks, no category headers, unstyled leftover actors). Caught by
  `Alt+F2 → r`, not by the suite.

### Tests
- New static guard: **no module may use a binding it did not import**. The
  suite had the inverse (unused imports) and nothing for the failure that
  actually happened.
- Mutation-tested: the missing-import case and the missing-`Atk` case both fail
  now, which they did not before.
- 177 → 179 tests.

## 0.13.0 - 2026-10-03

### Added
- **`tabBar.js`**: the category tab strip moved out of `extension.js` into a
  `TabBar` class (`attach` / `detach` / `clearTabs` / `refill`). The strip is
  still a persistent plain actor on `menu.box` — that invariant is unchanged and
  now guarded in the module it lives in. This is the first step of splitting the
  entry point, which the EGO best practices ask for ("Modules are Better Than a
  Single File", "Keep the Default Entry Point as Small as Possible" — very large
  files can make the review page lag on diffs).

  `extension.js`: 998 → 890 lines. Nothing was rewritten in the move: 129 lines
  out, 21 in.

### Tests
- The static guards now read the **whole shell-side surface, derived from the
  directory**, instead of one hardcoded file. Before this, moving code into a
  module would have left every "must not appear in the UI layer" guard passing
  over a file it no longer read — green and measuring nothing, the inverse of the
  tautological test audit N1 found.
- Three guards rewritten without magic numbers: the tab-bar invariant, the
  per-button `accessible_name` check (was "6 named / 8 buttons"), and the
  docstring scanner's file list.
- Mutation-tested, and the mutations found three defects in the tests themselves:
  a forbidden-call regex that missed the real syntax (`PopupMenu.PopupBaseMenuItem`
  has a dot), a guard matching its own explanatory comment, and a block scanner
  mixing coordinates between commented and raw source.
- 177 → 177 tests, 4 new mutants killed.

## 0.12.0 - 2026-10-03

### Changed
- **The UUID no longer contains the GNOME trademark.** `gnome-todo-md@ertugrulsefal.github.com`
  → **`todo-md@ertugrulsefal.github.com`**, and the settings schema is now
  `org.gnome.shell.extensions.todo-md` (the mandatory `org.gnome.shell.extensions.`
  base is unchanged — only the extension's own part lost the brand name).

  The review guidelines say extensions must not include copyrighted or
  trademarked content, and list "brand names and phrases" as the first example;
  `ego-lint` fails both the UUID and the schema id on this. Doing it now rather
  than later: **a UUID cannot be changed after upload** — a rename afterwards means
  unpublishing and re-uploading as a different extension.

  The extension directory, the schema file, the tests, the CI workflow and the
  README were renamed with it. The GitHub repository name is unchanged.

### Migration (for anyone installing the development version)
Two things move with the UUID and neither follows a rename automatically:

1. **Settings** live under `/org/gnome/shell/extensions/<uuid>/` in dconf. Copy
   the old keys to the new path: `todo-file-path`, `category-colors`,
   `menu-width`, `max-menu-height`.
2. **The enabled-extensions list** (`org.gnome.shell`) still names the old UUID.
   With the directory gone, the new one starts in state `INITIALIZED` — loaded
   but not active, so the panel icon simply does not appear. Fix:

   ```bash
   gnome-extensions enable todo-md@ertugrulsefal.github.com
   gsettings set org.gnome.shell enabled-extensions "[…]"   # drop the old uuid
   ```

## 0.11.14 - 2026-10-03

### Fixed
- **A failed write no longer swallows what you just typed.** When the todo
  file could not be written — disk full, read-only file, a `todo-file-path`
  pointing somewhere unwritable — the extension closed the inline entry and
  refreshed the menu from the unchanged file. The task you had just typed was
  gone, and nothing on screen said so; the only trace was a line in the
  journal. `writeTodo` now reports success or failure, and the add / edit /
  new-category paths keep the entry open with your text when it fails, exactly
  as a rejected category name already did.

  Toggle, delete and move still refresh after a failed write: a click has no
  text to lose, and re-reading the file is what keeps the menu truthful.

### Changed
- `Storage.writeTodo` returns `boolean` instead of `undefined`. Callers that
  ignore it keep their old behaviour; the three that can lose typed input now
  check it.
- The static guard for the new-category entry no longer counts lines: it
  asserts the *order* (rejection check → write check → close), because a
  comment block alone was enough to break the old 12-line window.
- New guards for the add and edit paths, added because mutation testing showed
  reverting either one kept the suite green.

### Tests
- 172 → 176, plus 5 new mutants all killed (N4-M1…M5): the return value, the
  add check, the edit check, the new-category check, and the guard's ordering.

## 0.11.13 - 2026-10-02

### Fixed
- **Emptying the todo file no longer deletes your category colours.** The
  0.11.2 fix pruned dead colour keys against the list of categories the menu
  renders — but a file that has lost every `##` heading renders exactly one
  entry (the implicit `General`), so all six real colours looked dead and the
  whole map was written away through `set_value`. Reproduced with the actual
  six-category file: 6 colours → 0. Triggered by truncating the file, by a
  stray `:dgg` / `> todo.md`, or by a script that rewrites it.

  A document with **no `##` heading at all** has not changed its categories,
  it has lost them, so nothing is pruned now: the colours come back with the
  headings. Genuinely deleted categories are still pruned as soon as one
  heading remains, so a stale colour cannot follow a reused name.

### Changed
- **The pruning decision moved from `extension.js` into `storage.js`**
  (`prunedColorsForDocument`), where it can be unit-tested. Both halves of
  the decision — which category list is authoritative, and when not to prune
  at all — were previously untested code in the UI layer, and that is where
  this bug lived.

### Tests
- New cases use a populated colour map with **no key named `General`**,
  which is the state the bug actually occurred in; the old "D1 regression"
  case was tautological (it keyed the colour under `General`, the one key the
  sentinel protected) and was replaced. Both new cases fail against the
  pre-fix code and pass after it. 169 → 172.

## 0.11.12 - 2026-10-02

### Fixed
- **The test suite was silently deleting your category colours.** The
  file-level tests wrote fixtures to `~/todo.md` and restored the file
  afterwards — but a running extension watches that file, so the fixture
  write fired its monitor, the refresh saw a document with no categories,
  and it pruned the entire `category-colors` map through `set_value`.
  Permanent, invisible, on every single test run. The tests now write to a
  temporary file, and a teardown check proves the real file is left alone.

### Fixed
- **A failed read no longer erases the colour map.** `readTodo` swallowed
  read errors and returned an empty document, which looked exactly like "the
  user deleted every category". A transient failure — an editor's atomic
  save, a rename window, a permission blip — was enough to lose every colour.
  `readTodo` now reports `ok`, and pruning is skipped when the read failed.

  A genuinely empty file is still treated as empty (the automatic dead-key
  pruning from the colours feature is unchanged).

### Added
- Guards for both, each verified by re-introducing the defect. Also fixed a
  duplicated test registration that counted 13 tests twice.

  Tests: 180 → 169 (the difference is the duplicate registration).

## 0.11.11 - 2026-10-02

### Fixed
- The menu's deferred refresh is now cancellable. Opening the menu schedules
  the rebuild with `GLib.idle_add` and the source id was thrown away, so
  turning the extension off while that callback was pending left it to run
  against an already-destroyed menu. The id is stored and removed in
  `disable()`, as the review guidelines require for every main loop source —
  including ones that already returned `SOURCE_REMOVE`.

### Added
- A static guard for it. Tests: 177 → 178.

## 0.11.10 - 2026-10-02

### Added
- Accessibility (audit D8). Screen readers can now use the menu:
  - the six icon-only buttons (new category, add task, move up, move down,
    delete, edit) announce what they do instead of just "button";
  - task rows carry `Atk.Role.CHECK_MENU_ITEM` with the `CHECKED` state and
    their text label attached, so a screen reader can tell a finished task
    from a pending one.

  `PopupBaseMenuItem` has no `checkAccessibleState()` — that method lives on
  `PopupSwitchMenuItem` — so the state is maintained where the row is built,
  which keeps it in sync because rows are rebuilt on every refresh.

  The audit also listed "the tab bar is not keyboard reachable" as a
  regression from the SEGV fix. That is not the case: `PopupMenuSection` does
  not override `get_focus_chain`, and St's default returns every visible
  child, so the plain `St.Button` tabs are in the menu's focus chain —
  confirmed by keypress test (↓ reaches the tabs, Enter activates one). No
  code change was needed.

## 0.11.9 - 2026-10-02

### Fixed
- **Checking a task did nothing on a file with Windows line endings.** A CR at
  the end of each line is a line terminator as far as a JavaScript regex is
  concerned, so the checkbox pattern never matched and the toggle was a silent
  no-op.
- **Editing a task destroyed its checkbox on such a file.** The same mismatch
  sent the edit down the "not a checkbox line" path, which replaces the line
  with plain text — `- [ ] a` became `b`. The task survived as text but lost
  its checkbox and vanished from the task list.

  `parseDocument` stripped the CR all along; the line-level helpers did not.
  Both now match without the CR and put it back.

### Changed
- Line endings are preserved: a file with Windows line endings is written back
  with Windows line endings. Previously the first document-level write
  (adding a task or a category) silently rewrote the whole file with LF.
  Line-level edits already kept them. A file with mixed endings is written
  with CRLF throughout.

  This makes a CRLF file round-trip byte-identically, like an LF one does.

### Added
- Eight tests covering the CRLF paths: toggle, edit, delete, the non-checkbox
  fallback, document-level writes, and round-trip in both directions.
  Tests: 167 → 175.

## 0.11.8 - 2026-10-02

### Fixed
- A category name containing a line break no longer corrupts the file. Typing
  `a` + Enter + `b` wrote `## a` followed by a stray `b` text line, and `a`
  was left as an orphan section.
- A name starting with `#` (`## Injected`, `# TODO`) is no longer written as a
  nested-looking heading.
- Pressing Enter on a name `addCategory` refuses no longer closes the entry
  silently. Empty, duplicate and unusable names leave the text on screen so it
  can be corrected, instead of looking like a dead button.

  Rejected names are refused outright rather than rewritten, so what gets
  stored is always exactly what was typed.

### Added
- `Storage.isUsableCategoryName()` plus tests for the rejection rules, and a
  static guard that the UI only closes the entry *after* the rejection check.
  Tests: 144 → 167.

  The first version of that guard was wrong: it searched the whole file for
  the closing assignment and matched an unrelated one in `_cancelEditing()`, so
  it passed against the exact bug it was written for. It now uses line windows.

  Note: two categories differing only in case (`work` / `Work`) are *not*
  treated as a conflict — the `category-colors` map is keyed by exact name, so
  they already have separate entries and each resolves correctly.

## 0.11.7 - 2026-10-02

### Fixed
- **Tasks written above an explicit `## General` heading were invisible**
  (audit D4). The lines before a file's first category heading were parked in a
  second item list that only the serializer read, so such tasks never appeared
  in the menu, and adding an inline tag or pressing ↑/↓ on them silently did
  nothing. The category now keeps one item list with a `preCount` marking where
  the heading belongs — the second list could not go stale.
- **A `# ` heading that is not the first line no longer jumps to the top of the
  file** (audit D2). Only a heading that opens the file is the document title;
  one further down stays inside the section it sits in. Previously adding a
  task or a category rewrote the whole document and hoisted that line to the
  top, shifting the user's blank lines with it.

  A file with no opening heading still gains the leading `# TODO` line — that
  is a locked rule, deliberately unchanged.

### Added
- Thirteen tests covering the preamble: round-trip fidelity, menu visibility,
  inline tags, reordering, moving across the heading boundary (allowed, the
  boundary follows, and the result is stable), and title position. Tests:
  131 → 144.

## 0.11.6 - 2026-10-02

### Fixed
- Starting a task edit or a per-category add entry while the "new category"
  entry was open left both on screen at once — two focusable text entries in the
  same menu, from a single interaction. `_startEditing()` and `_toggleAdd()`
  now close the new-category entry too, so the single-interaction rule holds
  across all three states.

### Added
- A static guard that actually enforces that rule. The two existing guards
  only ever compared two of the three edit-state fields, so the suite reported
  green on exactly this bug; the new one checks that opening any of the three
  states closes the other two (directly or through `_cancelEditing()`), and
  names the offending line and the missing fields. Tests: 130 → 131.

## 0.11.5 - 2026-10-02

### Fixed
- **Data loss (audit D1): an emptied todo file no longer wipes every category
  color, permanently.** The menu pruned dead color keys against the raw
  document, whose category list is empty when the file is empty — while the
  menu itself was rendering the implicit `General` header. So emptying
  `~/todo.md` (a stray `:dgg`, a `> todo.md` redirect, any script) and letting
  the file monitor fire deleted the whole color map through `set_value`, with
  no way to get it back. The header also rendered uncolored until the next
  refresh.

  The category list is now derived once, by `Storage.renderSections()`, and the
  prune goes through it — the menu rows and the prune can no longer disagree
  about which categories exist. Genuinely dead keys are still pruned.

### Added
- `Storage.renderSections()` — the single source of truth for "which
  categories exist right now" (pure, unit-tested).
- Regression coverage for the data-loss path, plus a static guard that pins the
  prune to `sections` so the UI half cannot drift back. Tests: 125 → 130.

## 0.11.4 - 2026-10-02

### Changed
- `metadata.json` `description` rewritten for extensions.gnome.org. It was
  a single 41-character sentence; it now states what the extension does, lists
  the shipped features as bullets, names the tested configuration, and
  **declares its file access** — the extension reads and writes one user file,
  so reviewers expect that spelled out. Format follows the review guidelines
  (`\n` paragraphs, `*` bullets). No behaviour change.

### Added
- A static guard keeps the description honest: it must declare file access,
  name the supported shell version, and use a bullet list. Tests: 124 → 125.

## 0.11.3 - 2026-10-02

### Fixed
- Comment integrity in `extension.js` (audit D7). Four defective JSDoc blocks
  are gone:
  - `_makeNewCategoryRow`: the docstring had been duplicated verbatim.
  - `_switchTo`: a truncated, **never-closed** docstring had swallowed four
    lines of dead code *and* `_todoPath()`'s own docstring; both are separated
    again.
  - `_makeTaskRow`: its docstring was stranded above `_capWidth`, leaving the
    method undocumented — moved back onto the method it describes.
  - `_addTask`: a pre-Phase-4 docstring with the wrong signature (`text` only,
    no `category`) sat above the current one.

  None of these were reachable by `node --check`: a duplicated, unclosed or
  misattached docstring is still valid JavaScript. Comment stripping confirms
  the change is comment-only — 584 code lines, token-for-token identical.

### Added
- Three static guards close that blind spot for good (`tests/run_tests.mjs`,
  over `extension.js`, `storage.js` and `prefs.js`): no duplicated JSDoc
  blocks, no live code swallowed by an unclosed one, and every doc block
  attached to a declaration. Each was verified by re-injecting the defect it
  guards against. Test count: 121 → 124.

## 0.11.2 - 2026-10-02

### Fixed
- `schemas/gschemas.compiled` is no longer committed. GNOME 45+ compiles the
  schema at install time, so the binary was dead weight in the package — and
  the single most frequent extensions.gnome.org rejection reason ("Please
  remove `schemas/gschemas.compiled`. Not needed for 45+ packages."). The XML
  stays; the compiled binary is now a gitignored build artifact (it is still
  produced locally, because the extension is installed through a symlink and
  `getSettings()` reads it at runtime).
- The static test that *required* the committed binary — which kept CI green by
  enforcing the rejection reason — is inverted: it now fails if the artifact
  can be tracked by git again.

## 0.11.1 - 2026-09-26

### Fixed
- The far-right `+` (new-category) button of the tab bar was pushed out of
  view: the tab scroller's `min-width` ate the full fixed menu width. The
  scroller now just expands into the remaining space (the menu box itself
  is force-sized), and the horizontal scrollbar still engages when the
  tabs overflow.

## 0.11.0 - 2026-09-26

### Added
- Fixed menu width: the menu frame never widens or shrinks with content
  (new `menu-width` setting, 300–2000 px, default 500 — the single width
  value replaces any min/max split).
- Fixed-width checkbox column at the start of every task row: an empty
  circle when pending, filled with the category color + a white check when
  done — checking a task can never widen the menu.
- Mouse wheel scrolls the category tab bar horizontally anywhere on the
  bar (St's own wheel handler routes the wheel to the vertical adjustment
  only, so `enable-mouse-scrolling` is disabled on the tab scroller).

### Changed
- The category tab bar is always horizontally scrollable: the `shrink`
  mode and the `tab-bar-mode` setting were removed entirely (scroll was
  made the permanent behavior; shrink can return later if needed).
- The tab bar is now a persistent actor: only the tab buttons are
  refilled on refresh, so the horizontal scroll position (and the content
  scroll position) survive every rebuild, including category switches —
  selecting a category no longer jumps to the top.
- More comfortable tab bar spacing/padding.

### Fixed
- The menu width no longer propagates the tabs' large minimum width: the
  menu box is force-sized via CSS `width` + `max-width` (CSS `min-width`
  alone never widens the natural width).
- A shell crash (SEGV): persistent rows attached to `menu.box` must be
  plain actors — `menu.removeAll()` destroys every `menu.box` child whose
  `_delegate` is a `PopupBaseMenuItem` (`popupMenu.js` :827-850).

## 0.10.0 - 2026-09-23

### Changed
- UI labels and the fallback category name are English: the default tab is
  `All` and tasks added without a category UI land under `## General`
  (existing files keep their own category names).

## 0.9.0 - 2026-09-23

### Added
- Scrollable menu content: the menu content area (headers + tasks) scrolls
  once it exceeds the height limit; the tab bar stays fixed above it
  (the shell's own `PopupSubMenu` scroll pattern, `popupMenu.js` 46.0).
- `max-menu-height` setting (200–2000 px, default 400) in the preferences —
  applied live, without a Shell reload.

### Changed
- The scroll area is a persistent part of the menu: content is refilled in
  place, so the scroll position survives every action (edit, move, add,
  delete). A tab switch intentionally starts at the top.

### Fixed
- The tab bar stays the first row above the scroll area.

## 0.8.0 - 2026-09-23

### Added
- Category tabs: a permanent tab bar above the content — `Tümü` (default)
  plus one tab per category. Tabs filter the menu to a single category; the
  active tab is remembered for the session and falls back to `Tümü` when its
  category disappears.
- New-category creation from the menu: a `+` button at the far right of the
  tab bar opens an inline name entry; the new category becomes the active
  tab and is automatically assigned the next palette color (wrapping around
  after the last palette entry).
- Tabs and headers carry the category color.

### Fixed
- Writing the new category file before assigning its auto color — the
  settings-change signal previously triggered the dead-key pruning before
  the file contained the category, erasing the color.

## 0.7.0 - 2026-09-23

### Added
- Category colors: assign a color to any category header from the new
  "Colors" preferences page — a GNOME-palette quick picker plus a free
  color dialog (`Gtk.ColorDialogButton`). Changes reach the panel menu
  instantly through GSettings.
- Dead color entries (categories that no longer exist in the file) are
  pruned automatically, so a later category reusing the name does not
  silently inherit the old color.

### Changed
- GSettings schema gained a `category-colors` map (`a{ss}`: category name
  → CSS hex color); colors are validated against a strict hex pattern
  before being applied as inline styles.

### Fixed
- Palette selection now keeps the color dialog button in sync.
- Prefs process no longer crashes on a missing static GTK helper
  (`Gtk.StyleContext.add_provider_for_display` is the GJS-exposed form).

## 0.6.0 - 2026-09-23

### Added
- Add tasks to any category: every category header (including empty ones)
  has a '+' button that opens an inline add entry for that exact category.
- An empty file starts with an implicit `Genel` header, so the first task
  can be added without hand-editing.

### Changed
- The top "Add a task…" entry and the 'No tasks' placeholder row were
  removed — adding is now exclusively per-category.
- `addTask(content, text, categoryName)` targets a named category (default
  `Genel`); a missing category is created at the end of the document.

### Fixed
- Opening a task edit no longer leaves a category add entry open (missed
  single-interaction reset); the invariant is now pinned by static checks.

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
