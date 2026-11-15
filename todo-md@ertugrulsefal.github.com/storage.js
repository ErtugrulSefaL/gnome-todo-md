import GLib from 'gi://GLib';
import Gio from 'gi://Gio';

// Storage layer: markdown todo file. Task: {index, text, done}; Document: {title, categories: [{name, items}]}. `items` preserves order for byte-identical round-trip; implicit categories carry `implicit: true`.

// Todo Path
const TODO_PATH = GLib.get_home_dir() + '/todo.md';

export function todoPath() {
    return TODO_PATH;
}

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

// Category Color
export function categoryColorCss(name, colors) {
    const color = colors ? colors[name] : null;
    if (typeof color !== 'string' || !/^#[0-9a-fA-F]{3,8}$/.test(color)) {
        return '';
    }
    return `color: ${color};`;
}

export function categoryColorHex(name, colors) {
    const color = colors ? colors[name] : null;
    return typeof color === 'string' && /^#[0-9a-fA-F]{3,8}$/.test(color)
        ? color
        : null;
}

export function rgbToHex(r, g, b) {
    const hex = value => value.toString(16).padStart(2, '0');
    return `#${hex(r)}${hex(g)}${hex(b)}`;
}

export const CATEGORY_PALETTE = [
    '#3584e4', // blue
    '#33d17a', // green
    '#e01b24', // red
    '#f6d32d', // yellow
    '#c061cb', // purple
    '#ff7800', // orange
    '#2190a4', // teal
    '#d56199', // pink
];

export const CATEGORY_PALETTE_NAMES = [
    'blue', 'green', 'red', 'yellow', 'purple', 'orange', 'teal', 'pink',
];

export function nextCategoryColor(existingCategoryCount) {
    return CATEGORY_PALETTE[
        ((existingCategoryCount % CATEGORY_PALETTE.length) + CATEGORY_PALETTE.length)
            % CATEGORY_PALETTE.length];
}

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

// Content Operations
// Split content into lines, detecting checkbox tasks; every other line is kept verbatim in `other`.
export function splitLines(content) {
    const tasks = [];
    const other = [];

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

// Name of the implicit category for lines before the first '##' heading.
export const FALLBACK_CATEGORY = 'General';

// Free-form `@key(value)` tags of a raw task text, as an ordered [key, value] list
const extractTags = raw => {
    const tagRe = /@(\w+)\(([^)]+)\)/g;
    const tags = [];
    let m;
    while ((m = tagRe.exec(raw)) !== null) {
        tags.push([m[1], m[2]]);
    }
    return tags;
};

const deriveText = raw =>
    raw.replace(/@(\w+)\(([^)]+)\)/g, '').replace(/\s+/g, ' ').trim();

// Build a task item from raw text and checkbox state.
const makeTaskItem = (raw, done) => ({
    type: 'task',
    raw,
    done,
    tags: extractTags(raw),
    text: deriveText(raw),
});

/*
Parse markdown into a Document. First '#' line is the title; '##' starts a category;
checkbox lines are tasks carrying their 0-based `index`; everything else is an extra kept
verbatim; lines before the first '##' go to FALLBACK_CATEGORY.
*/
export function parseDocument(content) {
    // Line endings belong to the file; a CRLF file would otherwise become LF.
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

        const h2 = line.match(/^##(?!#)\s?(.*)$/);
        if (h2) {
            const name = h2[1].trim();
            if (name === FALLBACK_CATEGORY && current !== null && current.implicit) {
                // An explicit '## General' takes over the fallback bucket; `preCount` records the boundary.
                current.implicit = false;
                current.preCount = current.items.length;
            } else {
                current = {name, items: [], implicit: false};
                doc.categories.push(current);
            }
            continue;
        }

        // Only a '# ' line that opens the file is the title; a later one belongs to its section.
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

        ensureCategory().items.push({type: 'extra', raw: line});
    }

    // A fallback category holding only blank lines is layout: keep it as `preamble`, emitted right after the title.
    const first = doc.categories[0];
    if (first !== undefined && first.implicit
        && first.items.length > 0
        && first.items.every(item => item.type === 'extra' && item.raw.trim() === '')) {
        doc.preamble = first.items;
        doc.categories.shift();
    }
    return doc;
}

// Flat task view of a category.
export function categoryTasks(category) {
    return category.items.filter(item => item.type === 'task');
}

// The category list the menu renders, and the single source of truth for "which categories
// exist". A category-less document gets a synthesized 'General' entry.
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

// Whether the document names no category at all. Deliberately not asked of renderSections():
// pruning must keep seeing the fallback.
export function hasNoCategories(doc) {
    return doc.categories.length === 0;
}

// The colour map as it should be stored after reading `doc`.
export function prunedColorsForDocument(colors, doc) {
    const hasHeading = doc.categories.some(category => !category.implicit);
    if (!hasHeading) {
        return colors;
    }
    return pruneCategoryColors(colors, renderSections(doc).map(s => s.name));
}
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

    // `preamble` lines are emitted directly under the title, where the parser took them from.
    pushItems(doc.preamble ?? []);

    for (const category of doc.categories) {
        // `preCount` items go before the heading; the heading is written unless the category is implicit and holds no task.
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

export function readTodoAsync(path, callback) {
    const file = Gio.File.new_for_path(path);
    file.load_contents_async(null, (source, result) => {
        let content;
        try {
            const [, bytes] = source.load_contents_finish(result);
            // Uint8Array.toString() is deprecated and mangles empty contents; use TextDecoder.
            content = bytes ? new TextDecoder().decode(bytes) : '';
        } catch (err) {
            callback({tasks: [], other: [], raw: '', ok: false});
            return;
        }
        callback(parseTodo(content));
    });
}

// Parse already-read content into the `{tasks, other, raw, ok}` shape.
export function parseTodo(content, ok = true) {
    const {tasks, other} = splitLines(content);
    return {tasks, other, raw: content, ok};
}

// Task operations
export function toggleTask(content, index) {
    const lines = content.split('\n');
    const line = lines[index];
    if (line === undefined) {
        return content;
    }

    // A CRLF line keeps a trailing '\r'; match without it, then put it back.
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

export function editTask(content, index, text) {
    const lines = content.split('\n');
    if (index < 0 || index >= lines.length) {
        return content;
    }

    // CR stripped before matching, or a CRLF file loses its checkbox.
    const raw = lines[index];
    const cr = raw.endsWith('\r') ? '\r' : '';
    const match = (cr ? raw.slice(0, -1) : raw)
        .match(/^(\s*-\s+\[[ xX]\]\s+).*$/);
    if (match) {
        lines[index] = match[1] + text + cr;
    } else {
        lines[index] = text + cr;
    }

    return lines.join('\n');
}

export function deleteTask(content, index) {
    const lines = content.split('\n');
    if (index < 0 || index >= lines.length) {
        return content;
    }

    lines.splice(index, 1);
    return lines.join('\n');
}

export function addTask(content, text, categoryName = FALLBACK_CATEGORY) {
    const doc = parseDocument(content);
    let target = doc.categories.find(category => category.name === categoryName);
    if (!target) {
        target = categoryName === FALLBACK_CATEGORY
            ? {name: FALLBACK_CATEGORY, items: [], implicit: true}
            : {name: categoryName, items: [], implicit: false};
        doc.categories.push(target);
    }

    // Insert after the last task item, or at the end when the category holds only extras.
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

        // Re-insert after the target when moving down, before it when moving up.
        items.splice(ia, 1);
        const targetAt = items.indexOf(target);
        const insertAt = fromPos < toPos ? targetAt + 1 : targetAt;
        items.splice(insertAt, 0, moving);

        // Re-derive `preCount` from where the item landed relative to the boundary.
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

// Category Operations
const _hasContentAboveHeading = category =>
    category.items.slice(0, category.preCount ?? 0)
        .some(item => item.type !== 'extra' || item.raw.trim() !== '');

const _moveBlocker = category => {
    if (category.implicit) {
        return 'implicit';
    }
    return _hasContentAboveHeading(category) ? 'carrier' : null;
};

export function categoryMoveBlocker(content, name) {
    const doc = parseDocument(content);
    const category = doc.categories.find(item => item.name === name);
    return category ? _moveBlocker(category) : 'unknown';
}

export function firstCategoryMoveBlocker(content) {
    const doc = parseDocument(content);
    const first = doc.categories[0];
    return first ? _moveBlocker(first) : null;
}

export function moveCategoryTo(content, name, toIndex) {
    const doc = parseDocument(content);
    const fromIndex = doc.categories.findIndex(category => category.name === name);
    if (fromIndex === -1 || toIndex < 0 || toIndex >= doc.categories.length) {
        return content;
    }
    const category = doc.categories[fromIndex];
    if (_moveBlocker(category)) {
        return content;
    }
    if (toIndex === 0 && _moveBlocker(doc.categories[0])) {
        return content;
    }
    if (fromIndex === toIndex) {
        return content;
    }

    // Blank `preCount` lines are layout: hand them to the preamble.
    const preCount = category.preCount ?? 0;
    if (preCount > 0) {
        doc.preamble = (doc.preamble ?? []).concat(category.items.slice(0, preCount));
        category.items = category.items.slice(preCount);
        delete category.preCount;
    }

    doc.categories.splice(fromIndex, 1);
    doc.categories.splice(toIndex, 0, category);
    return serializeDocument(doc);
}

export function isUsableCategoryName(name) {
    return name.length > 0 && !/[\r\n]/.test(name) && !name.startsWith('#');
}

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

export function deleteCategory(content, name) {
    const doc = parseDocument(content);
    const idx = doc.categories.findIndex(category => category.name === name);
    if (idx === -1 || doc.categories[idx].implicit) {
        return content;
    }
    doc.categories.splice(idx, 1);
    return serializeDocument(doc);
}

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
    // Items must move below the new heading: the takeover relationship is gone.
    delete category.preCount;
    return serializeDocument(doc);
}

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

// Write content back to the file at `path`.
export function writeTodo(path, content) {
    // Reject undefined and empty content: GJS marshals an empty Uint8Array to NULL and the write is a silent no-op.
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
        // Surface failures without crashing; the false return lets the caller keep the user's input.
        console.error(`todo: failed to write ${path}: ${e}`);
        return false;
    }
}
