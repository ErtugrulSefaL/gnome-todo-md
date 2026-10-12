import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

/*
 * Storage layer: reads and writes the todo markdown file, keeping every
 * non-checkbox line exactly as it was.
 *
 *   Task:     { index, text, done }   // index = 0-based line in the file
 *   Document: { title, categories: [{ name, items }] }
 *
 * `items` is an ordered list — the interleaving of notes and blank lines is
 * preserved for the byte-identical round-trip. Entries are either
 *   { type: 'task', raw, done, tags, text, index }   // tags: [[key, value], ...]
 *   { type: 'extra', raw }                           // non-task line, verbatim
 * Use categoryTasks(category) for the flat task list. A category created by the
 * parser fallback carries `implicit: true`; serializeDocument() writes its
 * heading only when it holds tasks, so an unchanged file round-trips.
 */

const TODO_PATH = GLib.get_home_dir() + '/todo.md';

/**
 * Absolute path of the todo file.
 */
export function todoPath() {
    return TODO_PATH;
}

/**
 * Resolve a user-configured todo file path: an empty or whitespace value
 * falls back to the default, a leading '~' is expanded to the home directory,
 * anything else is used verbatim.
 *
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
 * Inline CSS that colours a category header text, or '' when the category has
 * no colour. The value comes from user preferences, so it is validated
 * against a strict hex pattern before it reaches an inline style.
 *
 */
export function categoryColorCss(name, colors) {
    const color = colors ? colors[name] : null;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
        return '';
    }
    return `color: ${color};`;
}

/**
 * Validated hex colour of a category, or null when it has none. The done
 * checkbox is filled with it.
 */
export function categoryColorHex(name, colors) {
    const color = colors ? colors[name] : null;
    return typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)
        ? color
        : null;
}

/**
 * 8-bit RGB values to a '#rrggbb' string (used by prefs when a Gdk.RGBA
 * changes).
 *
 */
export function rgbToHex(r, g, b) {
    const hex = value => value.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

/**
 * Palette shared by the prefs quick palette, the in-menu colour picker and
 * the automatic colour of a newly created category.
 *
 * Brown (#986a44) and gray (#9a9996) were dropped: they read poorly as header
 * text on the menu background. The teal and pink accents of the modern
 * Adwaita palette replace them.
 *
 * Order matters — nextCategoryColor() walks the list. Existing colours live in
 * the settings map as hex strings and are never migrated.
 */
export const CATEGORY_PALETTE = [
    '#3584e4', // blue
    '#33d17a', // green
    '#e01b24', // red
    '#f6d32d', // yellow
    '#c061cb', // purple
    '#ff7800', // orange
    '#2190a4', // teal (replaced brown)
    '#d56199', // pink (replaced gray)
];

/**
 * Spoken names for the palette entries, index-aligned with CATEGORY_PALETTE.
 * They are the accessible names of the in-menu swatches; a test pins the
 * alignment.
 */
export const CATEGORY_PALETTE_NAMES = [
    'blue', 'green', 'red', 'yellow', 'purple', 'orange', 'teal', 'pink',
];

/**
 * Palette colour for a newly created category: assigned in order, wrapping
 * around after the last entry.
 *
 */
export function nextCategoryColor(existingCategoryCount) {
    return CATEGORY_PALETTE[
        ((existingCategoryCount % CATEGORY_PALETTE.length) + CATEGORY_PALETTE.length)
            % CATEGORY_PALETTE.length];
}

/**
 * Drop colour entries for categories that no longer exist, so a later
 * category reusing a name cannot inherit the old colour. Pure.
 *
 */
export function pruneCategoryColors(colors, validNames) {
    const keys = Object.keys(colors || {});
    if (keys.every(key => validNames.includes(key))) {
        return colors;
    }
    const pruned = {};
    for (const key of keys) {
        if (validNames.includes(key)) {
            pruned[key] = colors[key];
        }
    }
    return pruned;
}

/**
 * Move a stored colour from one category name to another (the rename flow
 * rewrites the file first, then the map). Pure: the input map is never
 * mutated.
 *
 * No-op when `fromName` has no entry or the names are identical. An existing
 * `toName` entry is overwritten — the rename flow only runs this after the
 * category layer accepted the rename, so such an entry is a stale leftover.
 *
 * `__proto__` is refused as well: `map['__proto__'] = ...` is a prototype
 * write in JS, so the entry would vanish silently, and GSettings could not
 * carry such a key anyway.
 *
 */
export function moveCategoryColor(colors, fromName, toName) {
    if (!colors
        || !Object.prototype.hasOwnProperty.call(colors, fromName)
        || fromName === toName
        || toName === '__proto__') {
        return colors;
    }
    const moved = {};
    for (const key of Object.keys(colors)) {
        if (key !== fromName) {
            moved[key] = colors[key];
        }
    }
    moved[toName] = colors[fromName];
    return moved;
}

/**
 * Drop the stored colour of ONE category (the delete flow). Pure: the input
 * map is never mutated, and it is returned unchanged when it has no entry for
 * `name`.
 *
 * The delete flow does this explicitly instead of leaving it to the refresh
 * prune: pruning keeps the whole map when the file loses its LAST heading
 * ("the headings may come back"), which is right for a file that lost them by
 * accident but wrong here — a later category reusing the name would inherit
 * the old colour.
 *
 */
export function removeCategoryColor(colors, name) {
    if (!colors || !Object.prototype.hasOwnProperty.call(colors, name)) {
        return colors;
    }
    const kept = {};
    for (const key of Object.keys(colors)) {
        if (key !== name) {
            kept[key] = colors[key];
        }
    }
    return kept;
}

/**
 * Set (or replace) the stored colour of ONE category, returning a NEW map.
 * Pure: the input map is never mutated.
 *
 * The input is returned unchanged for an invalid hex colour (the palette is
 * ours, but this is a public function) and for a `__proto__` name, which would
 * be a prototype write and which GSettings cannot hold anyway.
 *
 */
export function setCategoryColor(colors, name, hex) {
    if (name === '__proto__' || !/^#[0-9a-fA-F]{3,8}$/.test(hex)) {
        return colors;
    }
    const next = {};
    for (const key of Object.keys(colors || {})) {
        next[key] = colors[key];
    }
    next[name] = hex;
    return next;
}

/**
 * Split the content into lines, detecting checkbox tasks. Every other line
 * (heading, note, blank) is kept verbatim in `other`.
 *
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
 * Name of the implicit category for lines that appear before the first '##'
 * heading. Always serialized as a real '## General' heading.
 */
export const FALLBACK_CATEGORY = 'General';

/**
 * Free-form `@key(value)` tags of a raw task text, as an ordered
 * [key, value] pair list. There is no whitelist: every match is kept and
 * unknown keys are written back verbatim.
 *
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
 * Display text of a task: tags removed, whitespace collapsed, trimmed. Only
 * for display and editing — `raw` stays the authoritative form for the
 * byte-identical round-trip.
 *
 */
const deriveText = raw =>
    raw.replace(/@(\w+)\(([^)]+)\)/g, '').replace(/\s+/g, ' ').trim();

/**
 * Build a task item from raw text and checkbox state.
 *
 */
const makeTaskItem = (raw, done) => ({
    type: 'task',
    raw,
    done,
    tags: extractTags(raw),
    text: deriveText(raw),
});

/**
 * Parse raw markdown content into the Document model.
 *
 * - The first '# ' line is the document title; the raw line is kept for the
 *   round-trip. Any further '# ' line is an extra.
 * - Every '##' heading starts a category ('###' or deeper is not one).
 * - Checkbox lines become task items carrying their 0-based line index
 *   (`index`) for the line-based helpers. Tags are free-form and kept as an
 *   ordered pair list.
 * - Everything else (notes, blank lines, plain list items) is an extra kept
 *   verbatim, in original order.
 * - Lines before the first '##' land in the FALLBACK_CATEGORY ('General').
 *
 */
export function parseDocument(content) {
    // Line endings belong to the file: every mutating helper rewrites the
    // whole document, so a CRLF file would silently become LF otherwise.
    const doc = {
        title: null,
        categories: [],
        eol: content.includes('\r\n') ? '\r\n' : '\n',
    };
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
                // An explicit '## General' takes over the fallback bucket, so
                // the model never holds two 'General' categories. Everything
                // parsed so far came BEFORE the heading: record that boundary
                // as `preCount`, and keep all items in ONE list — a separate
                // list for them was invisible to the flat task helpers.
                current.implicit = false;
                current.preCount = current.items.length;
            } else {
                current = {name, items: [], implicit: false};
                doc.categories.push(current);
            }
            continue;
        }

        // Only a '# ' line that OPENS the file is the title; one further down
        // belongs to the section it sits in, so it cannot jump to the top of
        // the file on the next write.
        if (/^#\s.*$/.test(line)) {
            if (doc.title === null && current === null) {
                doc.title = line;
            } else {
                ensureCategory().items.push({type: 'extra', raw: line});
            }
            continue;
        }

        // Checkbox task line; it carries its 0-based line index.
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

    // A fallback category that only ever collected blank lines is layout, not
    // content: a blank line between the title and the first heading would
    // otherwise render as an implicit 'General' section that can be neither
    // renamed nor deleted. The lines are kept as `preamble`, emitted directly
    // after the title, so the file still round-trips byte-identically.
    const first = doc.categories[0];
    if (first !== undefined && first.implicit
        && first.items.length > 0
        && first.items.every(item => item.type === 'extra' && item.raw.trim() === '')) {
        doc.preamble = first.items;
        doc.categories.shift();
    }

    return doc;
}

/**
 * Flat task view of a category — the `tasks` the UI and the mutations work on.
 *
 */
export function categoryTasks(category) {
    return category.items.filter(item => item.type === 'task');
}

/**
 * The category list the menu renders, and the single source of truth for
 * "which categories exist right now": both the rows and the colour pruning go
 * through it. `doc.categories` is `[]` for an empty file, so deriving the list
 * from it made an empty file look category-less and the prune then wrote the
 * whole colour map away. Do not re-derive it elsewhere.
 *
 */
export function renderSections(doc) {
    const sections = doc.categories.map(category => ({
        name: category.name,
        tasks: categoryTasks(category),
    }));
    if (sections.length === 0) {
        sections.push({name: FALLBACK_CATEGORY, tasks: []});
    }
    return sections;
}

/**
 * The colour map as it should be STORED after reading `doc`. The decision
 * lives here, not in the UI, so it is unit-testable.
 *
 * 1. Pruning runs against `renderSections(doc)` — the same list the menu rows
 *    come from, never the raw `doc.categories` (which is `[]` for an empty
 *    file).
 * 2. A document with no '##' heading has LOST its category list rather than
 *    changed it: the headings may come back, so pruning would write the
 *    colours away for good. With at least one heading left, genuinely deleted
 *    categories are pruned as usual.
 *
 */
export function prunedColorsForDocument(colors, doc) {
    const hasHeading = doc.categories.some(category => !category.implicit);
    if (!hasHeading) {
        return colors;
    }
    return pruneCategoryColors(colors, renderSections(doc).map(s => s.name));
}

/**
 * Serialize a Document model back to markdown content.
 *
 * - Task lines are rebuilt from `raw` verbatim (raw is authoritative: it keeps
 *   the original tag positions and spacing). Mutations that change text or
 *   tags keep `raw` in sync.
 * - An implicit 'General' category (parser fallback, no heading seen) gets its
 *   '## General' heading written only when it holds at least one task;
 *   extras-only implicit content stays headingless, so an unchanged file
 *   round-trips byte-identically. Explicit categories always get a heading.
 * - When an explicit '## General' heading took over the fallback bucket, the
 *   first `preCount` items are emitted verbatim before it, mirroring the
 *   original layout. One list, one boundary.
 * - A missing document title gains a '# TODO' line.
 * - Line endings are preserved: the file is written back with the ending it
 *   was read with.
 * - Deliberate normalizations (see README.md): '[X]' → '[x]', '##Name' →
 *   '## Name', the canonical '- [ ] ' task prefix, and exactly one trailing
 *   newline.
 *
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

    // Blank lines that sat between the title and the first heading — held
    // outside the category list by parseDocument — belong directly under the
    // title, which is where the parser took them from.
    pushItems(doc.preamble ?? []);

    for (const category of doc.categories) {
        // `preCount` leading items belong before the heading (see
        // parseDocument); everything after it belongs below. The heading is
        // written unless the category is implicit and holds no task.
        const preCount = category.preCount ?? 0;
        const withHeading = category.preCount !== undefined
            || !category.implicit
            || categoryTasks(category).length > 0;
        if (withHeading && preCount === 0) {
            lines.push(`## ${category.name}`);
        }
        pushItems(category.items.slice(0, preCount));
        if (withHeading && preCount > 0) {
            lines.push(`## ${category.name}`);
        }
        pushItems(category.items.slice(preCount));
    }

    const eol = doc.eol ?? '\n';
    return lines.join(eol) + eol;
}

/**
 * Read and parse the todo file at `path`.
 *
 */
export function readTodo(path = TODO_PATH) {
    const file = Gio.File.new_for_path(path);

    let content;
    try {
        const [, bytes] = file.load_contents(null);
        // Decode the bytes with TextDecoder; Uint8Array.toString() is
        // deprecated and mangles empty contents.
        if (bytes) {
            content = new TextDecoder().decode(bytes);
        } else {
            content = '';
        }
    } catch (err) {
        // A missing or unreadable file is not an error for rendering, but the
        // caller must be able to tell "the file is empty" from "we could not
        // read it": a failed read is transient (an editor's atomic save, a
        // rename window), and treating it as "no categories" wipes the colour
        // map for good.
        return {tasks: [], other: [], raw: '', ok: false};
    }

    const {tasks, other} = splitLines(content);
    return {tasks, other, raw: content, ok: true};
}

/**
 * Toggle the checkbox state of the line at `index`. Lines that are not
 * checkboxes are left untouched.
 *
 */
export function toggleTask(content, index) {
    const lines = content.split('\n');
    const line = lines[index];
    if (line === undefined) {
        return content;
    }

    // A CRLF file keeps a trailing '\r' on every line, and `.` in a JS regex
    // does not match it: match without the CR, then put it back.
    const cr = line.endsWith('\r') ? '\r' : '';
    const match = (cr ? line.slice(0, -1) : line)
        .match(/^(\s*-\s+\[)([ xX])(\]\s+.*)$/);
    if (!match) {
        return content;
    }

    const newMark = match[2].toLowerCase() === 'x' ? ' ' : 'x';
    lines[index] = match[1] + newMark + match[3] + cr;
    return lines.join('\n');
}

/**
 * Replace the text of the task line at `index`, keeping its checkbox state.
 * Non-checkbox lines are replaced verbatim.
 *
 */
export function editTask(content, index, text) {
    const lines = content.split('\n');
    if (index < 0 || index >= lines.length) {
        return content;
    }

    // See toggleTask: the CR comes off before matching, or a CRLF file falls
    // into the plain-text branch below and loses its checkbox.
    const raw = lines[index];
    const cr = raw.endsWith('\r') ? '\r' : '';
    const match = (cr ? raw.slice(0, -1) : raw)
        .match(/^(\s*-\s+\[[ xX]\]\s+).*$/);
    if (match) {
        lines[index] = match[1] + text + cr;
    } else {
        // Not a checkbox line: replace with plain text (keeps it a line).
        lines[index] = text + cr;
    }

    return lines.join('\n');
}

/**
 * Delete the line at `index`.
 *
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
 * Append a new incomplete task to `categoryName` (default "General"), after
 * the category's last task so trailing blank/note lines stay at the end of the
 * block. A missing category is created at the end of the document: 'General'
 * as implicit, anything else as an explicit category.
 *
 */
export function addTask(content, text, categoryName = FALLBACK_CATEGORY) {
    const doc = parseDocument(content);
    let target = doc.categories.find(category => category.name === categoryName);
    if (!target) {
        target = categoryName === FALLBACK_CATEGORY
            ? {name: FALLBACK_CATEGORY, items: [], implicit: true}
            : {name: categoryName, items: [], implicit: false};
        doc.categories.push(target);
    }

    // Insert after the last task item (or at the very end when the category
    // holds only extras so far).
    let insertAt = target.items.length;
    for (let i = target.items.length - 1; i >= 0; i--) {
        if (target.items[i].type === 'task') {
            insertAt = i + 1;
            break;
        }
    }
    target.items.splice(insertAt, 0, makeTaskItem(text, false));

    return serializeDocument(doc);
}


/**
 * Move the task at line `fromIndex` into the slot of the task at line
 * `toIndex`. Both are 0-based line indices, the same ones toggleTask /
 * editTask / deleteTask use.
 *
 * - The moved task ends up where the target task was, in the category's task
 *   sequence; interleaved extras (blank/note lines) keep their slots.
 * - A move never crosses a category boundary: when the two indices belong to
 *   different categories, or either one is not a task, the content is returned
 *   unchanged.
 * - A move across the `## General` heading boundary keeps `preCount` in step
 *   (it counts the items written before the heading), so the round-trip stays
 *   byte-identical.
 *
 */
export function moveTaskTo(content, fromIndex, toIndex) {
    const doc = parseDocument(content);
    for (const category of doc.categories) {
        const tasks = categoryTasks(category);
        const fromPos = tasks.findIndex(task => task.index === fromIndex);
        const toPos = tasks.findIndex(task => task.index === toIndex);
        if (fromPos === -1 || toPos === -1 || fromPos === toPos) {
            continue;
        }

        const items = category.items;
        const moving = tasks[fromPos];
        const target = tasks[toPos];
        const ia = items.indexOf(moving);

        // Land the item next to the target in the array WITHOUT the moving
        // item: after the target when moving down, before it when moving up.
        // Either way the task sequence ends up with the moved task at `toPos`.
        items.splice(ia, 1);
        const targetAt = items.indexOf(target);
        const insertAt = fromPos < toPos ? targetAt + 1 : targetAt;
        items.splice(insertAt, 0, moving);

        // preCount counts the items emitted BEFORE the heading. Work out the
        // boundary position in the array that no longer holds the moving item,
        // then re-derive preCount from whether the item landed above it.
        if (category.preCount !== undefined) {
            const wasPre = ia < category.preCount;
            const boundary = category.preCount - (wasPre ? 1 : 0);
            const isPre = insertAt < boundary;
            if (wasPre && !isPre) {
                category.preCount -= 1;
            } else if (!wasPre && isPre) {
                category.preCount += 1;
            }
            if (category.preCount >= items.length) {
                category.preCount = 0;
            }
        }
        return serializeDocument(doc);
    }
    return content;
}

/**
 * A category name is written as `## <name>`, so it has to survive a re-read as
 * a heading: no line breaks, which would escape the heading, and no leading
 * '#', which would nest one. Such names are rejected rather than rewritten —
 * quietly storing a different name would hide what the user typed.
 *
 */
export function isUsableCategoryName(name) {
    return name.length > 0 && !/[\r\n]/.test(name) && !name.startsWith('#');
}

/**
 * Append a new empty, explicit category at the end of the document. Called by
 * the in-menu "+" flow, which assigns the palette colour and switches to the
 * new tab.
 *
 * No-op when the name is unusable (see isUsableCategoryName) or a category of
 * that name already exists — an implicit 'General' counts as existing, so
 * there can never be two.
 *
 */
export function addCategory(content, name) {
    const trimmed = name.trim();
    if (!isUsableCategoryName(trimmed)) {
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
 * Delete a category with everything in it: heading, tasks and extras. The
 * two-step confirmation lives in the UI, not here.
 *
 * No-op when no category of that name exists or the category is the implicit
 * 'General' bucket, which has no heading of its own to delete. When the
 * explicit '## General' carries the preamble from before the first heading
 * (see parseDocument), deleting it removes that preamble too.
 *
 */
export function deleteCategory(content, name) {
    const doc = parseDocument(content);
    const idx = doc.categories.findIndex(category => category.name === name);
    if (idx === -1 || doc.categories[idx].implicit) {
        return content;
    }
    doc.categories.splice(idx, 1);
    return serializeDocument(doc);
}

/**
 * Rename a category by rewriting its `## <name>` heading in place; the tasks
 * and extras under it are untouched.
 *
 * No-op when the new name is unusable, no category of `oldName` exists, the
 * category is the implicit 'General' bucket, the names are equal, or another
 * category already uses the new name (an implicit 'General' counts as
 * existing). Rejections return the content byte-identically.
 *
 * A category that carries the preamble from before the first heading (the
 * explicit '## General' takeover, see parseDocument) is renamed with its
 * items: they move below the new heading, because the takeover relationship
 * cannot survive a different name — leaving them above would orphan them into
 * a fresh implicit 'General' bucket on the next read.
 *
 */
export function renameCategory(content, oldName, newName) {
    const trimmed = newName.trim();
    if (!isUsableCategoryName(trimmed)) {
        return content;
    }
    const doc = parseDocument(content);
    const category = doc.categories.find(item => item.name === oldName);
    if (!category || category.implicit) {
        return content;
    }
    if (trimmed === oldName) {
        return content;
    }
    if (doc.categories.some(item => item !== category && item.name === trimmed)) {
        return content;
    }
    category.name = trimmed;
    // A category that carried the preamble from before the first heading (the
    // explicit '## General' takeover, see parseDocument) keeps its items, but
    // they must now sit BELOW the renamed heading: the takeover relationship
    // is gone, and leaving them above would orphan them into a fresh implicit
    // 'General' bucket on the next read.
    delete category.preCount;
    return serializeDocument(doc);
}

/**
 * Append an `@key(value)` tag to the task at line `index`. No UI calls this
 * yet; the behaviour is pinned by tests. `raw` is kept in sync, since it is
 * the authoritative serialized form.
 *
 * No-op when no task owns the index, `key` does not match /^\w+$/ (such a tag
 * could not be parsed back), or `value` is empty or contains ')' or a newline.
 *
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
 */
export function writeTodo(path, content) {
    // Reject `undefined` loudly instead of encoding it into an empty file, and
    // reject empty content too: GJS marshals an empty Uint8Array to NULL and
    // g_file_replace_contents then aborts on 'contents != NULL' — a silent
    // no-op. An empty todo file is not a valid state; delete the file instead.
    if (content === undefined || content === '') {
        throw new Error('todo: writeTodo requires a non-empty content string');
    }

    const file = Gio.File.new_for_path(path);
    // replace_contents expects a Uint8Array (guint8[]), which TextEncoder yields.
    const bytes = new TextEncoder().encode(content);
    try {
        file.replace_contents(bytes, null, false, Gio.FileCreateFlags.NONE, null);
        return true;
    } catch (e) {
        // Surface failures (disk full, permissions) without crashing the
        // extension: the next refresh keeps showing the on-disk content, and
        // the false return lets the caller keep the user's input.
        console.error(`todo: failed to write ${path}: ${e}`);
        return false;
    }
}