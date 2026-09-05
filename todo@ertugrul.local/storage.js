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
 * @returns {{tasks: Array<Object>, other: Array<{index, line}>}} Parsed content.
 *          Returns an empty file model if the file is missing or unreadable.
 */
export function readTodo() {
    const file = Gio.File.new_for_path(TODO_PATH);

    let content;
    try {
        const [, bytes] = file.load_contents(null);
        content = bytes ? bytes.toString() : '';
    } catch (err) {
        // Missing/unreadable file is not an error: yield an empty list.
        content = '';
    }

    return splitLines(content);
}