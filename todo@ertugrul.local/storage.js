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
 *     { type: 'task',  raw, done, tags, text }   (tags: [[key, value], ...])
 *     { type: 'extra', raw }                     (non-task line, verbatim)
 *   Use categoryTasks(category) for the flat task-list view.
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
 * Parse raw markdown content into the Faz 2 Document model.
 *
 * Rules (locked, see plan.md):
 * - The first '# ' line is the document title; its content is ignored but the
 *   raw line is kept for round-trip. Any further '# ' line is an extra.
 * - Every '##' heading starts a category ('###' or deeper is NOT a category).
 * - Checkbox lines '- [ ]/- [x]/- [X] text @tag(value)' become task items.
 *   Tags are free-form (no whitelist) and kept as an ordered pair list.
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
            current = {name: FALLBACK_CATEGORY, items: []};
            doc.categories.push(current);
        }
        return current;
    };

    const lines = content.split('\n');
    if (lines.length > 0 && lines[lines.length - 1] === '') {
        lines.pop();
    }

    for (const rawLine of lines) {
        const line = rawLine.replace(/\r$/, '');

        // '##' category heading ('###' or deeper is not a category).
        const h2 = line.match(/^##(?!#)\s?(.*)$/);
        if (h2) {
            current = {name: h2[1].trim(), items: []};
            doc.categories.push(current);
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

        // Checkbox task line — same shape splitLines() accepts.
        const taskMatch = line.match(/^\s*-\s+\[([ xX])\]\s+(.*)$/);
        if (taskMatch) {
            const raw = taskMatch[2];
            const tagRe = /@(\w+)\(([^)]+)\)/g;
            const tags = [];
            let m;
            while ((m = tagRe.exec(raw)) !== null) {
                tags.push([m[1], m[2]]);
            }
            // Derived display text: tags removed, whitespace collapsed, trimmed.
            // `raw` stays verbatim for byte-identical round-trip.
            const text = raw.replace(tagRe, '').replace(/\s+/g, ' ').trim();
            ensureCategory().items.push({
                type: 'task',
                raw,
                done: taskMatch[1].toLowerCase() === 'x',
                tags,
                text,
            });
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
 * Read and parse ~/todo.md.
 *
 * @returns {{tasks: Array<Object>, other: Array<{index, line}>, raw: string}}
 *          Parsed content plus the raw file text. Returns an empty file model
 *          if the file is missing or unreadable.
 */
export function readTodo() {
    const file = Gio.File.new_for_path(TODO_PATH);

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
 * Append a new incomplete task to the end of the file.
 *
 * @param {string} content - Raw file content.
 * @param {string} text - Task text (may contain any characters).
 * @returns {string} Updated content.
 */
export function addTask(content, text) {
    // Keep the file clean when empty so the first task starts on line 0.
    const trimmed = (content === '' || content.endsWith('\n'))
        ? content
        : content + '\n';
    return trimmed + `- [ ] ${text}\n`;
}

/**
 * Write content back to ~/todo.md.
 *
 * @param {string} content - Full file content to write.
 */
export function writeTodo(content) {
    const file = Gio.File.new_for_path(TODO_PATH);
    // replace_contents expects a Uint8Array (guint8[]), which TextEncoder yields.
    const bytes = new TextEncoder().encode(content);
    try {
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
    } catch (e) {
        // Surface failures (disk full, permissions) without crashing the
        // extension; the next refresh keeps showing the on-disk content, so
        // the UI stays consistent with the file.
        console.error(`todo: failed to write ${TODO_PATH}: ${e}`);
    }
}