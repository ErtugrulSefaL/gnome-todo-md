/*
 * Phase 1 unit + integration tests for the todo extension.
 * Runs against the real storage.js module.
 *
 * SAFETY: the suite snapshots ~/todo.md once at start (ORIGINAL_RAW) and
 * restores it with the tested Storage.writeTodo() API after every write
 * test and again on teardown. This guarantees the user's file is intact
 * regardless of whether individual tests pass or fail.
 *
 * Each function is exercised individually; results print as:
 *   [PASS] <name> — detail
 *   [FAIL] <name> — detail
 *
 * Usage:  gjs -m tests/run_tests.mjs
 */

import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

import * as Storage from '../gnome-todo-md@ertugrulsefal.github.com/storage.js';

const TODO = GLib.get_home_dir() + '/todo.md';

const results = []; // {name, ok, detail}
let ORIGINAL_RAW = '';

function record(name, ok, detail) {
    results.push({name, ok, detail: detail || ''});
}

// Snapshot original content once.
function snapshotOriginal() {
    ORIGINAL_RAW = Storage.readTodo().raw;
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
    const p = Storage.readTodo();
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
    // Faz 2 semantics: every UI-added task lands in 'Genel' (real heading).
    const base = '- [ ] a\n- [x] b\n';
    record('addTask: tasks before any ## form implicit Genel and gain the heading',
        Storage.addTask(base, 'c') === '# TODO\n## Genel\n- [ ] a\n- [x] b\n- [ ] c\n',
        JSON.stringify(Storage.addTask(base, 'c')));

    record('addTask: empty file starts clean under # TODO + ## Genel',
        Storage.addTask('', 'first') === '# TODO\n## Genel\n- [ ] first\n',
        JSON.stringify(Storage.addTask('', 'first')));

    record('addTask: missing trailing newline is normalized',
        Storage.addTask('- [ ] a', 'b') === '# TODO\n## Genel\n- [ ] a\n- [ ] b\n',
        JSON.stringify(Storage.addTask('- [ ] a', 'b')));
}

// ---- addTask: Genel fallback (Faz 2 step 4) -------------------------------

function testAddTaskCategorized() {
    // File with categories but no Genel: 'Genel' appended at the end.
    record('addTaskCategorized: no Genel in file → ## Genel appended at the end',
        Storage.addTask('# T\n## İş\n- [ ] a\n', 'orphan')
            === '# T\n## İş\n- [ ] a\n## Genel\n- [ ] orphan\n',
        JSON.stringify(Storage.addTask('# T\n## İş\n- [ ] a\n', 'orphan')));

    // Implicit Genel with trailing blank/notes: inserted after the LAST task,
    // keeping trailing extras at the end of the block.
    record('addTaskCategorized: inserted after last task, trailing extras stay at end',
        Storage.addTask('# T\n- [ ] a\n\n- [ ] b\n\n## Notes\n- [ ] x\n', 'new')
            === '# T\n## Genel\n- [ ] a\n\n- [ ] b\n- [ ] new\n\n## Notes\n- [ ] x\n',
        JSON.stringify(Storage.addTask('# T\n- [ ] a\n\n- [ ] b\n\n## Notes\n- [ ] x\n', 'new')));

    // Existing explicit Genel: appended to its task list.
    record('addTaskCategorized: appended to existing explicit ## Genel',
        Storage.addTask('# T\n## Genel\n- [ ] a\n\n## B\n- [ ] b\n', 'new')
            === '# T\n## Genel\n- [ ] a\n- [ ] new\n\n## B\n- [ ] b\n',
        JSON.stringify(Storage.addTask('# T\n## Genel\n- [ ] a\n\n## B\n- [ ] b\n', 'new')));

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
        Storage.addTask('# T\n## Genel\n- [ ] a\n\n## B\n- [ ] b\n', 'new'),
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

    record('addTaskCategorized: missing Genel stays implicit (fallback rule)',
        Storage.addTask('# T\n## A\n- [ ] a\n', 'x', 'Genel')
            === '# T\n## A\n- [ ] a\n## Genel\n- [ ] x\n', '');
}

// ---- writeTodo / round-trip ---------------------------------------------

function testWriteRead() {
    Storage.writeTodo(TODO, '- [ ] persisted\n');
    const p = Storage.readTodo();
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

function noMatch(name, content, forbiddenPattern, incident) {
    const m = content.match(forbiddenPattern);
    record(name, m === null, m === null ? incident : `found: "${m[0]}" — ${incident}`);
}

function testStaticChecks() {
    const ui = readFileText('gnome-todo-md@ertugrulsefal.github.com/extension.js');
    const prefs = readFileText('gnome-todo-md@ertugrulsefal.github.com/prefs.js');
    const store = readFileText('gnome-todo-md@ertugrulsefal.github.com/storage.js');
    const meta = readFileText('gnome-todo-md@ertugrulsefal.github.com/metadata.json');
    const css = readFileText('gnome-todo-md@ertugrulsefal.github.com/stylesheet.css');
    const all = ui + '\n' + prefs + '\n' + store;

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

    // Project rules that must not drift.
    record('static: metadata shell-version is exactly ["46"]',
        /"shell-version"\s*:\s*\[\s*"46"\s*\]/.test(meta), 'do not claim untested versions');
    noMatch('static: no opacity in CSS (actor label.opacity is used instead)',
        css, /opacity\s*:/, 'CSS opacity is unreliable on St.Label; use actor opacity');

    // Faz 3: the UI layer resolves the file path via _todoPath() (GSettings
    // aware); no direct default-path calls are allowed there.
    noMatch('static: extension.js does not call Storage.todoPath() directly',
        ui, /Storage\.todoPath\(/, 'use this._todoPath() so the configured path is honored');

    // Faz 3: settings infrastructure must be complete — getSettings() falls
    // back to metadata["settings-schema"] and loads schemas/ from the ext dir.
    record('static: metadata declares the settings-schema id',
        /"settings-schema"\s*:\s*"org\.gnome\.shell\.extensions\.gnome-todo-md"/.test(meta),
        'ExtensionBase.getSettings() reads metadata["settings-schema"]');
    record('static: compiled GSettings schema is committed (schemas/gschemas.compiled)',
        readFileText('gnome-todo-md@ertugrulsefal.github.com/schemas/gschemas.compiled') !== '',
        'getSettings() loads the schemas/ dir from the extension directory');

    // Faz 4: single-interaction invariant — every edit-state reset pairs the
    // two fields, and opening an edit closes the add entry (the exact bug
    // fixed in 0ab4e16: _startEditing missed the _addingCategory reset).
    record('static: every _editingIndex = -1 reset pairs _addingCategory',
        !/this\._editingIndex = -1;\n(?![ ]*this\._addingCategory)/.test(ui),
        'reset both fields together (single-interaction rule)');
    record('static: opening an edit closes the add entry (_startEditing)',
        /_editingIndex = index;\n\s*this\._addingCategory = null;/.test(ui),
        'an edit replaces any open category add entry');
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

    record('parseDocument: categories in file order (Genel first)',
        doc.categories.length === 3
        && doc.categories[0].name === 'Genel'
        && doc.categories[1].name === 'Notes'
        && doc.categories[2].name === 'İş',
        JSON.stringify(doc.categories.map(c => c.name)));

    const genel = doc.categories[0];
    record('parseDocument: task before first ## falls into Genel (fallback)',
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
    record('parseDocument: file without H1 → title null, Genel fallback works',
        noTitle.title === null && noTitle.categories.length === 2
        && noTitle.categories[0].name === 'Genel',
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
        '## Genel',
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
    // Genel holding only extras) must not gain a '## Genel' heading.
    const REAL_LIKE = '# My TODOs\n\n\n## Notes\n- keep me\n\n- [x] done\n';
    record('serializeDocument: extras-only implicit Genel stays headingless',
        Storage.serializeDocument(Storage.parseDocument(REAL_LIKE)) === REAL_LIKE, '');

    // Locked rule: tasks in an implicit Genel gain a real '## Genel' heading.
    record('serializeDocument: implicit Genel with tasks gains ## Genel heading',
        Storage.serializeDocument(Storage.parseDocument('# T\n- [ ] a\n## B\n- [ ] b\n'))
            === '# T\n## Genel\n- [ ] a\n## B\n- [ ] b\n', '');

    // An explicit '## Genel' takes over the implicit fallback bucket, keeping
    // byte order: pre-heading items stay before the heading.
    const merged = Storage.parseDocument('# T\n- [ ] a\n## Genel\n- [ ] b\n');
    record('serializeDocument: implicit+explicit Genel merge keeps line order',
        merged.categories.length === 1
        && Storage.serializeDocument(merged) === '# T\n- [ ] a\n## Genel\n- [ ] b\n',
        JSON.stringify(merged.categories));

    // Locked rule: missing H1 gains '# TODO'.
    record('serializeDocument: missing H1 gains # TODO',
        Storage.serializeDocument(Storage.parseDocument('- [ ] a\n')) === '# TODO\n## Genel\n- [ ] a\n', '');

    record('serializeDocument: empty document → only # TODO',
        Storage.serializeDocument(Storage.parseDocument('')) === '# TODO\n', '');

    // Locked rule: [X] normalized to [x] on write.
    record('serializeDocument: [X] normalized to [x]',
        Storage.serializeDocument(Storage.parseDocument('- [X] a\n')) === '# TODO\n## Genel\n- [x] a\n', '');

    // Heading and task-prefix normalizations + trailing newline.
    record('serializeDocument: headings, prefixes, trailing newline normalized',
        Storage.serializeDocument(Storage.parseDocument('##Notes\n-  [ ] a'))
            === '# TODO\n## Notes\n- [ ] a\n', '');

    // Interleaved inline tags survive verbatim (raw is authoritative).
    const INTERLEAVED = '# T\n## Genel\n- [ ] buy @due(x) milk\n';
    record('serializeDocument: interleaved inline tags preserved verbatim',
        Storage.serializeDocument(Storage.parseDocument(INTERLEAVED)) === INTERLEAVED, '');

    // serialize ∘ parse is idempotent.
    const once = Storage.serializeDocument(Storage.parseDocument(CANONICAL));
    record('serializeDocument: idempotent (serialize∘parse applied twice is stable)',
        Storage.serializeDocument(Storage.parseDocument(once)) === once, '');
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

    // An implicit 'Genel' counts as existing — no second 'Genel' section.
    record('skeleton: implicit Genel counts as existing for addCategory',
        Storage.addCategory('# T\n- [ ] a\n## A\n- [ ] b\n', 'Genel')
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
    const CONTENT = '# My TODOs\n\n## Genel\n- [ ] alpha @due(mon)\n\n## Notes\n- keep me\n\n- [x] beta\n';
    Storage.writeTodo(TODO, CONTENT);
    record('atomicWrite: write → read back is byte-identical (complete file)',
        Storage.readTodo().raw === CONTENT, JSON.stringify(Storage.readTodo().raw));

    // The Document pipeline connects to the real write path: mutate the model
    // → serialize → writeTodo → read back must equal the serialized string.
    // (Hand-built task object on purpose: mutation helpers arrive later.)
    const doc = Storage.parseDocument(CONTENT);
    doc.categories[0].items.push({type: 'task', raw: 'gamma', done: false, tags: [], text: 'gamma'});
    const rewritten = Storage.serializeDocument(doc);
    Storage.writeTodo(TODO, rewritten);
    record('atomicWrite: Document mutation → serialize → write → read is consistent',
        Storage.readTodo().raw === rewritten, '');

    restoreOriginal();
    record('atomicWrite: file restored to the original content after write tests',
        Storage.readTodo().raw === ORIGINAL_RAW, '');
}

// ---- explicit path support (Faz 3 step 2) --------------------------------

function testPathParams() {
    // Temp-dir round-trip: read/write honor the explicit path.
    // GLib.dir_make_tmp takes ONE argument in GJS (2-arg call warns).
    const tmpDir = GLib.dir_make_tmp('todo-test-XXXXXX');
    const tmpPath = `${tmpDir}/todo.md`;

    const CONTENT = '# T\n\n## Genel\n- [ ] path test\n';
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
testAtomicWritePath();
testPathParams();
testResolveTodoPath();
testStaticChecks();

// Final integrity check against the pre-test snapshot.
const finalRead = Storage.readTodo();
record('teardown: ~/todo.md byte-identical to pre-test content',
    finalRead.raw === ORIGINAL_RAW, '');

// ---- output --------------------------------------------------------------
let pass = 0, fail = 0;
for (const r of results) {
    if (r.ok) pass++; else fail++;
    console.log(`[${r.ok ? 'PASS' : 'FAIL'}] ${r.name}${r.detail ? ' — ' + r.detail : ''}`);
}
console.log(`\nSUMMARY: ${pass} passed, ${fail} failed (out of ${results.length})`);
console.log(`RESULT_OK=${fail === 0}`);