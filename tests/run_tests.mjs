/*
 * Phase 1 unit + integration tests for the todo extension.
 * Runs against the real storage.js module.
 *
 * SAFETY: the file-level tests write to a TEMPORARY file, never to
 * ~/todo.md. They used to snapshot the user's file, write over it and
 * restore it afterwards — which was destructive in a way the restore could
 * not undo: a live extension is watching ~/todo.md, so a fixture write
 * fired its file monitor, the refresh saw a document with no categories,
 * and it pruned the entire category-colors map through set_value. Silently,
 * permanently, on every single test run. The teardown check below now
 * proves the suite leaves the real file untouched.
 *
 * Each function is exercised individually; results print as:
 *   [PASS] <name> — detail
 *   [FAIL] <name> — detail
 *
 * Usage:  gjs -m tests/run_tests.mjs
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Storage from '../todo-md@ertugrulsefal.github.com/storage.js';

// Where the file-level tests write.
const TODO = GLib.dir_make_tmp(null) + '/todo.md';
// The user's real file: read-only for this suite, verified at teardown.
const USER_TODO = GLib.get_home_dir() + '/todo.md';
const USER_RAW_AT_START = Storage.readTodo(USER_TODO).raw;

const results = []; // {name, ok, detail}
let ORIGINAL_RAW = '';

function record(name, ok, detail) {
    results.push({name, ok, detail: detail || ''});
}

// Snapshot the temporary test file once.
function snapshotOriginal() {
    ORIGINAL_RAW = Storage.readTodo(TODO).raw;
}

// Restore the original file using the (tested) write API.
// NOTE: when the file was absent (or empty) pre-test, delete it instead of
// writing '': GJS marshals an empty Uint8Array to NULL and
// g_file_replace_contents aborts on 'contents != NULL' — the write would be
// silently skipped. Absent and empty are equivalent inputs (readTodo yields
// '' for both), so restoring them by absence is byte-equivalent.
function restoreOriginal() {
    if (ORIGINAL_RAW === '') {
        try {
            Gio.File.new_for_path(TODO).delete(null);
        } catch (e) {
            // Nothing to delete; the file was already absent.
        }
        return;
    }
    Storage.writeTodo(TODO, ORIGINAL_RAW);
}

// ---- splitLines ----------------------------------------------------------

function testSplitLines() {
    const content = '# Title\n\n- [ ] Buy milk\n- [x] Write code\n\n## Notes\n- plain\n\n- [ ] Call mom\n';
    const parts = Storage.splitLines(content);

    record('splitLines: detects 3 tasks',
        parts.tasks.length === 3,
        JSON.stringify(parts.tasks.map(t => `${t.index}:${t.text}:${t.done}`)));

    record('splitLines: task fields correct',
        parts.tasks[0].text === 'Buy milk' && parts.tasks[0].done === false
        && parts.tasks[1].text === 'Write code' && parts.tasks[1].done === true
        && parts.tasks[2].text === 'Call mom' && parts.tasks[2].done === false,
        '');

    record('splitLines: preserves headings/notes/blank in other',
        parts.other.some(o => o.line === '# Title')
        && parts.other.some(o => o.line === '## Notes')
        && parts.other.some(o => o.line === '- plain')
        && parts.other.some(o => o.line === ''),
        JSON.stringify(parts.other));

    const crlf = Storage.splitLines('- [ ] a\r\n- [x] b\r\n');
    record('splitLines: handles CRLF',
        crlf.tasks.length === 2 && crlf.tasks[1].done === true,
        JSON.stringify(crlf.tasks));

    record('splitLines: empty string gives no tasks/other',
        Storage.splitLines('').tasks.length === 0 && Storage.splitLines('').other.length === 0,
        '');
}

// ---- readTodo ------------------------------------------------------------

function testReadTodo() {
    const f = Gio.File.new_for_path(TODO);
    const enc = new TextEncoder();
    f.replace_contents(enc.encode('- [ ] A\n- [x] B\n'), null, false, Gio.FileCreateFlags.NONE, null);
    const p = Storage.readTodo(TODO);
    record('readTodo: reads current file, returns raw+parsed',
        p.raw === '- [ ] A\n- [x] B\n'
        && p.tasks.length === 2 && p.other.length === 0,
        JSON.stringify({raw: p.raw, tasks: p.tasks}));
    restoreOriginal();
}

// ---- toggleTask ----------------------------------------------------------

function testToggleTask() {
    const base = '# H\n\n- [ ] Buy milk\n- [x] Write code\n';
    const toggled = Storage.toggleTask(base, 2);
    record('toggleTask: unchecked -> checked',
        toggled.includes('- [x] Buy milk'), toggled);

    const unToggle = Storage.toggleTask(toggled, 2);
    record('toggleTask: checked -> unchecked',
        unToggle.includes('- [ ] Buy milk'), unToggle);

    const nonCheck = Storage.toggleTask(base, 0);
    record('toggleTask: non-checkbox line untouched',
        nonCheck === base, nonCheck);

    const oob = Storage.toggleTask(base, 99);
    record('toggleTask: out-of-range index is no-op',
        oob === base, '');
}

// ---- deleteTask ----------------------------------------------------------

function testDeleteTask() {
    const base = '# H\n- [ ] a\n- [x] b\n';
    const delA = Storage.deleteTask(base, 1);
    record('deleteTask: removes line 1',
        !delA.includes('- [ ] a') && delA.includes('- [x] b'), delA);

    const del0 = Storage.deleteTask(base, 0);
    record('deleteTask: removes heading line',
        !del0.includes('# H') && del0.includes('- [ ] a'), del0);

    const oob = Storage.deleteTask(base, 99);
    record('deleteTask: out-of-range is no-op',
        oob === base, '');
}

// ---- editTask ------------------------------------------------------------

function testEditTask() {
    const base = '# H\n- [ ] a\n- [x] b\n';
    const editDone = Storage.editTask(base, 2, 'b edited');
    record('editTask: keeps checkbox state, replaces text',
        editDone === '# H\n- [ ] a\n- [x] b edited\n', JSON.stringify(editDone));

    const openEdit = Storage.editTask('# H\n- [ ] a\n', 1, 'a2');
    record('editTask: incomplete task text updated',
        openEdit === '# H\n- [ ] a2\n', JSON.stringify(openEdit));

    const nonCheck = Storage.editTask(base, 0, 'renamed heading');
    record('editTask: non-checkbox line replaced as plain text',
        nonCheck === 'renamed heading\n- [ ] a\n- [x] b\n', JSON.stringify(nonCheck));

    const oob = Storage.editTask(base, 99, 'x');
    record('editTask: out-of-range index is no-op',
        oob === base, '');
}

// ---- addTask -------------------------------------------------------------

function testAddTask() {
    // Faz 2 semantics: every UI-added task lands in 'General' (real heading).
    const base = '- [ ] a\n- [x] b\n';
    record('addTask: tasks before any ## form implicit General and gain the heading',
        Storage.addTask(base, 'c') === '# TODO\n## General\n- [ ] a\n- [x] b\n- [ ] c\n',
        JSON.stringify(Storage.addTask(base, 'c')));

    record('addTask: empty file starts clean under # TODO + ## General',
        Storage.addTask('', 'first') === '# TODO\n## General\n- [ ] first\n',
        JSON.stringify(Storage.addTask('', 'first')));

    record('addTask: missing trailing newline is normalized',
        Storage.addTask('- [ ] a', 'b') === '# TODO\n## General\n- [ ] a\n- [ ] b\n',
        JSON.stringify(Storage.addTask('- [ ] a', 'b')));
}

// ---- addTask: General fallback (Faz 2 step 4) -------------------------------

function testAddTaskCategorized() {
    // File with categories but no General: 'General' appended at the end.
    record('addTaskCategorized: no General in file → ## General appended at the end',
        Storage.addTask('# T\n## İş\n- [ ] a\n', 'orphan')
            === '# T\n## İş\n- [ ] a\n## General\n- [ ] orphan\n',
        JSON.stringify(Storage.addTask('# T\n## İş\n- [ ] a\n', 'orphan')));

    // Implicit General with trailing blank/notes: inserted after the LAST task,
    // keeping trailing extras at the end of the block.
    record('addTaskCategorized: inserted after last task, trailing extras stay at end',
        Storage.addTask('# T\n- [ ] a\n\n- [ ] b\n\n## Notes\n- [ ] x\n', 'new')
            === '# T\n## General\n- [ ] a\n\n- [ ] b\n- [ ] new\n\n## Notes\n- [ ] x\n',
        JSON.stringify(Storage.addTask('# T\n- [ ] a\n\n- [ ] b\n\n## Notes\n- [ ] x\n', 'new')));

    // Existing explicit General: appended to its task list.
    record('addTaskCategorized: appended to existing explicit ## General',
        Storage.addTask('# T\n## General\n- [ ] a\n\n## B\n- [ ] b\n', 'new')
            === '# T\n## General\n- [ ] a\n- [ ] new\n\n## B\n- [ ] b\n',
        JSON.stringify(Storage.addTask('# T\n## General\n- [ ] a\n\n## B\n- [ ] b\n', 'new')));

    // Tags typed in the entry text are preserved and parse consistently.
    const tagged = Storage.parseDocument(Storage.addTask('', 'buy milk @due(mon) @p(1)'));
    const t = Storage.categoryTasks(tagged.categories[0])[0];
    record('addTaskCategorized: @tag(value) in added text parses like parsed tasks',
        t.raw === 'buy milk @due(mon) @p(1)'
        && JSON.stringify(t.tags) === JSON.stringify([['due', 'mon'], ['p', '1']])
        && t.text === 'buy milk',
        JSON.stringify(t));

    // Outputs are canonical: parse∘serialize round-trips byte-identical.
    const outputs = [
        Storage.addTask('# T\n## İş\n- [ ] a\n', 'orphan'),
        Storage.addTask('# T\n- [ ] a\n\n- [ ] b\n\n## Notes\n- [ ] x\n', 'new'),
        Storage.addTask('# T\n## General\n- [ ] a\n\n## B\n- [ ] b\n', 'new'),
    ];
    record('addTaskCategorized: outputs are canonical (round-trip stable)',
        outputs.every(o => Storage.serializeDocument(Storage.parseDocument(o)) === o), '');

    // Faz 4: explicit category targeting.
    record('addTaskCategorized: named category receives the task after its last task',
        Storage.addTask('# T\n## A\n- [ ] a1\n- [ ] a2\n## B\n- [ ] b\n', 'a3', 'A')
            === '# T\n## A\n- [ ] a1\n- [ ] a2\n- [ ] a3\n## B\n- [ ] b\n', '');

    record('addTaskCategorized: missing named category is created explicitly at the end',
        Storage.addTask('# T\n## A\n- [ ] a\n', 'x', 'Yeni')
            === '# T\n## A\n- [ ] a\n## Yeni\n- [ ] x\n', '');

    record('addTaskCategorized: missing General stays implicit (fallback rule)',
        Storage.addTask('# T\n## A\n- [ ] a\n', 'x', 'General')
            === '# T\n## A\n- [ ] a\n## General\n- [ ] x\n', '');
}

// ---- writeTodo / round-trip ---------------------------------------------

function testWriteRead() {
    Storage.writeTodo(TODO, '- [ ] persisted\n');
    const p = Storage.readTodo(TODO);
    record('writeTodo -> readTodo: round-trip persists',
        p.raw === '- [ ] persisted\n' && p.tasks.length === 1
        && p.tasks[0].text === 'persisted' && p.tasks[0].done === false,
        JSON.stringify(p.tasks));
    restoreOriginal();
}

// ---- static UI regression checks -----------------------------------------
// The UI layer (extension.js) cannot be unit-tested without a GNOME Shell
// runtime, so we statically guard against the API mistakes that actually
// happened in this project (VERIFY-BEFORE-WRITE escape-hatches). Each check
// cites the real incident it prevents.

function readFileText(relPath) {
    const file = Gio.File.new_for_path(GLib.get_current_dir() + '/' + relPath);
    const [, bytes] = file.load_contents(null);
    return new TextDecoder().decode(bytes);
}

// Every regular .js file in `relDir`, sorted. Used to keep the guarded
// surface honest as the extension grows modules (see testStaticChecks).
//
// NOTE: `GLib.Dir.open(path)` throws "At least 2 arguments required" in GJS —
// the bare C name is not the exposed form. `Gio.File.enumerate_children()` is
// the API that works, verified against the offline mirror (gio20~2.0
// `gio.file`: `enumerate_children(attributes, flags, cancellable)` +
// `gio.file-enumerator.next_file`).
function listJsFiles(relDir) {
    const dir = Gio.File.new_for_path(GLib.get_current_dir() + '/' + relDir);
    const enumerator = dir.enumerate_children(
        'standard::name,standard::type', Gio.FileQueryInfoFlags.NONE, null);
    if (enumerator === null) {
        return [];
    }
    const names = [];
    let info;
    while ((info = enumerator.next_file(null)) !== null) {
        if (info.get_file_type() === Gio.FileType.REGULAR
            && info.get_name().endsWith('.js')) {
            names.push(info.get_name());
        }
    }
    enumerator.close(null);
    return names.sort();
}

function noMatch(name, content, forbiddenPattern, incident) {
    const m = content.match(forbiddenPattern);
    record(name, m === null, m === null ? incident : `found: "${m[0]}" — ${incident}`);
}

// Comment-integrity scanning (Faz 0.2 / audit D7). `node --check` cannot catch
// any of these defects: a duplicated, unclosed or misattached JSDoc block is
// still valid JavaScript, because all three survive the parser as comments.
// The audit found one of each in extension.js; the worst had swallowed four
// lines of live code plus the next method's docstring.
// Derived from the directory, not hand-listed: after the A1 split a hardcoded
// list would have quietly stopped scanning every new module, and the D7
// comment-integrity checks would have been measuring half the code.
const SOURCE_FILES = listJsFiles('todo-md@ertugrulsefal.github.com')
    .map(name => `todo-md@ertugrulsefal.github.com/${name}`);

// Source with comments removed. Negative guards ("this must never appear in
// the UI layer") otherwise match the prose that explains WHY the thing is
// forbidden — which every well-commented module eventually does.
function stripComments(src) {
    return src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:])\/\/.*$/gm, '$1');
}

// Line starts a declaration a docstring is allowed to document: a function,
// class, constant, or a class method signature.
const DECLARATION = /^(export\s+)?(default\s+)?(async\s+)?(function|class|const|let|var|get)\b|^[A-Za-z_$][\w$]*\s*\(/;

// Every /** … */ block in `src`, as {start, end, lines} (end = the `*/` line).
function docBlocks(src) {
    const lines = src.split('\n');
    const blocks = [];
    for (let i = 0; i < lines.length; i++) {
        if (!lines[i].trim().startsWith('/**')) continue;
        const start = i;
        while (i < lines.length && !lines[i].includes('*/')) i++;
        blocks.push({start, end: i, lines});
    }
    return blocks;
}

function testStaticChecks() {
    const prefs = readFileText('todo-md@ertugrulsefal.github.com/prefs.js');
    const meta = readFileText('todo-md@ertugrulsefal.github.com/metadata.json');
    const css = readFileText('todo-md@ertugrulsefal.github.com/stylesheet.css');
    const store = readFileText('todo-md@ertugrulsefal.github.com/storage.js');
    // The guarded UI surface is DERIVED FROM THE DIRECTORY, not hardcoded.
    // When extension.js is split into modules, every "this must not appear in
    // the UI layer" guard would keep passing simply because the code moved
    // out of the one file it reads — the same failure mode as audit N1's
    // tautological D1 test, inverted: a guard that measures nothing and is
    // green. Deriving the list means a new module joins the surface the day
    // it is created, and the check below fails loudly if one does not.
    // prefs.js is excluded on purpose: different process, checked separately.
    const EXT_DIR = 'todo-md@ertugrulsefal.github.com';
    const dirJsFiles = listJsFiles(EXT_DIR);
    // prefs.js is the only excluded file: it runs in the preferences process.
    const uiNames = dirJsFiles.filter(name => name !== 'prefs.js');
    const uiSources = uiNames.map(name => readFileText(`${EXT_DIR}/${name}`));
    const ui = uiSources.join('\n');
    const all = ui + '\n' + prefs + '\n' + store;
    // The tripwire: `dirJsFiles` is counted independently of the list that is
    // actually read, so replacing the derived list with hardcoded names (the
    // obvious future edit) makes the two counts diverge and this fails. Without
    // it, a module left out of the guards is invisible AND green.
    record('static: the guarded UI surface covers every shell-side module',
        dirJsFiles.length === uiNames.length + 1
        && uiNames.includes('extension.js')
        && uiSources.length >= 2
        && ui.length > 10000
        && ui.includes('export default class TodoExtension'),
        `guarded: ${uiNames.join(', ')} (${ui.length} chars); a module left out `
        + 'is invisible to every static guard — and a guard that measures '
        + 'nothing still reports PASS');

    // Real incident: idle_add(() => ...) threw on every menu open (Phase 1).
    record('static: every GLib.idle_add call passes (priority, func)',
        ui.match(/idle_add\(/g)?.length === ui.match(/idle_add\(GLib\.PRIORITY/g)?.length,
        'GLib.idle_add takes (priority, func); single-arg calls throw at runtime');

    // Real incidents from the historical edit-feature revert. NOTE: the
    // `.add(` guard applies to the SHELL-side UI layer only — prefs.js is
    // GTK4/Adwaita code where Gtk container .add() is the correct API.
    noMatch('static: no GTK hexpand/vexpand (Clutter uses set_x_expand)',
        all, /set_hexpand\(|hexpand:|vexpand/, 'GTK layout API on St actors silently misbehaves');
    noMatch('static: no GLib.Bytes for replace_contents',
        all, /GLib\.Bytes/, 'replace_contents needs a Uint8Array from TextEncoder');
    noMatch('static: no key::release / key::press pseudo-signals',
        all, /key::(release|press)/, 'GObject signals use dashes: key-release-event');
    noMatch('static: no legacy imports.* API',
        all, /\bimports\./, 'GNOME 45+ is ESM; imports.* is removed in Shell');
    noMatch('static: no legacy .add( child call in the Shell-side UI',
        ui, /\.add\(/, 'use add_child() on Clutter/St actors; GTK4 prefs may use add()');

    // Faz 2 step 3: the write path must stay atomic (temp + rename) — the
    // ONLY permitted write mechanism is Gio.File.replace_contents.
    record('static: writes go through Gio.File.replace_contents (atomic temp+rename)',
        /replace_contents\(/.test(store), 'the single write path; do not add others');
    noMatch('static: no in-place/truncate write APIs (truncate-and-write forbidden)',
        store, /open_output_stream|create_readwrite|create_sync|append_to|truncate|output_stream_write|write_bytes/,
        'use Gio.File.replace_contents (atomic temp+rename) only');

    // Project rules that must not drift. R3 (docs/roadmap.md §C): shell-version
    // lists ONLY versions verified by a manual regression run — widening it is a
    // deliberate act that follows a test, never an optimistic edit.
    record('static: metadata shell-version is exactly ["50"]',
        /"shell-version"\s*:\s*\[\s*"50"\s*\]/.test(meta),
        'only verified shell versions may be declared (R3)');
    noMatch('static: no opacity in CSS (actor label.opacity is used instead)',
        css, /opacity\s*:/, 'CSS opacity is unreliable on St.Label; use actor opacity');

    // Faz 3: the UI layer resolves the file path via _todoPath() (GSettings
    // aware); no direct default-path calls are allowed there.
    noMatch('static: extension.js does not call Storage.todoPath() directly',
        ui, /Storage\.todoPath\(/, 'use this._todoPath() so the configured path is honored');

    // Faz 3: settings infrastructure must be complete — getSettings() falls
    // back to metadata["settings-schema"] and loads schemas/ from the ext dir.
    record('static: metadata declares the settings-schema id',
        /"settings-schema"\s*:\s*"org\.gnome\.shell\.extensions\.todo-md"/.test(meta),
        'ExtensionBase.getSettings() reads metadata["settings-schema"]');

    // Faz 0.3: reviewers flag capabilities the description does not declare —
    // this extension reads and writes a user file, so the description has to
    // say so. Parsed (not regexed) so a key that merely looks like a
    // description cannot satisfy the check.
    const metaObj = JSON.parse(meta);
    const description = metaObj.description;
    const declaredShellVersions = metaObj['shell-version'];
    record('static: metadata description declares file access and compatibility',
        /\b(file|read|writes?|disk|filesystem|storage)/i.test(description)
        && /GNOME Shell/.test(description)
        // Self-maintaining: EVERY declared shell version must be named in the
        // description, so widening shell-version forces the compatibility line
        // to be updated in the same change (R3).
        && declaredShellVersions.every(v => new RegExp(`\\b${v}\\b`).test(description))
        && /\n\*/.test(description)
        && description.length >= 200,
        'EGO expects the description to state what the extension reads/writes, '
        + 'which shell versions it supports (every declared one), and to list '
        + 'features as bullets');
    // The schema XML is the only file the review guidelines require; GNOME 45+
    // compiles the binary at install time and shipping gschemas.compiled is the
    // single most frequent extensions.gnome.org rejection reason ("Please
    // remove schemas/gschemas.compiled. Not needed for 45+ packages.").
    // The binary stays in the working tree (the extension is installed through
    // a symlink and getSettings() reads it at runtime), so this guard asserts
    // that git can never pick it up again.
    record('static: schemas/gschemas.compiled is NOT committed',
        /^\*\.compiled$/m.test(readFileText('.gitignore')),
        'do not commit schemas/gschemas.compiled — reviewers reject it on every 45+ upload');

    // Faz 6.6: fixed menu width, always-scroll tab bar, fixed checkbox area.
    // The A1 split moved the strip into tabBar.js, so the guard moves with it
    // and now also asserts the module itself is clean. The rule is the
    // invariant, not the old code shape: nothing in tabBar.js may be a
    // PopupMenu item, and it must attach as a raw actor child of menu.box.
    const tabBarSrc = readFileText('todo-md@ertugrulsefal.github.com/tabBar.js');
    // Unused imports: the A1 split added three modules and one of them shipped
    // with a dead `PopupMenu` import (the tab-bar guard flagged it by accident).
    // Dead imports are noise a reviewer sees immediately, so check them here.
    const unusedImports = [];
    for (const rel of SOURCE_FILES) {
        const src = stripComments(readFileText(rel));
        // Strip ALL import statements first, module path included. Leaving the
        // `'gi://Meta'` specifier in place satisfied the word-boundary test by
        // itself, so the first version of this guard passed while an unused
        // import sat in the file — caught by mutation, not by reading.
        const bodyWithoutImports = src.replace(/^import[^;]+;$/gm, '');
        const importRe = /^import\s+(?:\*\s+as\s+(\w+)|(\w+)|\{([^}]*)\})\s+from/gm;
        let m;
        while ((m = importRe.exec(src)) !== null) {
            const names = m[1] ? [m[1]] : m[2] ? [m[2]]
                : m[3].split(',').map(n => n.trim().split(/\s+as\s+/).pop());
            for (const name of names.filter(Boolean)) {
                if (!new RegExp(`\\b${name}\\b`).test(bodyWithoutImports)) {
                    unusedImports.push(`${rel.split('/').pop()}:${name}`);
                }
            }
        }
    }
    // The inverse, and the one that actually bit: a module that USES a binding
    // it never imported. `rowFactory.js` shipped that way during the A1 split
    // (`Storage is not defined` at runtime — invisible to every other guard,
    // and the menu came up empty). Only a real `Alt+F2 -> r` showed it.
    const KNOWN_BINDINGS = ['St', 'Clutter', 'GLib', 'Gio', 'Pango', 'Atk',
        'Meta', 'Shell', 'Main', 'PanelMenu', 'PopupMenu', 'Storage',
        'TabBar', 'RowFactory'];
    const unimported = [];
    for (const rel of SOURCE_FILES) {
        const src = stripComments(readFileText(rel));
        const body = src.replace(/^import[^;]+;$/gm, '');
        const imported = new Set();
        const importRe = /^import\s+(?:\*\s+as\s+(\w+)|(\w+)|\{([^}]*)\})\s+from/gm;
        let m;
        while ((m = importRe.exec(src)) !== null) {
            if (m[1]) imported.add(m[1]);
            if (m[2]) imported.add(m[2]);
            if (m[3]) {
                for (const part of m[3].split(',')) {
                    const name = part.trim().split(/\s+as\s+/).pop();
                    if (name) imported.add(name);
                }
            }
        }
        for (const name of KNOWN_BINDINGS) {
            if (imported.has(name)) {
                continue;
            }
            if (new RegExp(`(?<![\\w$.])${name}\\.`).test(body)) {
                unimported.push(`${rel.split('/').pop()}:${name}`);
            }
        }
    }
    // Named imports must resolve to a real export in the target module.
    // Dropping the `export` keyword while the importer still lists the name
    // survives every other check here and fails only at runtime (import error),
    // so the linkage is verified from both ends.
    const missingExports = [];
    for (const rel of SOURCE_FILES) {
        const src = stripComments(readFileText(rel));
        const importRe = /import\s+\{([^}]*)\}\s+from\s+'\.\/([\w.]+)'/g;
        let m;
        while ((m = importRe.exec(src)) !== null) {
            const target = `${rel.split('/')[0]}/${m[2]}`;
            let targetSrc = '';
            try {
                targetSrc = readFileText(target);
            } catch (e) {
                missingExports.push(`${rel.split('/').pop()} -> ${m[2]} (no such module)`);
                continue;
            }
            for (const part of m[1].split(',')) {
                const name = part.trim().split(/\s+as\s+/)[0].trim();
                if (!name) {
                    continue;
                }
                const exported = new RegExp(
                    `export\\s+(?:default\\s+)?(?:async\\s+)?(?:function|class|const|let|var)\\s+${name}\\b`
                    + `|export\\s*\\{[^}]*\\b${name}\\b`).test(targetSrc);
                if (!exported) {
                    missingExports.push(`${rel.split('/').pop()} -> ${m[2]}:${name}`);
                }
            }
        }
    }
    record('static: every named import resolves to a real export',
        missingExports.length === 0,
        missingExports.join(', ') || 'each imported name is exported by its module');

    record('static: no module uses a binding it did not import',
        unimported.length === 0,
        unimported.join(', ') || 'every namespace used is imported');

    record('static: no unused imports in any source file',
        unusedImports.length === 0,
        unusedImports.join(', ') || 'every import is referenced');

    record('static: the persistent tab bar is a plain actor (NO PopupBaseMenuItem)',
        // NOTE the namespace dot: the real syntax is
        // `PopupMenu.PopupBaseMenuItem`. A first version searched for
        // `PopupMenu(Item|BaseMenuItem)`, which that string does not contain —
        // the guard passed while the forbidden call sat in the file, and only
        // mutation testing caught it.
        !/(PopupMenu\s*\.\s*Popup\w*MenuItem)|(\bPopupMenuItem\b)|(\baddMenuItem\b)/
            .test(stripComments(tabBarSrc))
        && /menuBox\.add_child\(this\.bar\)/.test(tabBarSrc)
        && /this\._tabBar\.attach\(menu\.box\)/.test(ui)
        && /this\._tabBar\.detach\(menu\.box\)/.test(ui),
        'menu.box children with a PopupBaseMenuItem _delegate are DESTROYED by '
        + 'menu.removeAll() (popupMenu.js :827-850) — shell SEGV, 2026-09-26');
    record('static: schema declares menu-width with a described default',
        /<key name="menu-width" type="i">[\s\S]*?<default>500<\/default>[\s\S]*?<description>[\s\S]+?<\/description>/.test(
            readFileText('todo-md@ertugrulsefal.github.com/schemas/org.gnome.shell.extensions.todo-md.gschema.xml')),
        'menu-width is a described int key defaulting to 500');
    record('static: no tab-bar-mode remnants (mode removed entirely)',
        !/tab-bar-mode|tabModes|scrollMode/.test(ui + '\n'
            + readFileText('todo-md@ertugrulsefal.github.com/prefs.js'))
            && !/tab-bar-mode/.test(
                readFileText('todo-md@ertugrulsefal.github.com/schemas/org.gnome.shell.extensions.todo-md.gschema.xml')),
        'shrink mode and the mode setting were removed (user decision)');
    record('static: tab bar handles wheel scrolling anywhere (scroll-event)',
        /scroll-event/.test(ui) && /hadjustment/.test(ui),
        'wheel over the tab bar scrolls horizontally, not only the scrollbar');
    record('static: task rows have a fixed-width checkbox area',
        /todo-check/.test(ui) && /todo-check/.test(css)
            && !/setOrnament\(PopupMenu\.Ornament\.CHECK\)/.test(ui),
        'checkbox is a fixed-width actor, never appended text (user decision)');
    record('static: task/header labels ellipsize via clutter_text (never CSS)',
        /clutter_text\.set_ellipsize\(Pango\.EllipsizeMode\.END\)/.test(ui)
            && !/\.todo-text\s*{[^}]*text-overflow/.test(css),
        'Pango.EllipsizeMode on the Clutter text (verified pattern)');
    record('static: hscrollbar_policy inside the always-on tab scroller',
        (ui.match(/hscrollbar_policy:/g) || []).length === 1,
        'the tab bar is unconditionally horizontally scrollable');

    // Faz 0.2 / audit D7: comment integrity. These three defects are invisible
    // to `node --check` — a duplicated, unclosed or misattached JSDoc block is
    // valid JavaScript, because all three survive the parser as comments.
    record('static: no duplicated JSDoc blocks (two /** blocks back-to-back)',
        SOURCE_FILES.every(rel => {
            const lines = readFileText(rel).split('\n');
            return !lines.some((line, i) => line.trim() === '*/'
                && i + 1 < lines.length && lines[i + 1].trim() === '/**');
        }),
        'a docstring was copy-pasted over another; delete the stale copy');
    record('static: no code swallowed by a JSDoc block',
        SOURCE_FILES.every(rel => docBlocks(readFileText(rel)).every(block =>
            block.lines.slice(block.start + 1, block.end).every(line => {
                const text = line.trim();
                return text === '' || text.startsWith('*');
            }))),
        'a /** block was never closed, so live code became comment text');
    record('static: every JSDoc block documents a declaration',
        SOURCE_FILES.every(rel => docBlocks(readFileText(rel)).every(block => {
            let i = block.end + 1;
            while (i < block.lines.length && block.lines[i].trim() === '') i++;
            return i >= block.lines.length
                || DECLARATION.test(block.lines[i].trim());
        })),
        'a docstring drifted away from the code it documents');

    // Audits D1 and N1: the UI must NOT decide the pruning itself — it must call
    // Storage.prunedColorsForDocument(colors, doc). A decision made in
    // extension.js cannot be unit-tested, and that untested decision deleted
    // the whole category-colour map twice (2026-10-01: pruned against the raw
    // doc.categories, [] for an empty file; 2026-10-02: pruned against the
    // rendered sections, which a file that lost every '##' heading renders as
    // one implicit 'General' — 6 colours → 0).
    record('static: the colour-pruning decision lives in storage.js, not the UI',
        /Storage\.prunedColorsForDocument\(\s*colors,\s*doc\s*\)/.test(ui)
        && !/Storage\.pruneCategoryColors\(/.test(ui)
        && !/pruneCategoryColors\([^)]*doc\.categories/.test(ui)
        && /export function prunedColorsForDocument/.test(store),
        'extension.js must delegate: which list is authoritative AND when not '
        + 'to prune at all are both only testable in storage.js');
    record('static: scroll-mode tab labels use EllipsizeMode.NONE',
        /EllipsizeMode\.NONE/.test(ui),
        'St.Label defaults to END (st-label.c :336); an ellipsized label has '
        + 'a small min width so the scroll cap never engages (user test)');
    record('static: text actors are width-capped (ellipsize needs constraint)',
        /max-width: \$\{this\._settings\.get_int\('menu-width'\)\}px/.test(ui)
            && !/max-width:\s*28em/.test(css)
            && !/max-width:\s*28em/.test(ui),
        'width cap comes from the menu-width setting, not a fixed value');

    // Faz 4: single-interaction invariant — every edit-state reset pairs the
    // two fields, and opening an edit closes the add entry (the exact bug
    // fixed in 0ab4e16: _startEditing missed the _addingCategory reset).
    record('static: every _editingIndex = -1 reset pairs _addingCategory',
        !/this\._editingIndex = -1;\n(?![ ]*this\._addingCategory)/.test(ui),
        'reset both fields together (single-interaction rule)');
    record('static: opening an edit closes the other interactions (_startEditing)',
        /_startEditing\(index\) \{\n\s*this\._closeInteractions\(\);\n\s*this\._editingIndex = index;/.test(ui),
        'an edit replaces any open add entry, rename row or action panel');

    // Audit D3 + Faz 7: the guards above only ever looked at two of the
    // fields, so _addingNewCategory could be left open next to an edit — two
    // focusable entries at once. There are FIVE inline interactions now (task
    // edit, category add entry, new-category entry, category rename, action
    // panel), and opening any of them must close the other four. Every opening
    // path goes through _closeInteractions(), which is also the ONLY place the
    // fields are reset, so they cannot drift apart.
    const EDIT_STATE = [
        {field: 'this._editingIndex', closed: '-1'},
        {field: 'this._addingCategory', closed: 'null'},
        {field: 'this._addingNewCategory', closed: 'false'},
        {field: 'this._renamingCategory', closed: 'null'},
        {field: 'this._actionsCategory', closed: 'null'},
    ];
    const uiLines = ui.split('\n');
    const unpaired = [];
    uiLines.forEach((line, i) => {
        for (const {field, closed} of EDIT_STATE) {
            const match = line.match(
                new RegExp(`^\\s*${field.replace('.', '\\.')} = (.+);$`));
            if (!match || match[1].trim() === closed) continue;
            // The helper closes all five; _cancelEditing() delegates to it.
            const before = uiLines.slice(i - 2, i).join('\n');
            if (before.includes('this._closeInteractions();')
                || before.includes('this._cancelEditing();')) {
                continue;
            }
            unpaired.push(`line ${i + 1} opens ${field} without closing the others`);
        }
    });
    record('static: the five interaction fields are opened and closed together',
        unpaired.length === 0,
        unpaired.length ? unpaired.join(' | ')
            : 'at most one inline interaction may be open: every opening path '
            + 'closes the other four through _closeInteractions()');
    record('static: one helper resets all five interaction fields',
        /_closeInteractions\(\) \{\n(\s*this\._(?:editingIndex|addingCategory|addingNewCategory|renamingCategory|actionsCategory) = [^\n]*\n){5}/.test(ui),
        'the single-interaction invariant is structural: five fields, one reset');
    record('static: the interaction fields are reset ONLY in that helper',
        (ui.match(/this\._editingIndex = -1;/g) || []).length === 1
        && (ui.match(/this\._addingCategory = null;/g) || []).length === 1
        && (ui.match(/this\._addingNewCategory = false;/g) || []).length === 2
        && (ui.match(/this\._renamingCategory = null;/g) || []).length === 1
        && (ui.match(/this\._actionsCategory = null;/g) || []).length === 1,
        'a partial reset elsewhere is how two interactions end up open at once; '
        + 'the one extra _addingNewCategory reset is the D5/N4-guarded success '
        + 'path of the new-category row');

    // Audit D5: addCategory rejects a name it cannot write as a heading. The UI
    // must then keep the entry open — closing it first turned Enter into a
    // dead key with no feedback.
    //
    // Both halves are windowed: a global indexOf happily matches an unrelated
    // `this._addingNewCategory = false;` further down the file (in
    // _cancelEditing), which is how the first version of this guard passed
    // against the exact bug it was written for. Line windows, not character
    // counts — a comment length must not decide whether a guard holds.
    const addLine = uiLines.findIndex(line => line.includes('const updated = Storage.addCategory'));
    const rejectLine = uiLines.findIndex(line => line.includes('if (updated === parsed.raw) {'));
    const writeLine = uiLines.findIndex(line => line.includes('if (!Storage.writeTodo(this._todoPath(), updated)) {'));
    // Windowed on writeLine: a plain findIndex would match the FIRST
    // `this._addingNewCategory = false;` in the file — the one in enable(),
    // which is nowhere near this handler.
    const closeLine = uiLines.findIndex((line, i) =>
        i > writeLine && line.includes('this._addingNewCategory = false;'));
    record('static: the new-category entry closes only after BOTH guards',
        addLine !== -1 && rejectLine > addLine && writeLine > rejectLine
        && closeLine > writeLine
        && !uiLines.slice(addLine, closeLine)
            .some(line => line.includes('this._addingNewCategory = false;')),
        'close the entry only AFTER the rejection check (D5) and AFTER the '
        + 'failed-write check (N4), so a name addCategory refuses — or a file '
        + 'that cannot be written — leaves the typed text on screen. Order, '
        + 'not a line count: the first version of this guard used a 12-line '
        + 'window and a comment block alone could break it.');

    // Audit N4: the two handlers that can lose TYPED INPUT must check the write
    // result. Discovered by mutation testing: reverting either check kept the
    // suite green, because the only N4 guard covered the new-category path.
    // The three no-input handlers (toggle/delete/move) deliberately refresh
    // anyway — a click has no text to lose, and re-reading the file is what
    // makes the menu truthful.
    //
    // A window would repeat the mistake above, so the handler body is cut at
    // its real closing brace (methods end at 4-space indentation).
    const handlerBody = signature => {
        const start = uiLines.findIndex(line => line.includes(signature));
        if (start === -1) {
            return null;
        }
        for (let i = start + 1; i < uiLines.length; i++) {
            if (uiLines[i] === '    }') {
                return uiLines.slice(start, i).join('\n');
            }
        }
        return null;
    };
    const addBody = handlerBody('_addTask(text, category) {');
    const editBody = handlerBody('_finishEditing(text) {');
    record('static: _addTask keeps the typed task when the write fails',
        addBody !== null && /if \(!Storage\.writeTodo\(/.test(addBody)
        && addBody.indexOf('if (!Storage.writeTodo(')
            < addBody.indexOf('this._closeInteractions();'),
        'a failed write must return BEFORE the inline entry closes, or the '
        + 'text the user typed is gone with no message');

    record('static: _finishEditing keeps the edited text when the write fails',
        editBody !== null && /if \(!Storage\.writeTodo\(/.test(editBody)
        && editBody.indexOf('if (!Storage.writeTodo(')
            < editBody.indexOf('this._closeInteractions();'),
        'same rule for the edit commit: the old text stays on disk, the new one '
        + 'stays on screen');

    // ---- Faz 7: category action panel (approved design H) ----------------
    //
    // The panel is a PopupSubMenu — the shell's own inline expander — attached
    // to the content flow as a PLAIN actor. A PopupBaseMenuItem there would be
    // destroyed by contentSection.removeAll() (popupMenu.js :827-850), the
    // exact shape of the 2026-09-26 SEGV.
    record('static: the action panel is a PopupSubMenu, never a menu item',
        /new PopupMenu\.PopupSubMenu\(/.test(ui)
        && /this\._actions\.box\.add_child\(item\.actor\)/.test(ui)
        && !/PopupSubMenuMenuItem/.test(ui)
        && !/this\._actions\.addMenuItem\(/.test(ui),
        'addMenuItem() also wires activate -> itemActivated(), which closes the '
        + 'menu on the FIRST click (popupMenu.js :694-701) — the two-step delete '
        + 'needs the panel to survive it, so the items are added directly');

    record('static: the header actions button replaced the per-category +',
        /accessible_name: `Actions for \$\{categoryName\}`/.test(ui)
        && /view-more-symbolic/.test(ui)
        && !/accessible_name: `Add task to/.test(ui),
        'Faz 7: one entry point per category — adding a task is the panel\'s '
        + 'first entry, not a second button next to it');

    // Windowed on the handler body: /return Clutter\.EVENT_STOP;/ alone also
    // matches every inline-entry handler in the file, so the mutation that
    // turned this one into EVENT_PROPAGATE stayed green (mutation-tested).
    const tabActionsBody = handlerBody('_connectActions(button, categoryName, onActions) {');
    record('static: right-click on a tab opens the same panel (practical trigger)',
        /event\.get_button\(\) !== 3/.test(ui)
        && /onActions\(categoryName\);/.test(ui)
        && tabActionsBody !== null
        && /return Clutter\.EVENT_STOP;/.test(tabActionsBody),
        'the tab keeps its left-click selection (St.Button default mask is '
        + 'BUTTON1) and the press stops at the tab (EVENT_STOP halts the '
        + 'scene-graph propagation, Clutter.Actor docs)');

    record('static: the panel sourceActor is a menu item (Left-key path)',
        /this\._actions\.sourceActor = header;/.test(ui),
        'PopupSubMenu\'s own Left-key handler dereferences '
        + 'sourceActor._delegate.active (popupMenu.js :1160-1164)');

    // L-018: the file is the source of truth, the colour map follows it. Both
    // Faz 7 mutations must write the file BEFORE touching the settings map.
    const deleteWrite = uiLines.findIndex(l => l.includes('Storage.deleteCategory('));
    const deleteFile = uiLines.findIndex((l, i) => i > deleteWrite
        && l.includes('Storage.writeTodo(this._todoPath(), updated)'));
    const deleteColour = uiLines.findIndex((l, i) => i > deleteFile
        && l.includes("set_value('category-colors'"));
    record('static: deleting writes the file before dropping the colour (L-018)',
        deleteWrite !== -1 && deleteFile > deleteWrite && deleteColour > deleteFile,
        'changed::category-colors fires synchronously; the map must follow the '
        + 'file, never lead it');

    const renameWrite = uiLines.findIndex(l => l.includes('Storage.renameCategory('));
    const renameFile = uiLines.findIndex((l, i) => i > renameWrite
        && l.includes('Storage.writeTodo(this._todoPath(), updated)'));
    const renameColour = uiLines.findIndex((l, i) => i > renameFile
        && l.includes('moveCategoryColor('));
    record('static: renaming writes the file before moving the colour (L-018)',
        renameWrite !== -1 && renameFile > renameWrite && renameColour > renameFile,
        'same order as the new-category flow: file first, then the map');

    // Found by the user in the first manual test of this panel: renaming from
    // a category tab threw them back to 'All'. set_value fires
    // changed::category-colors SYNCHRONOUSLY (L-018), and that refresh drops an
    // active category the file no longer has — so the new name has to be in
    // place BEFORE the colour write.
    const renameActive = uiLines.findIndex((l, i) => i > renameWrite
        && l.includes('this._activeCategory = name;'));
    const renameSet = uiLines.findIndex((l, i) => i > renameFile
        && l.includes("set_value('category-colors'"));
    record('static: renaming keeps the active tab (order vs the sync signal)',
        renameActive !== -1 && renameSet !== -1 && renameActive < renameSet,
        'the active category must be renamed before the colour write, or the '
        + 'synchronous refresh drops it and the menu falls back to All');

    record('static: right-click on a category header row opens the panel',
        /header\.connect\('button-press-event', \(actor, event\) => \{\n\s*if \(event\.get_button\(\) !== 3\) \{\n\s*return Clutter\.EVENT_PROPAGATE;\n\s*\}\n\s*this\._toggleActions\(categoryName\);\n\s*return Clutter\.EVENT_STOP;/.test(ui),
        'the category NAME row is the practical trigger inside the menu, '
        + 'matching the tab right-click');

    // Both conditions are matched WITH their `if`, so disabling either check
    // (`if (false && ...)`) is caught — mutation-tested: the call alone stayed
    // green while the guard was effectively off.
    record('static: the panel actor is detached on every refresh',
        /if \(this\._actions\.actor\.get_parent\(\)\) \{\n\s*this\._actions\.actor\.get_parent\(\)\.remove_child\(this\._actions\.actor\);\n\s*\}/.test(ui),
        'the panel is untracked by removeAll(): without an unconditional detach '
        + 'a stale copy would stack up on every refresh');
    record('static: the panel is destroyed in disable()',
        /if \(this\._actions\) \{\n\s*this\._actions\.destroy\(\);/.test(ui),
        'its Main.sessionMode connection must be dropped when the extension is '
        + 'disabled (guidelines: remove what you added)');

    // ---- Faz 8: the in-menu colour picker --------------------------------
    //
    // The picker is a panel SUB-STATE (a row inside the PopupSubMenu), not a
    // sixth interaction field: the five-field invariant stays intact and
    // _hideActionsPanel() resets it right next to the delete arm.
    const colorPickerBody = handlerBody('_makeColorRow() {');
    const applyColorBody = handlerBody('_applyCategoryColor(hex) {');
    record('static: Change color is active and opens the picker',
        /const colorItem = new PopupMenu\.PopupMenuItem\('Change color'\);\n\s*colorItem\.connect\('activate', \(\) => \{\n\s*this\._openColorPicker\(\);/.test(ui)
        && !/colorItem\.setSensitive\(false\)/.test(ui),
        'Faz 8 turned the placeholder entry on; the picker opens INSIDE the panel');

    record('static: the picker is a panel sub-state, reset with the panel',
        /_hideActionsPanel\(\) \{\n\s*this\._resetDeleteConfirm\(\);\n\s*if \(this\._colorPickerOpen\) \{/.test(ui),
        'the picker row and the delete arm are reset in one place, so the '
        + 'five-field single-interaction invariant does not grow');

    record('static: every swatch is named for a screen reader',
        colorPickerBody !== null
        && (colorPickerBody.match(/accessible_name:/g) || []).length === 2
        && /Storage\.CATEGORY_PALETTE_NAMES\[i\]/.test(colorPickerBody),
        'an icon-only button without accessible_name is announced as just '
        + '"button" (audit D8); the palette and its names cannot drift apart');

    // The palette lives in storage.js only: a second copy of those hexes in the
    // UI layer is exactly how the prefs palette and the menu picker would
    // diverge. storage.js is excluded from this half on purpose — it is the
    // source.
    const uiNoStore = uiNames.filter(name => name !== 'storage.js')
        .map(name => readFileText(`${EXT_DIR}/${name}`)).join('\n');
    record('static: the palette hexes live in storage.js only',
        Storage.CATEGORY_PALETTE.every(hex => !uiNoStore.includes(hex))
        && /Storage\.CATEGORY_PALETTE\.forEach/.test(ui),
        'the UI iterates Storage.CATEGORY_PALETTE; hardcoding a hex would let '
        + 'the picker and the auto-assignment drift apart');

    // L-018 EXCEPTION, pinned so nobody "fixes" it later: a colour lives in
    // GSettings only, so this path must NOT write the file first — there is
    // nothing to write, and the map IS the source of truth here.
    record('static: applying a colour writes the map and never the file',
        applyColorBody !== null
        && /set_value\('category-colors'/.test(applyColorBody)
        && /Storage\.setCategoryColor\(/.test(applyColorBody)
        && /Storage\.removeCategoryColor\(/.test(applyColorBody)
        && !/writeTodo/.test(applyColorBody),
        'the colour map is the source of truth for colours (L-018 covers '
        + 'file-backed state only)');

    record('static: the picker rings the colour the category actually has',
        /_markSelectedSwatch\(\) \{[\s\S]{0,400}?Storage\.categoryColorHex\(this\._actionsCategory, colors\)/.test(ui)
        && /button\.set_checked\(hex === current\)/.test(ui),
        'the picker must show the current colour, not just offer choices');

    // Audit D8: an icon-only button with no accessible_name is announced as
    // just "button". The tab buttons carry visible text, so they are exempt.
    const iconButtons = (ui.match(/new St\.Button\(\{/g) || []).length;
    // Rewritten after the A1 split: counting "6 named / 8 buttons" was tied to
    // one file and to a fixed shape, so moving one button broke it while
    // measuring nothing. The rule is now per-button: every St.Button is either
    // named with accessible_name, or a .todo-tab whose label is set immediately
    // after construction (a visible text label is its accessible name).
    const buttonBlocks = (src) => {
        // Scan the COMMENT-STRIPPED text end to end: matching on the original
        // and slicing from it would mix two coordinate systems (the first
        // version did exactly that and matched a `new St.Button(` mentioned
        // inside prose).
        const clean = stripComments(src);
        const out = [];
        const re = /new St\.Button\(\{/g;
        let m;
        while ((m = re.exec(clean)) !== null) {
            let depth = 0;
            let i = m.index + 'new St.Button('.length - 1;
            for (; i < clean.length; i++) {
                if (clean[i] === '{') depth++;
                else if (clean[i] === '}' && --depth === 0) break;
            }
            out.push(clean.slice(m.index, i + 1));
            re.lastIndex = i + 1;
        }
        return out;
    };
    const buttons = buttonBlocks(ui);
    const unnamed = buttons.filter(block =>
        !/accessible_name:/.test(block) && !/todo-tab button/.test(block));
    record('static: every button is named or carries a visible label',
        buttons.length >= 7 && unnamed.length === 0,
        `${unnamed.length} unnamed of ${buttons.length}; an icon-only button `
        + 'without accessible_name is announced as just "button" (audit D8) — '
        + `first: ${unnamed[0] ? unnamed[0].slice(0, 80) : 'n/a'}`);

    record('static: task rows carry the checkable-menu-item semantics',
        /import Atk from 'gi:\/\/Atk';/.test(ui)
        && /row\.accessible_role = Atk\.Role\.CHECK_MENU_ITEM;/.test(ui)
        && /row\.label_actor = label;/.test(ui)
        && /row\.add_accessible_state\(Atk\.StateType\.CHECKED\);/.test(ui),
        'a screen reader must learn what a row is and whether it is done '
        + '(PopupBaseMenuItem has no checkAccessibleState — that is only on '
        + 'PopupSwitchMenuItem, so the state is maintained here)');

    // Audit S6: a main loop source that is not tracked cannot be removed in
    // disable(), which the review guidelines require even when the callback
    // returns SOURCE_REMOVE — a pending idle would refresh a torn-down menu.
    const idleLine = uiLines.findIndex(line => line.includes('= GLib.idle_add('));
    record('static: the open-menu idle is tracked and cancelled in disable()',
        /this\._openIdleId = GLib\.idle_add\(/.test(ui)
        && idleLine !== -1
        && uiLines.slice(idleLine, idleLine + 8)
            .some(line => line.includes('this._openIdleId = 0;'))
        && /disable\(\)\s*\{[\s\S]{0,900}?GLib\.Source\.remove\(this\._openIdleId\)/.test(ui),
        'store the GLib.idle_add source id and remove it in disable() — every '
        + 'main loop source must be removable when the extension is turned off');

    // The color map is the only record of a category's color, and pruning it
    // writes the pruned result back through set_value. A failed read used to
    // look like "every category was deleted" and wiped it permanently.
    record('readTodo: reports whether the read actually succeeded',
        Storage.readTodo('/nonexistent/todo.md').ok === false
        && Storage.readTodo('/nonexistent/todo.md').raw === ''
        && (() => {
            Storage.writeTodo(TODO, '- [ ] ok probe\n');
            const read = Storage.readTodo(TODO);
            restoreOriginal();
            return read.ok === true && read.raw === '- [ ] ok probe\n';
        })(),
        'ok:false means "could not read", not "the file is empty"');

    record('color prune: a failed read must not be treated as "no categories"',
        /todo\.ok\s*\?\s*Storage\.prunedColorsForDocument/.test(ui)
        && /if \(todo\.ok && prunedColors !== colors\)/.test(ui),
        'an unreadable file (editor atomic save, rename window) produced an '
        + 'empty document, which pruned every category color away for good');
}

// ---- parseDocument (Faz 2 step 1: parser) --------------------------------

function testParseDocument() {
    const FIXTURE = [
        '# My TODOs',
        '- [ ] orphan task @tag(v)',
        '',
        '## Notes',
        '- keep me',
        '',
        '- [x] done thing',
        '## İş',
        '- [ ] write report @due(monday) @p(1)',
        '- [X] uppercase done',
        'trailing note',
    ].join('\n');
    const doc = Storage.parseDocument(FIXTURE);

    record('parseDocument: H1 stored raw as title',
        doc.title === '# My TODOs', JSON.stringify(doc.title));

    record('parseDocument: categories in file order (General first)',
        doc.categories.length === 3
        && doc.categories[0].name === 'General'
        && doc.categories[1].name === 'Notes'
        && doc.categories[2].name === 'İş',
        JSON.stringify(doc.categories.map(c => c.name)));

    const genel = doc.categories[0];
    record('parseDocument: task before first ## falls into General (fallback)',
        genel.items.length === 2
        && genel.items[0].type === 'task'
        && genel.items[0].text === 'orphan task'
        && genel.items[0].done === false
        && genel.items[1].type === 'extra' && genel.items[1].raw === '',
        JSON.stringify(genel.items));

    record('parseDocument: tags are free-form ordered [key, value] pairs',
        JSON.stringify(genel.items[0].tags) === JSON.stringify([['tag', 'v']]),
        JSON.stringify(genel.items[0].tags));

    const notes = doc.categories[1];
    record('parseDocument: extras kept verbatim, interleaved in original order',
        notes.items.length === 3
        && notes.items[0].type === 'extra' && notes.items[0].raw === '- keep me'
        && notes.items[1].type === 'extra' && notes.items[1].raw === ''
        && notes.items[2].type === 'task' && notes.items[2].text === 'done thing'
        && notes.items[2].done === true,
        JSON.stringify(notes.items));

    const is = doc.categories[2];
    record('parseDocument: task text excludes tags; multiple tags keep order',
        is.items[0].text === 'write report'
        && JSON.stringify(is.items[0].tags)
            === JSON.stringify([['due', 'monday'], ['p', '1']]),
        JSON.stringify(is.items[0]));

    record('parseDocument: [X] accepted as done=true (normalized on write)',
        is.items[1].done === true && is.items[1].text === 'uppercase done',
        JSON.stringify(is.items[1]));

    record('parseDocument: trailing non-task line is an extra of its category',
        is.items[2].type === 'extra' && is.items[2].raw === 'trailing note',
        JSON.stringify(is.items[2]));

    record('parseDocument: categoryTasks() returns only task items',
        Storage.categoryTasks(genel).length === 1
        && Storage.categoryTasks(notes).length === 1
        && Storage.categoryTasks(is).length === 2,
        '');

    const noTitle = Storage.parseDocument('- [ ] only task\n## A\n- [ ] x\n');
    record('parseDocument: file without H1 → title null, General fallback works',
        noTitle.title === null && noTitle.categories.length === 2
        && noTitle.categories[0].name === 'General',
        JSON.stringify(noTitle.categories.map(c => c.name)));

    record('parseDocument: ### subheading is an extra, not a category',
        Storage.parseDocument('## A\n### sub\n').categories[0].items[0].type === 'extra',
        '');

    const twoH1 = Storage.parseDocument('# One\n# Two\n');
    record('parseDocument: second H1 line preserved as an extra (no data loss)',
        twoH1.title === '# One' && twoH1.categories[0].items[0].raw === '# Two',
        JSON.stringify(twoH1));

    record('parseDocument: task items carry their 0-based line index',
        genel.items[0].index === 1
        && notes.items[2].index === 6
        && is.items[0].index === 8
        && is.items[1].index === 9,
        JSON.stringify([genel.items[0].index, notes.items[2].index,
            is.items[0].index, is.items[1].index]));

    record('parseDocument: empty content → empty document',
        Storage.parseDocument('').title === null
        && Storage.parseDocument('').categories.length === 0,
        '');
}

// ---- serializeDocument (Faz 2 step 2: serializer) ------------------------

function testSerializeDocument() {
    // Strict byte-identical round-trip on a canonical file.
    const CANONICAL = [
        '# My TODOs',
        '',
        '## General',
        '- [ ] orphan task @tag(v)',
        '',
        '## Notes',
        '- keep me',
        '',
        '- [x] done thing',
        '## İş',
        '- [ ] write report @due(monday) @p(1)',
        '- [ ] uppercase done',
        'trailing note',
    ].join('\n') + '\n';
    record('serializeDocument: canonical file round-trips byte-identical',
        Storage.serializeDocument(Storage.parseDocument(CANONICAL)) === CANONICAL,
        JSON.stringify(Storage.serializeDocument(Storage.parseDocument(CANONICAL))));

    // Real-world shape: blanks between the title and the first '##' (implicit
    // General holding only extras) must not gain a '## General' heading.
    const REAL_LIKE = '# My TODOs\n\n\n## Notes\n- keep me\n\n- [x] done\n';
    record('serializeDocument: extras-only implicit General stays headingless',
        Storage.serializeDocument(Storage.parseDocument(REAL_LIKE)) === REAL_LIKE, '');

    // Locked rule: tasks in an implicit General gain a real '## General' heading.
    record('serializeDocument: implicit General with tasks gains ## General heading',
        Storage.serializeDocument(Storage.parseDocument('# T\n- [ ] a\n## B\n- [ ] b\n'))
            === '# T\n## General\n- [ ] a\n## B\n- [ ] b\n', '');

    // An explicit '## General' takes over the implicit fallback bucket, keeping
    // byte order: pre-heading items stay before the heading.
    const merged = Storage.parseDocument('# T\n- [ ] a\n## General\n- [ ] b\n');
    record('serializeDocument: implicit+explicit General merge keeps line order',
        merged.categories.length === 1
        && Storage.serializeDocument(merged) === '# T\n- [ ] a\n## General\n- [ ] b\n',
        JSON.stringify(merged.categories));

    // Locked rule: missing H1 gains '# TODO'.
    record('serializeDocument: missing H1 gains # TODO',
        Storage.serializeDocument(Storage.parseDocument('- [ ] a\n')) === '# TODO\n## General\n- [ ] a\n', '');

    // Locked, documented normalization (README "Deliberate normalizations"):
    // the file is always written with LF. Line-level mutations keep the CR
    // bytes because they edit raw lines; only the document-level ones rewrite
    // the file. No content is lost either way.
    const CRLF = '# TODO\r\n## C\r\n- [ ] a\r\n';
    record('CRLF: checking a task works (the regex could not see past \\r)',
        Storage.toggleTask(CRLF, 2) === '# TODO\r\n## C\r\n- [x] a\r\n'
        && Storage.toggleTask(Storage.toggleTask(CRLF, 2), 2)
            === CRLF,
        JSON.stringify(Storage.toggleTask(CRLF, 2)));

    record('CRLF: inline editing keeps the checkbox',
        Storage.editTask(CRLF, 2, 'b') === '# TODO\r\n## C\r\n- [ ] b\r\n',
        JSON.stringify(Storage.editTask(CRLF, 2, 'b')));

    record('CRLF: deleting a task still works',
        Storage.deleteTask(CRLF, 2) === '# TODO\r\n## C\r\n',
        JSON.stringify(Storage.deleteTask(CRLF, 2)));

    record('CRLF: a non-checkbox line is still replaced verbatim, CR kept',
        Storage.editTask(CRLF, 0, 'z') === 'z\r\n## C\r\n- [ ] a\r\n'
        && Storage.editTask('# TODO\n- [ ] a\n', 0, 'z') === 'z\n- [ ] a\n',
        JSON.stringify(Storage.editTask(CRLF, 0, 'z')));

    record('CRLF: document-level writes keep the file\'s line endings',
        Storage.addTask(CRLF, 'b', 'C')
            === '# TODO\r\n## C\r\n- [ ] a\r\n- [ ] b\r\n'
        && Storage.addCategory(CRLF, 'D')
            === '# TODO\r\n## C\r\n- [ ] a\r\n## D\r\n',
        JSON.stringify(Storage.addTask(CRLF, 'b', 'C')));

    record('CRLF: round-trip is byte-identical (the whole point)',
        Storage.serializeDocument(Storage.parseDocument(CRLF)) === CRLF,
        JSON.stringify(Storage.serializeDocument(Storage.parseDocument(CRLF))));

    record('LF: round-trip stays byte-identical (no eol regression)',
        Storage.serializeDocument(Storage.parseDocument(
            '# TODO\n## C\n- [ ] a\n')) === '# TODO\n## C\n- [ ] a\n', '');

    record('eol: any CRLF in the file means CRLF for the whole file',
        // Mixed input (last line LF-only): the output is CRLF throughout.
        // ('## General' is the documented implicit-category heading.)
        Storage.serializeDocument(Storage.parseDocument('# T\r\n- [ ] a\n'))
            === '# T\r\n## General\r\n- [ ] a\r\n',
        JSON.stringify(Storage.serializeDocument(
            Storage.parseDocument('# T\r\n- [ ] a\n'))));

    record('serializeDocument: empty document → only # TODO',
        Storage.serializeDocument(Storage.parseDocument('')) === '# TODO\n', '');

    // Locked rule: [X] normalized to [x] on write.
    record('serializeDocument: [X] normalized to [x]',
        Storage.serializeDocument(Storage.parseDocument('- [X] a\n')) === '# TODO\n## General\n- [x] a\n', '');

    // Heading and task-prefix normalizations + trailing newline.
    record('serializeDocument: headings, prefixes, trailing newline normalized',
        Storage.serializeDocument(Storage.parseDocument('##Notes\n-  [ ] a'))
            === '# TODO\n## Notes\n- [ ] a\n', '');

    // Interleaved inline tags survive verbatim (raw is authoritative).
    const INTERLEAVED = '# T\n## General\n- [ ] buy @due(x) milk\n';
    record('serializeDocument: interleaved inline tags preserved verbatim',
        Storage.serializeDocument(Storage.parseDocument(INTERLEAVED)) === INTERLEAVED, '');

    // serialize ∘ parse is idempotent.
    const once = Storage.serializeDocument(Storage.parseDocument(CANONICAL));
    record('serializeDocument: idempotent (serialize∘parse applied twice is stable)',
        Storage.serializeDocument(Storage.parseDocument(once)) === once, '');
}

// ---- category name hygiene (audit D5) -----------------------------------

// addCategory writes `## <name>`. A name that cannot survive that round-trip
// used to be written anyway: 'a\nb' escaped the heading and left `b` as stray
// text, and '## Injected' produced a nested-looking heading. Both are now
// rejected, and the caller keeps the entry open so Enter is not a dead key.
function testCategoryNameHygiene() {
    const BASE = '# TODO\n## Notes\n- [ ] x\n';

    const added = name => {
        const out = Storage.addCategory(BASE, name);
        return out === BASE ? '<reddedildi>' : out;
    };

    record('addCategory: a line break in the name is rejected',
        added('a\nb') === '<reddedildi>'
        && added('a\rb') === '<reddedildi>'
        && added('\n') === '<reddedildi>',
        JSON.stringify(added('a\nb')));

    record('addCategory: a leading # is rejected (no nested heading)',
        added('## Injected') === '<reddedildi>'
        && added('# TODO') === '<reddedildi>'
        && added('### Derin') === '<reddedildi>',
        JSON.stringify(added('## Injected')));

    record('addCategory: empty and whitespace-only names are rejected',
        added('') === '<reddedildi>'
        && added('   ') === '<reddedildi>'
        && added('\t') === '<reddedildi>', '');

    record('addCategory: an existing name is still rejected',
        added('Notes') === '<reddedildi>', '');

    record('addCategory: a rejected call returns the file byte-identically',
        Storage.addCategory(BASE, 'a\nb') === BASE, '');

    record('addCategory: ordinary names are accepted and trimmed',
        added('   Work   ') === '# TODO\n## Notes\n- [ ] x\n## Work\n'
        && added('İş takip') === '# TODO\n## Notes\n- [ ] x\n## İş takip\n',
        JSON.stringify(added('   Work   ')));

    record('addCategory: names that look like content but are legal',
        added('- [ ] x') === '# TODO\n## Notes\n- [ ] x\n## - [ ] x\n'
        && added('...') === '# TODO\n## Notes\n- [ ] x\n## ...\n', '');

    const created = Storage.parseDocument(added('İş takip')).categories;
    record('addCategory: the stored name is exactly what was accepted',
        created[created.length - 1].name === 'İş takip',
        JSON.stringify(created.map(c => c.name)));

    record('isUsableCategoryName: rejects only what would corrupt the file',
        Storage.isUsableCategoryName('Work') === true
        && Storage.isUsableCategoryName('İş takip') === true
        && Storage.isUsableCategoryName('- [ ] x') === true
        && Storage.isUsableCategoryName('') === false
        && Storage.isUsableCategoryName('#x') === false
        && Storage.isUsableCategoryName('a\nb') === false
        && Storage.isUsableCategoryName('a\rb') === false, '');
}

// ---- category delete / rename (Faz 7) ------------------------------------

// deleteCategory / renameCategory / moveCategoryColor: the pure layer of the
// tab action menu. Destructive semantics are deliberate (approved Faz 7
// decision A: heading + tasks + extras all go); the two-step confirmation
// lives in the UI. Every rejection returns the content byte-identically.
function testCategoryDeleteRename() {
    const BASE = '# TODO\n## A\n- [ ] a1\nnote\n- [x] a2\n## B\n- [ ] b1\n';

    record('deleteCategory: removes heading, tasks and extras of that category only',
        Storage.deleteCategory(BASE, 'A')
            === '# TODO\n## B\n- [ ] b1\n'
        && Storage.deleteCategory(BASE, 'B')
            === '# TODO\n## A\n- [ ] a1\nnote\n- [x] a2\n',
        JSON.stringify(Storage.deleteCategory(BASE, 'A')));

    record('deleteCategory: an unknown name is a byte-identical no-op',
        Storage.deleteCategory(BASE, 'Nope') === BASE, '');

    record('deleteCategory: the implicit General bucket is refused',
        Storage.deleteCategory('Note\n- [ ] t\n', 'General') === 'Note\n- [ ] t\n', '');

    record('deleteCategory: an explicit General heading IS deletable',
        Storage.deleteCategory('# TODO\n## General\n- [ ] g\n', 'General')
            === '# TODO\n', '');

    record('deleteCategory: deleting the last category leaves a title-only file',
        Storage.deleteCategory('# TODO\n## A\n- [ ] a\n', 'A') === '# TODO\n', '');

    record('deleteCategory: the explicit General with preamble loses the preamble too',
        Storage.deleteCategory('- [ ] pre\n## General\n- [ ] post\n', 'General')
            === '# TODO\n',
        JSON.stringify(Storage.deleteCategory('- [ ] pre\n## General\n- [ ] post\n', 'General')));

    record('deleteCategory: the result round-trips stably',
        (() => {
            const once = Storage.deleteCategory(BASE, 'A');
            return Storage.serializeDocument(Storage.parseDocument(once)) === once;
        })(), '');

    const RENAMED = Storage.renameCategory(BASE, 'A', 'Work');
    record('renameCategory: rewrites the heading in place, tasks untouched',
        RENAMED === '# TODO\n## Work\n- [ ] a1\nnote\n- [x] a2\n## B\n- [ ] b1\n',
        JSON.stringify(RENAMED));

    record('renameCategory: the new name is trimmed',
        Storage.renameCategory(BASE, 'A', '  Work  ') === RENAMED, '');

    record('renameCategory: unusable names are rejected byte-identically',
        Storage.renameCategory(BASE, 'A', 'a\nb') === BASE
        && Storage.renameCategory(BASE, 'A', '## Injected') === BASE
        && Storage.renameCategory(BASE, 'A', '') === BASE
        && Storage.renameCategory(BASE, 'A', '  ') === BASE, '');

    record('renameCategory: an existing name (case-sensitive) is rejected',
        Storage.renameCategory(BASE, 'A', 'B') === BASE
        && Storage.renameCategory('# TODO\n## A\n- [ ] a\n## a\n- [ ] b\n',
            'a', 'A') === '# TODO\n## A\n- [ ] a\n## a\n- [ ] b\n', '');

    record('renameCategory: the identical name is a no-op',
        Storage.renameCategory(BASE, 'A', 'A') === BASE
        && Storage.renameCategory(BASE, 'A', ' A ') === BASE, '');

    record('renameCategory: an unknown source name is a no-op',
        Storage.renameCategory(BASE, 'Nope', 'X') === BASE, '');

    record('renameCategory: the implicit General bucket is refused',
        Storage.renameCategory('Note\n- [ ] t\n', 'General', 'X')
            === 'Note\n- [ ] t\n', '');

    record('renameCategory: an implicit General counts as existing for duplicates',
        Storage.renameCategory('note\n## X\n- [ ] a\n', 'X', 'General')
            === 'note\n## X\n- [ ] a\n', '');

    record('renameCategory: extras and blank lines survive under the new name',
        Storage.renameCategory('# TODO\n## A\n\nextra\n- [ ] a1\n', 'A', 'W')
            === '# TODO\n## W\n\nextra\n- [ ] a1\n', '');

    // Faz 7 verification probe: renaming the explicit '## General' that took
    // over the pre-heading preamble used to leave those items ABOVE the new
    // heading, so the next read orphaned them into a fresh implicit 'General'
    // bucket — the serialized form was not stable. The items now follow the
    // renamed heading (they belong to that category either way).
    const PREAMBLE = 'no title\n- [ ] pre\n## General\n- [ ] post\n## Other\nextra\n';
    const PRE_RENAMED = Storage.renameCategory(PREAMBLE, 'General', 'Work');
    record('renameCategory: a preamble-carrying General takes its items along',
        PRE_RENAMED === '# TODO\n## Work\nno title\n- [ ] pre\n- [ ] post\n## Other\nextra\n',
        JSON.stringify(PRE_RENAMED));
    record('renameCategory: the preamble rename round-trips stably',
        Storage.serializeDocument(Storage.parseDocument(PRE_RENAMED)) === PRE_RENAMED,
        JSON.stringify(Storage.serializeDocument(Storage.parseDocument(PRE_RENAMED))));

    record('renameCategory: the result round-trips stably',
        Storage.serializeDocument(Storage.parseDocument(RENAMED)) === RENAMED, '');

    const COLORS = {A: '#111111', B: '#222222'};
    const MOVED = Storage.moveCategoryColor(COLORS, 'A', 'C');
    record('moveCategoryColor: the entry moves, others survive, input is not mutated',
        MOVED.B === '#222222' && MOVED.C === '#111111' && !('A' in MOVED)
        && COLORS.A === '#111111' && COLORS.B === '#222222',
        JSON.stringify(MOVED));

    record('moveCategoryColor: no entry to move is returned unchanged',
        Storage.moveCategoryColor(COLORS, 'Nope', 'C') === COLORS, '');

    record('moveCategoryColor: identical names are a no-op',
        Storage.moveCategoryColor(COLORS, 'A', 'A') === COLORS, '');

    record('moveCategoryColor: a stale target entry is overwritten',
        JSON.stringify(Storage.moveCategoryColor({A: '#111111', C: '#999999'}, 'A', 'C'))
            === '{"C":"#111111"}', '');

    record('moveCategoryColor: a missing map is returned unchanged',
        Storage.moveCategoryColor(null, 'A', 'C') === null
        && Storage.moveCategoryColor(undefined, 'A', 'C') === undefined, '');

    record('removeCategoryColor: drops one entry, keeps the rest, input untouched',
        (() => {
            const c = {A: '#111111', B: '#222222'};
            const out = Storage.removeCategoryColor(c, 'A');
            return !('A' in out) && out.B === '#222222'
                && c.A === '#111111' && c.B === '#222222';
        })(), '');

    record('removeCategoryColor: an absent name returns the same map',
        (() => {
            const c = {A: '#111111'};
            return Storage.removeCategoryColor(c, 'Nope') === c;
        })(), '');

    record('removeCategoryColor: a missing map is returned unchanged',
        Storage.removeCategoryColor(null, 'A') === null
        && Storage.removeCategoryColor(undefined, 'A') === undefined, '');


    // A category literally named '__proto__' is an edge the settings layer
    // cannot represent: GJS packs the key into a{ss} but deep_unpack drops it,
    // so no colour can ever be stored/read for it. Both facts are pinned here
    // — if a future GJS changes the unpack behaviour, these tests tell us.
    const protoMap = () => {
        const m = {B: '#222222'};
        Object.defineProperty(m, '__proto__',
            {value: '#111111', enumerable: true, writable: true, configurable: true});
        return m;
    };
    record('moveCategoryColor: a __proto__ target is refused, not silently dropped',
        (() => {
            const m = protoMap();
            const out = Storage.moveCategoryColor(m, 'B', '__proto__');
            return out === m && out.B === '#222222';
        })(), '');

    record('GJS a{ss}: a __proto__ key packs but is dropped by deep_unpack',
        (() => {
            const dict = protoMap();
            const variant = new GLib.Variant('a{ss}', dict);
            const unpacked = variant.deep_unpack();
            return variant.print(true).includes('__proto__')
                && Object.keys(unpacked).length === 1
                && unpacked.B === '#222222'
                && !Object.prototype.hasOwnProperty.call(unpacked, '__proto__');
        })(),
        'a category named __proto__ can never carry a colour (settings limitation)');
}

// ---- preamble fidelity (audit D2 + D4, one model change) ---------------

// The region of a file before its first explicit '## Name' heading used to be
// parked in a SECOND item list (`preItems`). Every consumer read `items`, so
// those tasks were invisible in the menu and silently refused tags and moves.
// Now one list holds them and `preCount` marks where the heading goes. D2 rides
// along: a '# ' heading that does not open the file stays where the user put
// it instead of being hoisted to the top on the next write.
function testPreambleFidelity() {
    const PREAMBLE = '# T\n- [ ] a\n## General\n- [ ] b\n';

    const doc = Storage.parseDocument(PREAMBLE);
    record('preamble: one item list, no second list to go stale',
        doc.categories.length === 1
        && doc.categories[0].items.length === 2
        && !('preItems' in doc.categories[0]),
        JSON.stringify(Object.keys(doc.categories[0])));

    record('preamble: round-trip is byte-identical (heading position kept)',
        Storage.serializeDocument(doc) === PREAMBLE,
        JSON.stringify(Storage.serializeDocument(doc)));

    // D4 — the menu saw only the tasks below the heading.
    const rendered = Storage.renderSections(doc);
    record('D4: tasks above the heading are rendered in the menu',
        rendered.length === 1
        && JSON.stringify(rendered[0].tasks.map(task => task.text))
            === JSON.stringify(['a', 'b']),
        JSON.stringify(rendered.map(s => s.tasks.map(t => t.text))));

    // D4 — addTaskTag silently ignored any index it could not find.
    record('D4: a task above the heading accepts an inline tag',
        Storage.addTaskTag(PREAMBLE, 1, 'due', 'mon')
            === '# T\n- [ ] a @due(mon)\n## General\n- [ ] b\n',
        JSON.stringify(Storage.addTaskTag(PREAMBLE, 1, 'due', 'mon')));

    // D4 — moveTask could not see those tasks at all.
    record('D4: tasks above the heading reorder among themselves',
        Storage.moveTask('# T\n- [ ] a\n- [ ] z\n## General\n- [ ] b\n', 1, 'down')
            === '# T\n- [ ] z\n- [ ] a\n## General\n- [ ] b\n',
        JSON.stringify(Storage.moveTask(
            '# T\n- [ ] a\n- [ ] z\n## General\n- [ ] b\n', 1, 'down')));

    record('D4: first task up is still a no-op',
        Storage.moveTask(PREAMBLE, 1, 'up') === PREAMBLE, '');

    // Decision A: crossing the boundary is allowed and the boundary follows.
    const crossed = Storage.moveTask(PREAMBLE, 1, 'down');
    record('D4: moving across the heading moves the boundary with it',
        crossed === '# T\n## General\n- [ ] b\n- [ ] a\n',
        JSON.stringify(crossed));

    // Once the boundary reaches 0 the heading is emitted first and stays
    // there — moving a task back up restores the order, not the old layout.
    record('D4: crossing back restores the original task order',
        Storage.moveTask(crossed, 3, 'up') === '# T\n## General\n- [ ] a\n- [ ] b\n',
        JSON.stringify(Storage.moveTask(crossed, 3, 'up')));

    record('D4: a crossed file is stable under repeated writes',
        Storage.serializeDocument(Storage.parseDocument(crossed)) === crossed,
        JSON.stringify(crossed));

    // D2 — the '# ' line used to jump to the top of the file.
    const midTitle = '## A\n\n# T\n\n- [ ] x\n';
    const rewritten = Storage.serializeDocument(Storage.parseDocument(midTitle));
    record('D2: a title line below a heading stays inside its section',
        rewritten === '# TODO\n## A\n\n# T\n\n- [ ] x\n',
        JSON.stringify(rewritten));

    record('D2: no line of the user\'s file changes order',
        JSON.stringify(rewritten.split('\n').filter(line => line !== '# TODO'))
            === JSON.stringify(midTitle.split('\n')),
        JSON.stringify(rewritten.split('\n')));

    record('D2: a file-opening heading is still the document title',
        Storage.parseDocument('# TODO\n## A\n# T\n').title === '# TODO',
        JSON.stringify(Storage.parseDocument('# TODO\n## A\n# T\n').title));

    record('D2: addCategory no longer hoists a mid-file title',
        Storage.addCategory(midTitle, 'B')
            === '# TODO\n## A\n\n# T\n\n- [ ] x\n## B\n',
        JSON.stringify(Storage.addCategory(midTitle, 'B')));
}

// ---- moveTask: within-category reordering (Faz 2 step 6) -----------------

function testMoveTask() {
    // /goal: 5-task category — moving the 3rd task up twice brings it to #1.
    const FIVE = '# T\n## C\n- [ ] one\n- [ ] two\n- [ ] three\n- [ ] four\n- [ ] five\n';
    const once = Storage.moveTask(FIVE, 4, 'up');
    record('moveTask: 3rd task up once swaps with the 2nd',
        once === '# T\n## C\n- [ ] one\n- [ ] three\n- [ ] two\n- [ ] four\n- [ ] five\n',
        JSON.stringify(once));
    const twice = Storage.moveTask(once, 3, 'up');
    record('moveTask: up again → the 3rd task is now first',
        twice === '# T\n## C\n- [ ] three\n- [ ] one\n- [ ] two\n- [ ] four\n- [ ] five\n',
        JSON.stringify(twice));

    record('moveTask: down swaps with the next task',
        Storage.moveTask(FIVE, 2, 'down')
            === '# T\n## C\n- [ ] two\n- [ ] one\n- [ ] three\n- [ ] four\n- [ ] five\n', '');

    record('moveTask: first task up is a no-op',
        Storage.moveTask(FIVE, 2, 'up') === FIVE, '');
    record('moveTask: last task down is a no-op',
        Storage.moveTask(FIVE, 6, 'down') === FIVE, '');

    // Movement stays within the category (cross-category is impossible).
    const TWO = '# T\n## A\n- [ ] a1\n- [ ] a2\n## B\n- [ ] b1\n- [ ] b2\n';
    record('moveTask: never crosses category boundaries',
        Storage.moveTask(TWO, 3, 'down') === TWO, '');

    // Extras keep their slots; tasks swap around them.
    const EXTRA = '# T\n## C\n- [ ] a\n\nnote line\n- [ ] b\n';
    record('moveTask: tasks swap around interleaved extras',
        Storage.moveTask(EXTRA, 2, 'down') === '# T\n## C\n- [ ] b\n\nnote line\n- [ ] a\n', '');

    // Moved output is canonical: parse∘serialize round-trips byte-identical.
    record('moveTask: output round-trips byte-identical',
        Storage.serializeDocument(Storage.parseDocument(twice)) === twice, '');
}

// ---- extensibility skeleton (Faz 2 step 7: no UI yet) --------------------

function testExtensibilitySkeleton() {
    // addCategory appends an explicit (always-headed) empty category.
    record('skeleton: addCategory appends an explicit category',
        Storage.addCategory('# T\n## A\n- [ ] a\n', 'Test')
            === '# T\n## A\n- [ ] a\n## Test\n', '');

    record('skeleton: addCategory on empty content gains # TODO',
        Storage.addCategory('', 'Test') === '# TODO\n## Test\n', '');

    // No-ops: duplicates and empty names leave the content untouched.
    record('skeleton: addCategory duplicate name is a no-op',
        Storage.addCategory('# T\n## Test\n- [ ] a\n', 'Test')
            === '# T\n## Test\n- [ ] a\n', '');
    record('skeleton: addCategory empty name is a no-op',
        Storage.addCategory('# T\n', '  ') === '# T\n', '');

    // An implicit 'General' counts as existing — no second 'General' section.
    record('skeleton: implicit General counts as existing for addCategory',
        Storage.addCategory('# T\n- [ ] a\n## A\n- [ ] b\n', 'General')
            === '# T\n- [ ] a\n## A\n- [ ] b\n', '');

    // addTaskTag appends the pair and keeps raw/text in sync.
    const tagged = Storage.addTaskTag('# T\n## C\n- [ ] buy milk\n', 2, 'due', 'mon');
    record('skeleton: addTaskTag appends @due(mon) and keeps raw in sync',
        tagged === '# T\n## C\n- [ ] buy milk @due(mon)\n', JSON.stringify(tagged));
    const reparsed = Storage.parseDocument(tagged);
    const t = Storage.categoryTasks(reparsed.categories[0])[0];
    record('skeleton: added tag parses back as a structured pair',
        JSON.stringify(t.tags) === JSON.stringify([['due', 'mon']])
        && t.text === 'buy milk', JSON.stringify(t));

    // Targets the task at the given line index across categories.
    record('skeleton: addTaskTag targets the task at the given line index',
        Storage.addTaskTag('# T\n## A\n- [ ] a\n## B\n- [ ] b\n', 4, 'p', '1')
            === '# T\n## A\n- [ ] a\n## B\n- [ ] b @p(1)\n', '');

    // Invalid input is rejected (the tag could not be parsed back).
    record('skeleton: addTaskTag rejects non-\\w keys',
        Storage.addTaskTag('# T\n## C\n- [ ] a\n', 2, 'önem', '2')
            === '# T\n## C\n- [ ] a\n', '');
    record('skeleton: addTaskTag rejects ")" or newline in values',
        Storage.addTaskTag('# T\n## C\n- [ ] a\n', 2, 'due', 'mo)n')
            === '# T\n## C\n- [ ] a\n', '');
    record('skeleton: addTaskTag rejects empty values',
        Storage.addTaskTag('# T\n## C\n- [ ] a\n', 2, 'due', '')
            === '# T\n## C\n- [ ] a\n', '');
    record('skeleton: addTaskTag with unknown index is a no-op',
        Storage.addTaskTag('# T\n## C\n- [ ] a\n', 99, 'due', 'mon')
            === '# T\n## C\n- [ ] a\n', '');
}

// ---- atomic write path (Faz 2 step 3) ------------------------------------

function testAtomicWritePath() {
    // Normal writes keep working: fixed content survives a real disk write
    // and comes back complete (no partial/truncated state).
    const CONTENT = '# My TODOs\n\n## General\n- [ ] alpha @due(mon)\n\n## Notes\n- keep me\n\n- [x] beta\n';
    Storage.writeTodo(TODO, CONTENT);
    record('atomicWrite: write → read back is byte-identical (complete file)',
        Storage.readTodo(TODO).raw === CONTENT, JSON.stringify(Storage.readTodo(TODO).raw));

    // The Document pipeline connects to the real write path: mutate the model
    // → serialize → writeTodo → read back must equal the serialized string.
    // (Hand-built task object on purpose: mutation helpers arrive later.)
    const doc = Storage.parseDocument(CONTENT);
    doc.categories[0].items.push({type: 'task', raw: 'gamma', done: false, tags: [], text: 'gamma'});
    const rewritten = Storage.serializeDocument(doc);
    Storage.writeTodo(TODO, rewritten);
    record('atomicWrite: Document mutation → serialize → write → read is consistent',
        Storage.readTodo(TODO).raw === rewritten, '');

    restoreOriginal();
    record('atomicWrite: file restored to the original content after write tests',
        Storage.readTodo(TODO).raw === ORIGINAL_RAW, '');
}

// ---- explicit path support (Faz 3 step 2) --------------------------------

function testPathParams() {
    // Temp-dir round-trip: read/write honor the explicit path.
    // GLib.dir_make_tmp takes ONE argument in GJS (2-arg call warns).
    const tmpDir = GLib.dir_make_tmp('todo-test-XXXXXX');
    const tmpPath = `${tmpDir}/todo.md`;

    const CONTENT = '# T\n\n## General\n- [ ] path test\n';
    Storage.writeTodo(tmpPath, CONTENT);
    record('pathParams: write → read round-trip honors the explicit path',
        Storage.readTodo(tmpPath).raw === CONTENT, '');

    record('pathParams: todoPath() still returns the default ~/todo.md',
        Storage.todoPath() === GLib.get_home_dir() + '/todo.md', '');

    // Missing file → empty model, no throw (same contract as the default path).
    const missing = Storage.readTodo(`${tmpDir}/missing.md`);
    record('pathParams: missing file yields an empty model without throwing',
        missing.raw === '' && missing.tasks.length === 0, '');

    // Missing parent directory: write fails gracefully (caught, no crash).
    const orphan = `${tmpDir}/no/such/dir/todo.md`;
    Storage.writeTodo(orphan, '# x\n');
    const orphanRead = Storage.readTodo(orphan);
    record('pathParams: write to a missing parent dir fails gracefully',
        orphanRead.raw === '', '');

    // Loud failure guard: writeTodo without content must throw, not silently
    // encode `undefined` into an empty file (data-loss guard).
    let threw = false;
    try {
        Storage.writeTodo(tmpPath);
    } catch (e) {
        threw = true;
    }
    record('pathParams: writeTodo without content throws loudly (no data loss)',
        threw, '');

    // GJS quirk found by CI: an empty Uint8Array marshals to NULL and
    // replace_contents aborts, silently skipping the write — so empty
    // content must be rejected loudly instead.
    let emptyThrew = false;
    try {
        Storage.writeTodo(tmpPath, '');
    } catch (e) {
        emptyThrew = true;
    }
    record('pathParams: empty content write is rejected loudly (GJS NULL-Array quirk)',
        emptyThrew, '');

    // Cleanup.
    Gio.File.new_for_path(tmpPath).delete(null);
    Gio.File.new_for_path(tmpDir).delete(null);
}

// ---- resolveTodoPath (Faz 3 step 3) ---------------------------------------

function testResolveTodoPath() {
    record('resolveTodoPath: empty and whitespace values fall back to the default',
        Storage.resolveTodoPath('') === Storage.todoPath()
        && Storage.resolveTodoPath('   ') === Storage.todoPath(), '');

    record('resolveTodoPath: null input falls back to the default',
        Storage.resolveTodoPath(null) === Storage.todoPath(), '');

    record('resolveTodoPath: bare tilde expands to the home dir',
        Storage.resolveTodoPath('~') === GLib.get_home_dir(), '');

    record('resolveTodoPath: ~/ prefix expands to the home dir',
        Storage.resolveTodoPath('~/my-todo.md') === GLib.get_home_dir() + '/my-todo.md',
        '');

    record('resolveTodoPath: absolute paths pass through verbatim',
        Storage.resolveTodoPath('/home/x/notes/todo.md') === '/home/x/notes/todo.md',
        '');
}

// ---- category colors (Faz 5 step 2) --------------------------------------

function testCategoryColors() {
    const map = {'İş': '#e01b24', 'Notes': '#3584e4', 'Eski': '#ffa348'};

    record('categoryColorCss: colored category gets color: CSS',
        Storage.categoryColorCss('İş', map) === 'color: #e01b24;', '');

    record('categoryColorCss: missing map or uncolored category gets empty CSS',
        Storage.categoryColorCss('Notes', {}) === ''
        && Storage.categoryColorCss('Yok', undefined) === ''
        && Storage.categoryColorCss('Yok', null) === '', '');

    record('categoryColorCss: invalid color values are rejected (CSS injection guard)',
        Storage.categoryColorCss('İş', {'İş': 'url(evil); color: red'})
            === ''
        && Storage.categoryColorCss('İş', {'İş': 'red; background: url(x)'})
            === '', '');

    record('categoryColorHex: valid hex passes through (Faz 6.6 checkbox fill)',
        Storage.categoryColorHex('İş', map) === '#e01b24'
        && Storage.categoryColorHex('Yok', map) === null
        && Storage.categoryColorHex('İş', {'İş': 'url(evil)'}) === null
        && Storage.categoryColorHex('İş', null) === null, '');

    // Faz 8: the palette and its spoken names are index-aligned, and every
    // entry is a plain 6-digit hex (they are pasted straight into an inline
    // style, so a malformed entry would be an invisible bug).
    record('CATEGORY_PALETTE: every entry is a plain #rrggbb hex',
        Storage.CATEGORY_PALETTE.length === 8
        && Storage.CATEGORY_PALETTE.every(hex => /^#[0-9a-f]{6}$/.test(hex))
        && new Set(Storage.CATEGORY_PALETTE).size === 8, '');

    record('CATEGORY_PALETTE_NAMES: aligned with the palette, unique, non-empty',
        Storage.CATEGORY_PALETTE_NAMES.length === Storage.CATEGORY_PALETTE.length
        && Storage.CATEGORY_PALETTE_NAMES.every(n => typeof n === 'string' && n.length > 0)
        && new Set(Storage.CATEGORY_PALETTE_NAMES).size
            === Storage.CATEGORY_PALETTE_NAMES.length, '');

    // The two neutrals that read poorly as header text were replaced (user
    // decision 2026-10-10) by the modern Adwaita accents; pinned so a future
    // "cleanup" cannot quietly bring the muddy colours back.
    record('CATEGORY_PALETTE: brown/gray are gone, teal/pink took their slots',
        !Storage.CATEGORY_PALETTE.includes('#986a44')
        && !Storage.CATEGORY_PALETTE.includes('#9a9996')
        && Storage.CATEGORY_PALETTE[6] === '#2190a4'
        && Storage.CATEGORY_PALETTE[7] === '#d56199'
        && Storage.nextCategoryColor(6) === '#2190a4'
        && Storage.nextCategoryColor(7) === '#d56199', '');

    const colorBase = {A: '#111111'};
    record('setCategoryColor: sets a new entry without mutating the input',
        (() => {
            const out = Storage.setCategoryColor(colorBase, 'B', '#2190a4');
            return out.B === '#2190a4' && out.A === '#111111'
                && !('B' in colorBase);
        })(), '');

    record('setCategoryColor: replaces an existing entry',
        Storage.setCategoryColor(colorBase, 'A', '#d56199').A === '#d56199', '');

    record('setCategoryColor: an invalid hex is refused (same map back)',
        Storage.setCategoryColor(colorBase, 'A', 'url(evil)') === colorBase
        && Storage.setCategoryColor(colorBase, 'A', 'red') === colorBase
        && Storage.setCategoryColor(colorBase, 'A', '') === colorBase, '');

    record('setCategoryColor: a __proto__ key is refused (prototype write)',
        Storage.setCategoryColor(colorBase, '__proto__', '#2190a4') === colorBase, '');

    record('setCategoryColor: a missing map is treated as empty',
        JSON.stringify(Storage.setCategoryColor(null, 'A', '#2190a4'))
            === '{"A":"#2190a4"}'
        && JSON.stringify(Storage.setCategoryColor(undefined, 'A', '#2190a4'))
            === '{"A":"#2190a4"}', '');

    record('pruneCategoryColors: dead keys are removed',
        JSON.stringify(Storage.pruneCategoryColors(map, ['İş', 'Notes']))
            === JSON.stringify({'İş': '#e01b24', 'Notes': '#3584e4'}), '');

    record('pruneCategoryColors: unchanged map returns the same object',
        Storage.pruneCategoryColors(map, ['İş', 'Notes', 'Eski']) === map, '');

    record('pruneCategoryColors: empty map stays empty',
        JSON.stringify(Storage.pruneCategoryColors({}, ['A'])) === '{}', '');

    // --- Audit D1: an empty file must not wipe the category color map -------
    // The menu renders the implicit 'General' header for an empty document,
    // but the prune used to run against the raw doc.categories ([]), so every
    // color was dropped and written back through set_value — permanent loss.
    const emptyDoc = Storage.parseDocument('');
    const emptySections = Storage.renderSections(emptyDoc);
    const populatedDoc = Storage.parseDocument('# TODO\n## İş\n- [ ] x\n## Notes\n');
    record('renderSections: empty document renders the implicit General section',
        emptySections.length === 1
        && emptySections[0].name === Storage.FALLBACK_CATEGORY
        && emptySections[0].tasks.length === 0,
        JSON.stringify(emptySections.map(s => s.name)));

    record('renderSections: keeps document order and per-category tasks',
        JSON.stringify(Storage.renderSections(populatedDoc).map(s => s.name))
            === JSON.stringify(['İş', 'Notes'])
        && Storage.renderSections(populatedDoc)[0].tasks.length === 1
        && Storage.renderSections(populatedDoc)[1].tasks.length === 0, '');

    record('pruneCategoryColors: the pure function still drops dead keys',
        JSON.stringify(Storage.pruneCategoryColors(
            {'İş': '#e01b24', 'Silinmiş': '#3584e4'},
            Storage.renderSections(populatedDoc).map(s => s.name)))
            === JSON.stringify({'İş': '#e01b24'}),
        'named for what it proves: the PRUNER works. When it may run at all is '
        + 'prunedColorsForDocument()\'s decision — see the N1 cases below. The '
        + 'old "D1 regression" case here was tautological: it keyed the colour '
        + 'under General, the one key the sentinel protects.');

    // --- Audit N1 (2026-10-02): the acceptance criterion D1 never met ------
    // The handoff recorded it as "an empty file + a populated colour map → the
    // map survives a refresh". The 2026-10-01 fix did NOT satisfy it: a file
    // with no '##' heading renders the single implicit 'General' section, so
    // every real category looked dead and the whole map was dropped (measured:
    // 6 colours → 0). The test above could not see it because its fixture
    // keyed the colour under 'General' — the one key the fix protected.
    //
    // These cases use a POPULATED map with no key named 'General' at all, which
    // is the state the user is actually in.
    const USER_COLORS = {Cyber: '#3584e4', Python: '#33d17a', Todo: '#f6d32d'};
    const HEADING_LESS = ['', 'just a note\n', '- [ ] a task with no heading\n'];
    const wiped = HEADING_LESS.filter(raw => {
        const kept = Storage.prunedColorsForDocument(
            USER_COLORS, Storage.parseDocument(raw));
        return Object.keys(kept).length !== Object.keys(USER_COLORS).length;
    });
    record('N1: a file that lost every ## heading keeps the whole colour map',
        wiped.length === 0,
        wiped.length
            ? 'map shrunk for raw=' + JSON.stringify(wiped) + ' — the categories '
              + 'have COLLAPSED, they have not changed; pruning here deletes '
              + 'the colours permanently through set_value'
            : JSON.stringify(USER_COLORS));

    record('N1: the same map survives an unreadable file (no prune at all)',
        Storage.prunedColorsForDocument(USER_COLORS, Storage.parseDocument(''))
            === USER_COLORS,
        'identity return lets the caller skip the settings write entirely');

    record('N1: pruning resumes as soon as one ## heading is left',
        JSON.stringify(Storage.prunedColorsForDocument(
            {'İş': '#e01b24', 'Silinmiş': '#3584e4'}, populatedDoc))
            === JSON.stringify({'İş': '#e01b24'}),
        'the guard must not disable dead-key pruning in the normal case');

    record('N1: an explicit ## General counts as a heading',
        JSON.stringify(Object.keys(
            Storage.prunedColorsForDocument(
                {General: '#e01b24', 'Silinmiş': '#3584e4'},
                Storage.parseDocument('- [ ] a\n## General\n- [ ] b\n'))))
            === JSON.stringify(['General']),
        'parseDocument marks the taken-over bucket implicit:false, so it prunes');

    record('writeTodo: a failed write reports false so the caller can react',
        Storage.writeTodo(TODO + '/no/such/dir/todo.md', 'x') === false
        && Storage.writeTodo(TODO, '- [ ] probe\n') === true,
        'audit N4: writeTodo used to swallow the failure and return nothing, so '
        + 'the UI closed the inline entry and refreshed from the unchanged file '
        + '- whatever the user had typed vanished with no message');

    record('writeTodo: empty content still throws loudly (never a false return)',
        (() => { try {
            Storage.writeTodo(TODO, '');
            return false;
        } catch (e) {
            return true;
        } })(),
        'the empty-write guard is a programming error, not an I/O failure, so '
        + 'it must not be downgraded to a false return');

    record('rgbToHex: 8-bit RGB values become #rrggbb',
        Storage.rgbToHex(224, 27, 36) === '#e01b24'
        && Storage.rgbToHex(0, 0, 0) === '#000000'
        && Storage.rgbToHex(255, 255, 255) === '#ffffff', '');

    record('nextCategoryColor: palette order cycles after the last entry',
        Storage.nextCategoryColor(0) === Storage.CATEGORY_PALETTE[0]
        && Storage.nextCategoryColor(7) === Storage.CATEGORY_PALETTE[7]
        && Storage.nextCategoryColor(8) === Storage.CATEGORY_PALETTE[0]
        && Storage.nextCategoryColor(9) === Storage.CATEGORY_PALETTE[1]
        && Storage.nextCategoryColor(10) === Storage.CATEGORY_PALETTE[2], '');
}

// ---- runner --------------------------------------------------------------

snapshotOriginal();
testSplitLines();
testReadTodo();
testToggleTask();
testDeleteTask();
testEditTask();
testAddTask();
testAddTaskCategorized();
testMoveTask();
testExtensibilitySkeleton();
testWriteRead();
restoreOriginal();
testParseDocument();
testSerializeDocument();
testCategoryNameHygiene();
testCategoryDeleteRename();
testPreambleFidelity();
testAtomicWritePath();
testPathParams();
testResolveTodoPath();
testCategoryColors();
testStaticChecks();

// Final integrity check against the pre-test snapshot.
const finalRead = Storage.readTodo(TODO);
record('teardown: the temporary test file is back to its pre-test state',
    finalRead.raw === ORIGINAL_RAW, '');
record('teardown: the suite writes to a temp file, never to ~/todo.md',
    TODO !== USER_TODO,
    'writing fixtures to the real file fires the running extension\'s '
    + 'monitor; its refresh then pruned the whole category-colors map');
record('teardown: ~/todo.md is untouched by the test suite',
    Storage.readTodo(USER_TODO).raw === USER_RAW_AT_START,
    'the file must survive the suite byte-for-byte');

// ---- output --------------------------------------------------------------
let pass = 0, fail = 0;
for (const r of results) {
    if (r.ok) pass++; else fail++;
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\nSUMMARY: ${pass} passed, ${fail} failed (out of ${results.length})`);
console.log(`RESULT_OK=${fail === 0}`);