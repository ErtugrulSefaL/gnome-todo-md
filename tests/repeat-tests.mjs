import {getTaskRepeatSummary, nextOccurrence, parseRepeat, toggleScheduledTask, validateRepeatDraft}
    from '../todo-md@ertugrulsefal.github.com/repeat.js';
import {makeRepeatInputs} from '../todo-md@ertugrulsefal.github.com/repeatEditor.js';

export function testRepeat(record) {
    const at = date => new Date(`${date}T12:00:00`);
    const toggle = (content, date, index = 0) => toggleScheduledTask(content, index, at(date));
    const daily = 'every=3d,by=start,anchor=2026-12-01';
    const monthly = 'every=1mo,by=due,anchor=2026-12-31';
    const calendar = parseRepeat(monthly);
    record('repeat: parser accepts independent field order and rejects malformed values',
        parseRepeat('by=due, anchor=2026-12-31, every=1mo')?.unit === 'mo' &&
        ['every=0d,by=start,anchor=2026-12-01', 'every=1mo,by=done,anchor=2026-12-01',
            'every=3d,by=start,anchor=2026-02-29', `${daily},anchor=2026-12-04`,
            `${daily},extra=1`, 'every=9007199254740992d,by=start,anchor=2026-12-01']
            .every(value => parseRepeat(value) === null));

    const original = [
        '## Work',
        `  -  [ ]  Preserve   text @other(A) @start(2026-12-04) @due(2026-12-06 at 17:25) @repeat(${daily})` +
            ' @notify(on=2026-12-05 at 11:00 & before=due,offset=5h & invalid)  ',
        'other lines are untouched',
    ].join('\r\n');
    const expected = original.replace('start(2026-12-04)', 'start(2026-12-10)')
        .replace('due(2026-12-06 at 17:25)', 'due(2026-12-12 at 17:25)')
        .replace('on=2026-12-05 at 11:00', 'on=2026-12-11 at 11:00');
    record('repeat: one late completion advances the same unfinished line, preserves due time and shifts fixed reminders',
        toggle(original, '2026-12-08', 1) === expected);

    const jan = `- [ ] Bill @due(2027-01-31 at 10:15) @repeat(${monthly})\n`;
    const feb = toggle(jan, '2027-01-26');
    const mar = toggle(feb, '2027-02-28');
    record('repeat: early completion advances the planned month, February clamps then restores anchored day',
        feb === jan.replace('2027-01-31', '2027-02-28') &&
        mar === jan.replace('2027-01-31', '2027-03-31'));
    record('repeat: leap February and literal years below 100 calculate the calendar day',
        nextOccurrence(calendar, '2028-01-31') === '2028-02-29' &&
        nextOccurrence(parseRepeat('every=1mo,by=due,anchor=0096-01-31'), '0096-01-31') === '0096-02-29');
    record('repeat: due shifts a prior start by the same number of calendar days across month boundaries',
        toggle(jan.replace(' @due', ' @start(2027-01-29) @due'), '2027-01-31') ===
        feb.replace(' @due', ' @start(2027-02-26) @due'));
    record('repeat: completed tasks reopen without advancing and future-start tasks stay open',
        toggle(jan.replace('[ ]', '[X]'), '2027-02-22') === jan &&
        toggle(original, '2026-12-03', 1) === original &&
        toggle('- [ ] Unscheduled\n', '2026-12-01') === '- [x] Unscheduled\n');

    const duplicates = `${jan.trimEnd()} @notify(on=2027-01-30 at 14:00) @notify(on=2027-01-20 at 07:00)\n`;
    record('repeat: duplicate notify tokens retain their values and position apart from shifted fixed dates',
        toggle(duplicates, '2027-01-31') === duplicates.replace('2027-01-31', '2027-02-28')
            .replace('2027-01-30', '2027-02-27').replace('2027-01-20', '2027-02-17'));

    const invalid = [
        `- [ ] No dates @repeat(${daily})`,
        `- [ ] Duplicate @due(2026-12-02) @due(2026-12-03) @repeat(${monthly})`,
        `- [ ] Duplicate @due(2026-12-02) @repeat(${monthly}) @repeat(${daily})`,
        '- [ ] Invalid @start(2026-12-01) @repeat(every=0d,by=start,anchor=2026-12-01)',
        '- [ ] Overflow @due(9999-12-31) @repeat(every=1mo,by=due,anchor=9999-12-31)',
        '- [ ] Shift overflow @start(9999-12-30) @due(9999-12-31) @repeat(every=1d,by=start,anchor=9999-12-30)',
        '- [ ] Fixed reminder overflow @due(9999-12-30) @repeat(every=1d,by=due,anchor=9999-12-30)' +
            ' @notify(on=9999-12-31 at 09:00)',
    ];
    record('repeat: invalid schedules and calendar overflows never write a partial recurrence or mark it complete',
        invalid.every(raw => toggle(raw, '9999-12-30') === raw));
    record('repeat: invalid, duplicate, missing basis and overflow each have a visible summary',
        getTaskRepeatSummary(invalid[0]) === 'Repeat requires a start date.' &&
        getTaskRepeatSummary(invalid[2]) === 'Multiple repeat tags' &&
        getTaskRepeatSummary(invalid[3]) === 'Invalid repeat rule' &&
        getTaskRepeatSummary(invalid[4]).includes('date range'));
    record('repeat: setup requires a valid basis and validates the proposed companion date',
        validateRepeatDraft('New task', daily) === 'Repeat requires a start date.' &&
        validateRepeatDraft('New task @start(2026-12-01)', daily) === null);

    const entries = new Map();
    const repeatEditor = makeRepeatInputs({
        box: {add_child() {}}, values: [], getRaw: () => 'No dates', onSubmit() {},
        makeEntry(name, _hint, value) {
            const entry = {value, get_text() { return this.value; }};
            entries.set(name, entry);
            return entry;
        },
        makeLabel() {}, onEntryReturn() {},
    });
    const missingStart = repeatEditor.getValue();
    entries.get('Start date').value = '2026-12-01';
    entries.get('Repeat interval').value = '3d';
    const entered = repeatEditor.getValue();
    record('repeat: no-date editor focuses and requires a start date and proposes both tags in one save',
        repeatEditor.entry === entries.get('Start date') && !!missingStart.error && entered.value === daily &&
        entered.companion.length === 1 && entered.companion[0].key === 'start' &&
        entered.companion[0].value === '2026-12-01');
}
