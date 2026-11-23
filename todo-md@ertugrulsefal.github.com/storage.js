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

function taskTagSpans(raw) {
    return Array.from(raw.matchAll(/@(\w+)\(([^)]*)\)/g), match => ({
        key: match[1],
        value: match[2],
        start: match.index,
        end: match.index + match[0].length,
    }));
}

const extractTags = raw => taskTagSpans(raw)
    .filter(tag => tag.value !== '')
    .map(tag => [tag.key, tag.value]);

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
                current.headingIndex = i;
            } else {
                current = {name, items: [], implicit: false, headingIndex: i};
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

export function readTodoAsync(path, callback, cancellable = null) {
    const file = Gio.File.new_for_path(path);
    file.load_contents_async(cancellable, (source, result) => {
        let content, etag;
        try {
            const [, bytes, loadedEtag] = source.load_contents_finish(result);
            etag = loadedEtag;
            // Uint8Array.toString() is deprecated and mangles empty contents; use TextDecoder.
            content = bytes ? new TextDecoder().decode(bytes) : '';
        } catch (err) {
            const missing = err.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.NOT_FOUND);
            callback({tasks: [], other: [], raw: '', ok: false, missing});
            return;
        }
        callback({...parseTodo(content), etag});
    });
}

// Parse already-read content into the `{tasks, other, raw, ok}` shape.
export function parseTodo(content, ok = true) {
    const {tasks, other} = splitLines(content);
    return {tasks, other, raw: content, ok};
}

// Task operations
const normalizeTaskText = text => text.replace(/[\r\n\u2028\u2029]+/g, ' ');

export function toggleTask(content, index, now = new Date()) {
    const lines = content.split('\n');
    const line = lines[index];
    if (line === undefined) {
        return content;
    }

    // A CRLF line keeps a trailing '\r'; match without it, then put it back.
    const cr = line.endsWith('\r') ? '\r' : '';
    const match = (cr ? line.slice(0, -1) : line)
        .match(/^(\s*-\s+\[)([ xX])(\]\s+)(.*)$/);
    if (!match) {
        return content;
    }

    const done = match[2].toLowerCase() === 'x';
    if (!done && isBeforeTaskStart(match[4], now)) {
        return content;
    }
    lines[index] = match[1] + (done ? ' ' : 'x') + match[3] + match[4] + cr;
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
        lines[index] = match[1] + normalizeTaskText(text) + cr;
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
    const categoryIndex = doc.categories.findIndex(category => category.name === categoryName);
    const target = doc.categories[categoryIndex];
    const lines = content.split('\n');
    const lastTask = target && categoryTasks(target).at(-1);
    const cr = doc.eol === '\r\n' ? '\r' : '';
    const taskLine = `- [ ] ${normalizeTaskText(text)}`;

    if (target?.headingIndex !== undefined) {
        const end = doc.categories[categoryIndex + 1]?.headingIndex ??
            (content.endsWith('\n') ? lines.length - 1 : lines.length);
        const nextLine = lastTask ? (target.items.indexOf(lastTask) + 1 === target.preCount
            ? target.headingIndex : lastTask.index) + 1 : end;

        // At an unterminated EOF the prior line needs a separator and the new last line has none.
        if (nextLine === lines.length && !lines[nextLine - 1].endsWith('\r')) {
            lines[nextLine - 1] += cr;
        }
        lines.splice(nextLine, 0, taskLine + (nextLine < lines.length ? cr : ''));
        return lines.join('\n');
    }

    // Adding the document scaffold does not require reserializing existing tasks.
    if (lines.at(-1) === '') {
        lines.pop();
    } else if (!lines.at(-1).endsWith('\r')) {
        lines[lines.length - 1] += cr;
    }
    if (target) {
        const nextLine = lastTask ? lastTask.index + 1
            : doc.categories[categoryIndex + 1]?.headingIndex ?? lines.length;
        lines.splice(nextLine, 0, taskLine + cr);
    } else {
        lines.push(`## ${categoryName}${cr}`, taskLine + cr);
    }
    const first = doc.categories[0];
    if (first?.implicit && (first === target || categoryTasks(first).length > 0)) {
        lines.splice(doc.title === null ? 0 : 1, 0, `## ${FALLBACK_CATEGORY}${cr}`);
    }
    if (doc.title === null) {
        lines.unshift(`# TODO${cr}`);
    }
    return lines.join('\n') + '\n';
}

export function moveTaskTo(content, fromIndex, toIndex) {
    if (fromIndex === toIndex) {
        return content;
    }
    const doc = parseDocument(content);
    const sameCategory = doc.categories.some(category => {
        const tasks = categoryTasks(category);
        return tasks.some(task => task.index === fromIndex) && tasks.some(task => task.index === toIndex);
    });
    if (!sameCategory) {
        return content;
    }

    const lines = content.split('\n');
    const last = lines.length - 1;
    const [moving] = lines.splice(fromIndex, 1);
    lines.splice(toIndex, 0, moving);

    // On a file without a final newline, transfer a trailing CR to the line that now needs the separator.
    if (Math.max(fromIndex, toIndex) === last && lines[last].endsWith('\r')) {
        const oldLast = fromIndex === last ? toIndex : last - 1;
        lines[oldLast] += '\r';
        lines[last] = lines[last].slice(0, -1);
    }
    return lines.join('\n');
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

export function isDueDate(value) {
    if (typeof value !== 'string' || value.length !== 10 ||
        !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
        return false;
    }
    const [year, month, day] = value.split('-').map(Number);
    if (year === 0 || month < 1 || month > 12 || day < 1) {
        return false;
    }
    const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
    const daysInMonth = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
    return day <= daysInMonth[month - 1];
}

export function parseTaskDate(value, {allowTime = false} = {}) {
    if (typeof value !== 'string') {
        return null;
    }
    const match = /^(\d{4}-\d{2}-\d{2})(?: at ([01]\d|2[0-3]):([0-5]\d))?$/u.exec(value);
    if (!match || match[0] !== value || !isDueDate(match[1]) || (!allowTime && match[2])) {
        return null;
    }
    const [, date, hours, minutes] = match;
    return hours ? {date, time: `${hours}:${minutes}`} : {date};
}

export function getTaskTagValues(raw, key) {
    return taskTagSpans(raw).filter(tag => tag.key === key).map(tag => tag.value);
}

export const REMINDER_ID_TAG = 'notifyid';

export function getReminderTaskId(raw) {
    const ids = getTaskTagValues(raw, REMINDER_ID_TAG);
    return ids.length === 1 &&
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/.test(ids[0])
        ? ids[0] : null;
}

export function mapTaskTagValues(raw, key, update) {
    let next = raw;
    for (const tag of taskTagSpans(raw).reverse()) {
        if (tag.key === key) {
            const value = update(tag.value);
            if (typeof value !== 'string' || /[)\r\n\u2028\u2029]/.test(value)) {
                return null;
            }
            next = next.slice(0, tag.start) + `@${key}(${value})` + next.slice(tag.end);
        }
    }
    return next;
}

export function getTaskTag(raw, key, parse) {
    const values = getTaskTagValues(raw, key);
    if (values.length === 0) {
        return {status: 'absent'};
    }
    if (values.length > 1) {
        return {status: 'duplicate'};
    }
    const parsed = parse(values[0]);
    return parsed ? {...parsed, status: 'valid'} : {status: 'invalid'};
}

export function getTaskStart(raw) {
    return getTaskTag(raw, 'start', parseTaskDate);
}

export function getTaskDue(raw) {
    return getTaskTag(raw, 'due', value => parseTaskDate(value, {allowTime: true}));
}

export function getTaskStarred(raw) {
    return getTaskTag(raw, 'starred', value => value === '1' ? {starred: true} : null);
}

export function taskDates(raw) {
    const start = getTaskStart(raw);
    const {status, ...due} = getTaskDue(raw);
    return {start: start.date ?? null, due: status === 'valid' ? due : null};
}

export function localDateString(date = new Date()) {
    const year = String(date.getFullYear()).padStart(4, '0');
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}-${month}-${day}`;
}

export function localTaskTimestamp(date, time = '00:00') {
    return Date.parse(`${date}T${time}:00`);
}

export function isBeforeTaskStart(raw, now = new Date()) {
    const {date} = getTaskStart(raw);
    return date !== undefined && localDateString(now) < date;
}

function removeTaskTagSpan(raw, {start, end}) {
    if (raw[start - 1] === ' ' && (start === 1 || !/\s/.test(raw[start - 2])) &&
        (end === raw.length || /\s/.test(raw[end]))) {
        start--;
    } else if (start === 0 && raw[end] === ' ' && !/\s/.test(raw[end + 1] ?? '')) {
        end++;
    }
    return raw.slice(0, start) + raw.slice(end);
}

export function getTaskDueValues(raw) {
    return getTaskTagValues(raw, 'due');
}

// A null value clears the tag. A null result means the draft was rejected.
export function updateTaskTagText(text, key, value, {resolveDuplicates = false} = {}) {
    if (!/^\w+$/.test(key) || (value !== null &&
        (typeof value !== 'string' || !value || /[)\r\n\u2028\u2029]/.test(value)))) {
        return null;
    }
    const expectedRaw = normalizeTaskText(text);
    const tags = taskTagSpans(expectedRaw);
    const targets = tags.filter(tag => tag.key === key);
    if (targets.length > 1 && !resolveDuplicates) {
        return null;
    }
    if (targets.length === 0 && value === null) {
        return expectedRaw;
    }

    const replacement = value === null ? '' : `@${key}(${value})`;
    const first = targets[0];
    let raw = expectedRaw;
    if (first) {
        for (const tag of targets.slice(value === null ? 0 : 1).reverse()) {
            raw = removeTaskTagSpan(raw, tag);
        }
        if (value !== null) {
            raw = raw.slice(0, first.start) + replacement + raw.slice(first.end);
        }
    } else {
        const text = raw.trimEnd();
        raw = text + (text ? ' ' : '') + replacement + raw.slice(text.length);
    }

    if (value === null && !deriveText(raw)) {
        return null;
    }

    // Splicing a tag can join raw fragments into a token or complete an open tag.
    const expectedTags = tags.flatMap(tag => {
        if (tag.key !== key) {
            return [expectedRaw.slice(tag.start, tag.end)];
        }
        return tag === first && value !== null ? [replacement] : [];
    });
    if (!first) {
        expectedTags.push(replacement);
    }
    const actualTags = taskTagSpans(raw);
    if (actualTags.length !== expectedTags.length ||
        !actualTags.every((tag, i) => raw.slice(tag.start, tag.end) === expectedTags[i])) {
        return null;
    }

    return raw;
}

export function updateTaskDueText(text, date, options) {
    if (date !== null && !parseTaskDate(date, {allowTime: true})) {
        return null;
    }
    return updateTaskTagText(text, 'due', date, options);
}

// expectedRaw is the task text from the displayed snapshot.
export function replaceTaskText(content, index, expectedRaw, nextRaw) {
    return replaceTaskTexts(content, [{index, expectedRaw, nextRaw}]);
}

export function replaceTaskTexts(content, changes) {
    const lines = content.split('\n');
    for (const {index, expectedRaw, nextRaw} of changes) {
        if (!Number.isInteger(index) || typeof expectedRaw !== 'string' || typeof nextRaw !== 'string') {
            return content;
        }
        const line = lines[index];
        if (line === undefined) {
            return content;
        }
        const cr = line.endsWith('\r') ? '\r' : '';
        const match = (cr ? line.slice(0, -1) : line)
            .match(/^(\s*-\s+\[[ xX]\]\s+)(.*)$/);
        if (!match || match[2] !== expectedRaw) {
            return content;
        }
        lines[index] = match[1] + normalizeTaskText(nextRaw) + cr;
    }
    return lines.join('\n');
}

export function updateTaskDue(content, index, expectedRaw, date, options) {
    if (typeof expectedRaw !== 'string') {
        return content;
    }
    return replaceTaskText(content, index, expectedRaw, updateTaskDueText(expectedRaw, date, options));
}

export function toggleTaskStar(content, index, expectedRaw) {
    if (typeof expectedRaw !== 'string') {
        return content;
    }
    const {status} = getTaskStarred(expectedRaw);
    const value = status === 'valid' ? null : '1';
    const next = updateTaskTagText(expectedRaw, 'starred', value, {resolveDuplicates: true});
    return replaceTaskText(content, index, expectedRaw, next);
}

export function writeTodo(path, content) {
    return replaceTodo(path, content).ok;
}

export function replaceTodo(path, content, expectedEtag = null) {
    // Reject undefined and empty content: GJS marshals an empty Uint8Array to NULL and the write is a silent no-op.
    if (content === undefined || content === '') {
        throw new Error('todo: writeTodo requires a non-empty content string');
    }

    const file = Gio.File.new_for_path(path);
    // replace_contents expects a Uint8Array (guint8[]), which TextEncoder yields.
    const bytes = new TextEncoder().encode(content);
    try {
        const [ok, etag] = file.replace_contents(bytes, expectedEtag,
            false, Gio.FileCreateFlags.NONE, null);
        return {ok, etag};
    } catch (e) {
        if (e.matches(Gio.IOErrorEnum, Gio.IOErrorEnum.WRONG_ETAG)) {
            return {ok: false, conflict: true};
        }
        console.error(`todo: failed to write ${path}: ${e}`);
        return {ok: false};
    }
}
