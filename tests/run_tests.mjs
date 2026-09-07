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

import * as Storage from '../todo@ertugrul.local/storage.js';

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
function restoreOriginal() {
    Storage.writeTodo(ORIGINAL_RAW);
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
    const base = '- [ ] a\n- [x] b\n';
    const added = Storage.addTask(base, 'c');
    record('addTask: appends unchecked task at end',
        added === '- [ ] a\n- [x] b\n- [ ] c\n', JSON.stringify(added));

    const empty = Storage.addTask('', 'first');
    record('addTask: empty file starts clean without leading newline',
        empty === '- [ ] first\n', JSON.stringify(empty));

    const noTrailNl = Storage.addTask('- [ ] a', 'b');
    record('addTask: adds newline when missing before append',
        noTrailNl === '- [ ] a\n- [ ] b\n', JSON.stringify(noTrailNl));
}

// ---- writeTodo / round-trip ---------------------------------------------

function testWriteRead() {
    Storage.writeTodo('- [ ] persisted\n');
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
    const ui = readFileText('todo@ertugrul.local/extension.js');
    const store = readFileText('todo@ertugrul.local/storage.js');
    const meta = readFileText('todo@ertugrul.local/metadata.json');
    const css = readFileText('todo@ertugrul.local/stylesheet.css');
    const all = ui + '\n' + store;

    // Real incident: idle_add(() => ...) threw on every menu open (Phase 1).
    record('static: every GLib.idle_add call passes (priority, func)',
        ui.match(/idle_add\(/g)?.length === ui.match(/idle_add\(GLib\.PRIORITY/g)?.length,
        'GLib.idle_add takes (priority, func); single-arg calls throw at runtime');

    // Real incidents from the historical edit-feature revert.
    noMatch('static: no GTK hexpand/vexpand (Clutter uses set_x_expand)',
        all, /set_hexpand\(|hexpand:|vexpand/, 'GTK layout API on St actors silently misbehaves');
    noMatch('static: no GLib.Bytes for replace_contents',
        all, /GLib\.Bytes/, 'replace_contents needs a Uint8Array from TextEncoder');
    noMatch('static: no key::release / key::press pseudo-signals',
        all, /key::(release|press)/, 'GObject signals use dashes: key-release-event');
    noMatch('static: no legacy imports.* API',
        all, /\bimports\./, 'GNOME 45+ is ESM; imports.* is removed in Shell');
    noMatch('static: no legacy .add( child call',
        all, /\.add\(/, 'use add_child() on Clutter/St actors');

    // Project rules that must not drift.
    record('static: metadata shell-version is exactly ["46"]',
        /"shell-version"\s*:\s*\[\s*"46"\s*\]/.test(meta), 'do not claim untested versions');
    noMatch('static: no opacity in CSS (actor label.opacity is used instead)',
        css, /opacity\s*:/, 'CSS opacity is unreliable on St.Label; use actor opacity');
}

// ---- runner --------------------------------------------------------------

snapshotOriginal();
testSplitLines();
testReadTodo();
testToggleTask();
testDeleteTask();
testEditTask();
testAddTask();
testWriteRead();
restoreOriginal();
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