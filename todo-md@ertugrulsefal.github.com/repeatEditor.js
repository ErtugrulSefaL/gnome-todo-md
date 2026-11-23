import * as Storage from './storage.js';
import {parseRepeat} from './repeat.js';

export function makeRepeatInputs(options) {
    const {box, values, getRaw, onSubmit, makeEntry, makeLabel} = options;
    const rule = values.length === 1 ? parseRepeat(values[0]) : null;
    const raw = getRaw();
    const {start, due} = Storage.taskDates(raw);
    const hasNoDates = ['start', 'due'].every(key => Storage.getTaskTagValues(raw, key).length === 0);
    const addInput = (name, hint, value) => {
        const entry = makeEntry(name, hint, value);
        box.add_child(makeLabel(name));
        box.add_child(entry);
        options.onEntryReturn(entry, onSubmit);
        return entry;
    };
    const startEntry = hasNoDates ? addInput('Start date', 'YYYY-MM-DD', '') : null;
    const everyEntry = addInput('Repeat interval', '1d, 3d, or 1mo',
        rule ? `${rule.interval}${rule.unit}` : '');
    const byEntry = addInput('Repeat by', 'start or due', rule?.by ?? (start || !due ? 'start' : 'due'));
    const anchorEntry = addInput('Anchor date', 'Defaults to the selected date', rule?.anchor ?? '');

    const getValue = () => {
        const raw = getRaw();
        const {start, due} = Storage.taskDates(raw);
        const by = byEntry.get_text().trim();
        if (by !== 'start' && by !== 'due') {
            return {error: 'Enter start or due as the repeat basis.'};
        }
        const companion = [];
        let startDate = start;
        if (startEntry && ['start', 'due'].every(key => Storage.getTaskTagValues(raw, key).length === 0)) {
            startDate = startEntry.get_text().trim();
            if (!Storage.isDueDate(startDate)) {
                return {error: 'Enter a start date in YYYY-MM-DD format.'};
            }
            companion.push({key: 'start', value: startDate, resolveDuplicates: false});
        }
        const selectedDate = by === 'start' ? startDate : due?.date;
        if (!selectedDate) {
            return {error: by === 'start' ? 'Repeat requires a start date.' : 'Repeat requires a due date.'};
        }
        const interval = everyEntry.get_text().trim();
        if (!/^([1-9]\d*)(d|mo)$/.test(interval)) {
            return {error: 'Enter a positive interval such as 3d or 1mo.'};
        }
        const anchor = anchorEntry.get_text().trim() || selectedDate;
        if (!Storage.isDueDate(anchor)) {
            return {error: 'Enter an anchor date in YYYY-MM-DD format.'};
        }
        return {value: `every=${interval},by=${by},anchor=${anchor}`, companion};
    };
    return {entry: startEntry ?? everyEntry, getValue};
}
