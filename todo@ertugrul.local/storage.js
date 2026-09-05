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
    file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
}