import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/*
 * Storage layer for the todo extension.
 * Reads ~/todo.md, preserving non-checkbox lines (titles, notes) exactly,
 * and exposes only checkbox lines as tasks.
 *
 * Task model:
 *   { index: number,   // 0-based line index in the file
 *     text:  string,   // task text without the checkbox marker
 *     done:  boolean } // true for '- [x]', false for '- [ ]'
 *
 * Faz 2 Document model (parseDocument) — categorized file format:
 *   Document { title: string|null,          // raw first '# ' line (round-trip)
 *              categories: [{ name: string, // trimmed '##' heading text
 *                             items: Array }] }
 *   `items` is an ORDERED list (preserves interleaving of notes/blank lines,
 *   required for byte-identical round-trip) whose entries are either
 *     { type: 'task',  raw, done, tags, text, index }  (tags: [[key, value], ...])
 *     { type: 'extra', raw }                     (non-task line, verbatim)
 *   Use categoryTasks(category) for the flat task-list view.
 *   Categories carry `implicit: true` when created by the fallback (no '##'
 *   heading seen yet); serializeDocument() writes their heading only when
 *   they contain tasks (locked rule), so unchanged files round-trip
 *   byte-identical.
 */

const TODO_PATH = GLib.get_home_dir() + '/todo.md';

/**
 * Absolute path of the todo file.
 * @returns {string}
 */
export function todoPath() {
    return TODO_PATH;
}

/**
 * Resolve a user-configured todo file path (Faz 3).
 *
 * Pure path resolution: an empty/whitespace value falls back to the default
 * ~/todo.md, a leading '~' is expanded to the home directory, and anything
 * else is used verbatim (expected to be an absolute path).
 *
 * @param {string|null} configured - Raw value of the todo-file-path setting.
 * @returns {string} Absolute file path to use.
 */
export function resolveTodoPath(configured) {
    const trimmed = configured ? configured.trim() : '';
    if (!trimmed) {
        return TODO_PATH;
    }
    if (trimmed === '~') {
        return GLib.get_home_dir();
    }
    if (trimmed.startsWith('~/')) {
        return GLib.get_home_dir() + trimmed.slice(1);
    }
    return trimmed;
}

/**
 * Split the file content into lines, detecting checkbox tasks.
 * Non-checkbox lines (headings, notes, blank) are kept verbatim in `other`.
 *
 * @param {string} content - Raw file content.
 * @returns {{tasks: Array<Object>, other: Array<{index: number, line: string}>}}
 */
export function splitLines(content) {
    const tasks = [];
    const other = [];

    // Keep a trailing newline so blank lines survive round-trip.
    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    for (let i = 0; i < lines.length; i++) {
        // Normalize a possible CRLF line ending to bare LF.
        const line = lines[i].replace(/\r$/, '');
        const match = line.match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
        if (match) {
            tasks.push({
                index: i,
                text: match[2],
                done: match[1].toLowerCase() === 'x',
            });
        } else {
            other.push({index: i, line});
        }
    }

    return {tasks, other};
}

/**
 * Name of the implicit category for tasks/lines that appear before the first
 * '##' heading. Always serialized as a real '## Genel' heading.
 */
const FALLBACK_CATEGORY = 'Genel';

/**
 * Extract free-form `@key(value)` tags from raw task text as an ordered
 * [key, value] pair list. Locked rule: no whitelist — every match is kept,
 * unknown keys are preserved and written back verbatim.
 *
 * @param {string} raw - Raw task text (tags still inline).
 * @returns {Array<[string, string]>} Ordered tag pairs.
 */
const extractTags = raw => {
    const tagRe = /@(\w+)\(([^)]+)\)/g;
    const tags = [];
    let m;
    while ((m = tagRe.exec(raw)) !== null) {
        tags.push([m[1], m[2]]);
    }
    return tags;
};

/**
 * Derived display text of a task: tags removed, whitespace collapsed,
 * trimmed. Only used for display/editing; `raw` stays the authoritative
 * verbatim form for byte-identical round-trip.
 *
 * @param {string} raw - Raw task text (tags still inline).
 * @returns {string} Text without tags.
 */
const deriveText = raw =>
    raw.replace(/@(\w+)\(([^)]+)\)/g, '').replace(/\s+/g, ' ').trim();

/**
 * Build a task item from raw text and checkbox state.
 *
 * @param {string} raw - Raw task text after the checkbox (tags inline).
 * @param {boolean} done - Checkbox state.
 * @returns {{type: 'task', raw: string, done: boolean, tags: Array, text: string}}
 */
const makeTaskItem = (raw, done) => ({
    type: 'task',
    raw,
    done,
    tags: extractTags(raw),
    text: deriveText(raw),
});

/**
 * Parse raw markdown content into the Faz 2 Document model.
 *
 * Rules (locked, see plan.md):
 * - The first '# ' line is the document title; its content is ignored but the
 *   raw line is kept for round-trip. Any further '# ' line is an extra.
 * - Every '##' heading starts a category ('###' or deeper is NOT a category).
 * - Checkbox lines '- [ ]/- [x]/- [X] text @tag(value)' become task items
 *   carrying their 0-based line index (`index`) for the line-based mutation
 *   helpers. Tags are free-form (no whitelist) and kept as an ordered pair list.
 * - Everything else (notes, blank lines, plain list items) is an extra kept
 *   verbatim, in original order.
 * - Lines before the first '##' land in the FALLBACK_CATEGORY ('Genel').
 *
 * @param {string} content - Raw file content.
 * @returns {{title: string|null, categories: Array<{name: string, items: Array}>}}
 */
export function parseDocument(content) {
    const doc = {title: null, categories: []};
    let current = null;

    const ensureCategory = () => {
        if (current === null) {
            current = {name: FALLBACK_CATEGORY, items: [], implicit: true};
            doc.categories.push(current);
        }
        return current;
    };

    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    for (let i = 0; i < lines.length; i++) {
        const line = lines[i].replace(/\r$/, '');

        // '##' category heading ('###' or deeper is not a category).
        const h2 = line.match(/^##(?!#)\s?(.*)$/);
        if (h2) {
            const name = h2[1].trim();
            if (name === FALLBACK_CATEGORY && current !== null && current.implicit) {
                // An explicit '## Genel' takes over the fallback bucket so the
                // model never holds two 'Genel' categories. Items parsed so far
                // appeared BEFORE the heading in the file — kept in `preItems`
                // and re-emitted headingless before it (round-trip fidelity).
                current.implicit = false;
                current.preItems = current.items;
                current.items = [];
            } else {
                current = {name, items: [], implicit: false};
                doc.categories.push(current);
            }
            continue;
        }

        // '# ' document title (first one only; later ones are extras).
        if (/^#\s.*$/.test(line)) {
            if (doc.title === null) {
                doc.title = line;
            } else {
                ensureCategory().items.push({type: 'extra', raw: line});
            }
            continue;
        }

        // Checkbox task line — same shape splitLines() accepts. The item
        // carries its 0-based line index for the line-based mutation helpers.
        const taskMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
            const item = makeTaskItem(taskMatch[2], taskMatch[1].toLowerCase() === 'x');
            item.index = i;
            ensureCategory().items.push(item);
            continue;
        }

        // Any other line (note, blank, plain list item) — keep verbatim.
        ensureCategory().items.push({type: 'extra', raw: line});
    }

    return doc;
}

/**
 * Flat task view of a category (the `tasks` the UI and mutations work on).
 *
 * @param {{name: string, items: Array}} category
 * @returns {Array<{type: 'task', raw: string, done: boolean, tags: Array, text: string}>}
 */
export function categoryTasks(category) {
    return category.items.filter(item => item.type === 'task');
}

/**
 * Serialize a Document model back to markdown content.
 *
 * Round-trip rules (locked, see plan.md):
 * - Task lines are rebuilt from `raw` verbatim (raw is authoritative; it
 *   keeps the original tag positions/spacing). Mutations that change text or
 *   tags are responsible for keeping `raw` in sync.
 * - An implicit 'Genel' category (parser fallback, no heading seen) gets its
 *   '## Genel' heading written ONLY when it contains at least one task;
 *   extras-only implicit content stays headingless so unchanged files
 *   round-trip byte-identical. Explicit categories always get a heading.
 * - When an explicit '## Genel' heading takes over the fallback bucket, items
 *   parsed before the heading (`preItems`) are re-emitted verbatim BEFORE it,
 *   mirroring the original file layout.
 * - A missing document title gains a '# TODO' line.
 * - Deliberate normalizations (locked decisions): '[X]' → '[x]',
 *   '##Name' → '## Name', canonical '- [ ] ' task prefix, and exactly one
 *   trailing newline.
 *
 * @param {{title: string|null, categories: Array}} doc - Document model.
 * @returns {string} Markdown content.
 */
export function serializeDocument(doc) {
    const lines = [];

    lines.push(doc.title !== null ? doc.title : '# TODO');

    const pushItems = items => {
        for (const item of items) {
            lines.push(item.type === 'task'
                ? `- [${item.done ? 'x' : ' '}] ${item.raw}`
                : item.raw);
        }
    };

    for (const category of doc.categories) {
        if (category.preItems !== undefined) {
            pushItems(category.preItems);
            lines.push(`## ${category.name}`);
        } else if (!category.implicit || categoryTasks(category).length > 0) {
            lines.push(`## ${category.name}`);
        }
        pushItems(category.items);
    }

    return lines.join('\n') + '\n';
}

/**
 * Read and parse the todo file at `path`.
 *
 * @param {string} [path] - Absolute file path; defaults to todoPath()
 *                          (~/todo.md).
 * @returns {{tasks: Array<Object>, other: Array<{index, line}>, raw: string}}
 *          Parsed content plus the raw file text. Returns an empty file model
 *          if the file is missing or unreadable.
 */
export function readTodo(path = TODO_PATH) {
    const file = Gio.File.new_for_path(path);

    let content;
    try {
        const [, bytes] = file.load_contents(null);
        // Decode bytes explicitly (TextDecoder) to avoid the deprecated
        // Uint8Array.toString() behavior on empty/edge contents.
        if (bytes) {
            content = new TextDecoder().decode(bytes);
        } else {
            content = '';
        }
    } catch (err) {
        // Missing/unreadable file is not an error: yield an empty list.
        content = '';
    }

    const {tasks, other} = splitLines(content);
    return {tasks, other, raw: content};
}

/**
 * Toggle the checkbox state of the line at `index`.
 * Lines that are not checkboxes are left untouched.
 *
 * @param {string} content - Raw file content.
 * @param {number} index - 0-based line index.
 * @returns {string} Updated content.
 */
export function toggleTask(content, index) {
    const lines = content.split('\n');
    const line = lines[index];
    if (line === undefined) {
        return content;
    }

    const match = line.match(/^(\s*-\s+\[)([ xX])(\]\s+.*)$/);
    if (!match) {
        return content;
    }

    const newMark = match[2].toLowerCase() === 'x' ? ' ' : 'x';
    lines[index] = match[1] + newMark + match[3];
    return lines.join('\n');
}

/**
 * Replace the text of the task line at `index`, keeping its checkbox state.
 * Non-checkbox lines are replaced verbatim (kept as their own line text).
 *
 * @param {string} content - Raw file content.
 * @param {number} index - 0-based line index.
 * @param {string} text - New task text (checkbox marker is not included).
 * @returns {string} Updated content.
 */
export function editTask(content, index, text) {
    const lines = content.split('\n');
    if (index < 0 || index >= lines.length) {
        return content;
    }

    const match = lines[index].match(/^(\s*-\s+\[[ xX]\]\s+).*$/);
    if (match) {
        lines[index] = match[1] + text;
    } else {
        // Not a checkbox line: replace with plain text (keeps it a line).
        lines[index] = text;
    }

    return lines.join('\n');
}

/**
 * Delete the line at `index`.
 *
 * @param {string} content - Raw file content.
 * @param {number} index - 0-based line index.
 * @returns {string} Updated content.
 */
export function deleteTask(content, index) {
    const lines = content.split('\n');
    if (index < 0 || index >= lines.length) {
        return content;
    }

    lines.splice(index, 1);
    return lines.join('\n');
}

/**
 * Append a new incomplete task to the "Genel" category. Locked rule: tasks
 * added without a category UI always land there, under a real '## Genel'
 * heading in the file. Inserted after the last existing task of the category
 * so trailing blank/note lines stay at the end of the block. Since Faz 2 this
 * is Document-based (parse → mutate → serialize); string-in/string-out.
 *
 * @param {string} content - Raw file content.
 * @param {string} text - Task text (may contain @tag(value) pairs).
 * @returns {string} Updated content.
 */
export function addTask(content, text) {
    const doc = parseDocument(content);
    let genel = doc.categories.find(category => category.name === FALLBACK_CATEGORY);
    if (!genel) {
        genel = {name: FALLBACK_CATEGORY, items: [], implicit: true};
        doc.categories.push(genel);
    }

    // Insert after the last task item (or at the very end when the category
    // holds only extras so far).
    let insertAt = genel.items.length;
    for (let i = genel.items.length - 1; i >= 0; i--) {
        if (genel.items[i].type === 'task') {
            insertAt = i + 1;
            break;
        }
    }
    genel.items.splice(insertAt, 0, makeTaskItem(text, false));

    return serializeDocument(doc);
}

/**
 * Move the task at line `index` up or down within its own category (locked:
 * no cross-category moves). The two adjacent tasks in the category's task
 * sequence swap positions; interleaved extras (blank/note lines) keep their
 * slots. Moving the first task up or the last task down is a no-op, and so
 * is an index that no task owns.
 *
 * Note: tasks living in a merged '## Genel' preItems block (parsed before an
 * explicit '## Genel' heading) are not movable in this phase — moveTask only
 * operates on a category's main item list.
 *
 * @param {string} content - Raw file content.
 * @param {number} index - 0-based line index of the task to move.
 * @param {string} direction - 'up' or 'down'.
 * @returns {string} Updated content (unchanged when the move is impossible).
 */
export function moveTask(content, index, direction) {
    const doc = parseDocument(content);
    for (const category of doc.categories) {
        const tasks = categoryTasks(category);
        const pos = tasks.findIndex(task => task.index === index);
        if (pos === -1) {
            continue;
        }

        const other = direction === 'up' ? pos - 1 : pos + 1;
        if (other < 0 || other >= tasks.length) {
            return content;
        }

        // Swap the two task items in place; extras between them stay put.
        const items = category.items;
        const ia = items.indexOf(tasks[pos]);
        const ib = items.indexOf(tasks[other]);
        items[ia] = tasks[other];
        items[ib] = tasks[pos];
        return serializeDocument(doc);
    }
    return content;
}

/**
 * Append a new empty, explicit category at the end of the document (Faz 2
 * extensibility skeleton — no UI calls this yet; a future "+" button only
 * needs to wire this in).
 *
 * No-op when the name is empty/whitespace or a category of that name already
 * exists (case-sensitive file semantics; an implicit 'Genel' counts as
 * existing, so no second 'Genel' section can ever be created).
 *
 * @param {string} content - Raw file content.
 * @param {string} name - Category name (trimmed before use).
 * @returns {string} Updated content (unchanged when the call is a no-op).
 */
export function addCategory(content, name) {
    const trimmed = name.trim();
    if (!trimmed) {
        return content;
    }
    const doc = parseDocument(content);
    if (doc.categories.some(category => category.name === trimmed)) {
        return content;
    }
    doc.categories.push({name: trimmed, items: [], implicit: false});
    return serializeDocument(doc);
}

/**
 * Append an `@key(value)` tag to the task at line `index` (Faz 2
 * extensibility skeleton — no UI calls this yet; a future "add tag" form
 * only needs to wire this in). The ordered tags list gains the new pair and
 * `raw` is kept in sync (raw is the authoritative serialized form).
 *
 * No-op when: no task owns the index, `key` does not match /^\w+$/ (such a
 * tag could not be parsed back), or `value` is empty / contains ')' or a
 * newline (it would break the `@key(value)` pattern).
 *
 * @param {string} content - Raw file content.
 * @param {number} index - 0-based line index of the task.
 * @param {string} key - Tag key (must match /^\w+$/).
 * @param {string} value - Tag value (no ')' or newlines).
 * @returns {string} Updated content (unchanged when the call is a no-op).
 */
export function addTaskTag(content, index, key, value) {
    if (!/^\w+$/.test(key) || value.length === 0 || /[)\n\r]/.test(value)) {
        return content;
    }
    const doc = parseDocument(content);
    for (const category of doc.categories) {
        const task = categoryTasks(category).find(item => item.index === index);
        if (!task) {
            continue;
        }
        task.tags.push([key, value]);
        task.raw = `${task.raw} @${key}(${value})`;
        task.text = deriveText(task.raw);
        return serializeDocument(doc);
    }
    return content;
}

/**
 * Write content back to the todo file at `path`.
 *
 * @param {string} path - Absolute file path to write to.
 * @param {string} content - Full file content to write.
 */
export function writeTodo(path, content) {
    // Loud failure instead of silently encoding `undefined` into an empty
    // file (data-loss guard for a wrong call site).
    if (content === undefined) {
        throw new Error('todo: writeTodo requires (path, content)');
    }

    const file = Gio.File.new_for_path(path);
    // replace_contents expects a Uint8Array (guint8[]), which TextEncoder yields.
    const bytes = new TextEncoder().encode(content);
    try {
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        // Surface failures (disk full, permissions) without crashing the
        // extension; the next refresh keeps showing the on-disk content, so
        // the UI stays consistent with the file.
        console.error(`todo: failed to write ${path}: ${e}`);
    }
}