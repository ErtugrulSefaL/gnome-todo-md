import * as Storage from '../todo-md@ertugrulsefal.github.com/storage.js';

export function testTaskDatesAndStars(record) {
    const date = '2026-12-01';
    const raw = `Prepare file @start(${date}) @due(2026-12-03 at 10:00) @project(a)`;
    const content = `# T\r\n\t-  [ ]\t${raw}\r\nExtra\n`;
    const beforeStart = new Date(2026, 10, 30, 23, 59);
    const onStart = new Date(2026, 11, 1);

    record('start tag: parsed as a local calendar date',
        Storage.getTaskStart(raw).date === date && Storage.localDateString(onStart) === date);
    record('start tag: no completion before the local start day',
        Storage.toggleTask(content, 1, beforeStart) === content);
    record('start tag: completion on the first instant of the start day preserves the document',
        Storage.toggleTask(content, 1, onStart) === content.replace('[ ]', '[x]'));
    record('start tag: completed task may be reopened before its new start date',
        Storage.toggleTask(content.replace('[ ]', '[X]'), 1, beforeStart) === content);
    record('start tag: timed, impossible, and duplicate values are identified',
        Storage.getTaskStart('Task @start(2026-12-01 at 09:00)').status === 'invalid' &&
        Storage.getTaskStart('Task @start(2026-02-29)').status === 'invalid' &&
        Storage.getTaskStart('Task @start() @start(2026-12-01)').status === 'duplicate');
    record('start tag: legacy unclosed syntax remains literal task text',
        Storage.getTaskStart('Task @start(2026-12-01').status === 'absent');

    const {due} = Storage.taskDates(raw);
    record('due tag: timed due reports the exact local date and time',
        due.date === '2026-12-03' && due.time === '10:00' &&
        Storage.localTaskTimestamp(due.date, due.time) === new Date(2026, 11, 3, 10).getTime());
    const untimed = Storage.getTaskDue('Task @due(2026-12-03)');
    record('due tag: date-only due keeps time absent and uses local midnight',
        untimed.status === 'valid' && !Object.hasOwn(untimed, 'time') &&
        Storage.localTaskTimestamp(untimed.date) === new Date(2026, 11, 3).getTime());
    record('due tag: hours, minutes, suffix, and format are checked',
        ['24:00', '10:60', '9:00', '10:00Z', '10:00\n'].every(time =>
            Storage.parseTaskDate(`2026-12-03 at ${time}`, {allowTime: true}) === null));
    record('due tag: timed due update preserves prefix, CRLF and adjacent tags',
        Storage.updateTaskDue(content, 1, raw, '2026-12-04 at 00:00') ===
        content.replace('2026-12-03 at 10:00', '2026-12-04 at 00:00'));
    const duplicates = 'Task @start(bad) @project(a) @start(2026-12-01)';
    record('start tag: explicit repair replaces duplicates without rewriting adjacent tags',
        Storage.updateTaskTagText(duplicates, 'start', date) === null &&
        Storage.updateTaskTagText(duplicates, 'start', date, {resolveDuplicates: true}) ===
        'Task @start(2026-12-01) @project(a)');

    const withStar = content.replace('@project(a)', '@project(a) @starred(1)');
    const starredRaw = raw + ' @starred(1)';
    record('star tag: one button action writes the tag and a second clears it losslessly',
        Storage.toggleTaskStar(content, 1, raw) === withStar &&
        Storage.toggleTaskStar(withStar, 1, starredRaw) === content);
    record('star tag: file value statuses distinguish absent, valid, invalid and duplicate',
        Storage.getTaskStarred(raw).status === 'absent' &&
        Storage.getTaskStarred(starredRaw).status === 'valid' &&
        Storage.getTaskStarred(`${raw} @starred(0)`).status === 'invalid' &&
        Storage.getTaskStarred(`${starredRaw} @starred()`).status === 'duplicate');
    record('star tag: invalid and multiple values repaired to an exact single star',
        Storage.toggleTaskStar(content.replace(raw, `${raw} @starred(0)`), 1, `${raw} @starred(0)`) === withStar &&
        Storage.toggleTaskStar(content.replace(raw, `${starredRaw} @starred()`), 1, `${starredRaw} @starred()`) === withStar);
    record('star tag: stale and missing targets are no-ops',
        Storage.toggleTaskStar(withStar, 1, raw) === withStar &&
        Storage.toggleTaskStar(content, 2, raw) === content);
}
