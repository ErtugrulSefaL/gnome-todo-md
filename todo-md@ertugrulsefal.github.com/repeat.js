import * as Storage from './storage.js';
import {shiftFixedReminders} from './reminders.js';

const DAY = 86_400_000;
const dayNumber = date => Date.parse(`${date}T00:00:00Z`) / DAY;
const MIN_DAY = dayNumber('0001-01-01');
const MAX_DAY = dayNumber('9999-12-31');

function dateFromDay(day) {
    return day < MIN_DAY || day > MAX_DAY ? null : new Date(day * DAY).toISOString().slice(0, 10);
}

export function parseRepeat(value) {
    if (typeof value !== 'string') {
        return null;
    }
    const fields = new Map();
    for (const field of value.split(',')) {
        const match = /^\s*(every|by|anchor)\s*=\s*([^\s=]+)\s*$/.exec(field);
        if (!match || fields.has(match[1])) {
            return null;
        }
        fields.set(match[1], match[2]);
    }
    const every = /^([1-9]\d*)(d|mo)$/.exec(fields.get('every'));
    const by = fields.get('by');
    const anchor = fields.get('anchor');
    if (!every || !['start', 'due'].includes(by) || !Storage.isDueDate(anchor)) {
        return null;
    }
    const interval = Number(every[1]);
    return Number.isSafeInteger(interval) ? {interval, unit: every[2], by, anchor} : null;
}

function calendarMonth(date) {
    const [year, month] = date.split('-').map(Number);
    return year * 12 + month - 1;
}

function inMonth(month, preferredDay) {
    const year = Math.floor(month / 12);
    if (year < 1 || year > 9999) {
        return null;
    }
    const monthIndex = month % 12;
    const date = new Date(0);
    // setUTCFullYear uses literal years 0001–0099 and day zero means the prior month's last day.
    date.setUTCFullYear(year, monthIndex + 1, 0);
    const daysInMonth = date.getUTCDate();
    date.setUTCFullYear(year, monthIndex, Math.min(preferredDay, daysInMonth));
    return date.toISOString().slice(0, 10);
}

export function nextOccurrence({interval, unit, anchor}, after) {
    if (anchor > after) {
        return anchor;
    }
    if (unit === 'd') {
        const first = dayNumber(anchor);
        const elapsed = dayNumber(after) - first;
        return dateFromDay(first + (Math.floor(elapsed / interval) + 1) * interval);
    }
    const first = calendarMonth(anchor);
    const occurrence = Math.floor((calendarMonth(after) - first) / interval);
    const preferredDay = Number(anchor.slice(8));
    const candidate = inMonth(first + occurrence * interval, preferredDay);
    return candidate > after ? candidate : inMonth(first + (occurrence + 1) * interval, preferredDay);
}

function scheduleError(raw, rule) {
    if (!rule) {
        return 'Enter a repeat rule using every, by and anchor.';
    }
    const start = Storage.getTaskStart(raw);
    const due = Storage.getTaskDue(raw);
    if ([start, due].some(date => ['invalid', 'duplicate'].includes(date.status))) {
        return 'Repair invalid or multiple task dates before repeating.';
    }
    if ((rule.by === 'start' ? start : due).status !== 'valid') {
        return rule.by === 'start' ? 'Repeat requires a start date.' : 'Repeat requires a due date.';
    }
    return null;
}

export function validateRepeatDraft(raw, value) {
    const rule = parseRepeat(value);
    return scheduleError(raw, rule) ?? rangeError(raw, rule);
}

export function getTaskRepeatSummary(raw) {
    const rule = Storage.getTaskTag(raw, 'repeat', parseRepeat);
    if (rule.status === 'absent') {
        return null;
    }
    if (rule.status === 'duplicate') {
        return 'Multiple repeat tags';
    }
    if (rule.status === 'invalid') {
        return 'Invalid repeat rule';
    }
    return scheduleError(raw, rule) ?? rangeError(raw, rule) ??
        `Repeat every ${rule.interval}${rule.unit} by ${rule.by}`;
}

function advanceTask(raw, rule, today) {
    const {start, due} = Storage.taskDates(raw);
    const currentDate = rule.by === 'start' ? start : due.date;
    const occurrence = nextOccurrence(rule, today > currentDate ? today : currentDate);
    if (occurrence === null) {
        return null;
    }
    const delta = dayNumber(occurrence) - dayNumber(currentDate);
    const shiftedStart = start ? dateFromDay(dayNumber(start) + delta) : null;
    const shiftedDue = due ? dateFromDay(dayNumber(due.date) + delta) : null;
    if ((start && !shiftedStart) || (due && !shiftedDue)) {
        return null;
    }
    let next = raw;
    if (shiftedStart) {
        next = Storage.updateTaskTagText(next, 'start', shiftedStart);
        if (next === null) {
            return null;
        }
    }
    if (shiftedDue) {
        const value = due.time ? `${shiftedDue} at ${due.time}` : shiftedDue;
        next = Storage.updateTaskTagText(next, 'due', value);
        if (next === null) {
            return null;
        }
    }
    return Storage.mapTaskTagValues(next, 'notify', value => shiftFixedReminders(value, delta));
}

function rangeError(raw, rule) {
    return advanceTask(raw, rule, Storage.localDateString()) === null
        ? 'The next repeat would exceed the supported date range.' : null;
}

export function toggleScheduledTask(content, index, now = new Date()) {
    const task = Storage.splitLines(content).tasks.find(item => item.index === index);
    if (!task || task.done) {
        return Storage.toggleTask(content, index, now);
    }
    const raw = task.text;
    if (Storage.isBeforeTaskStart(raw, now)) {
        return content;
    }
    const rule = Storage.getTaskTag(raw, 'repeat', parseRepeat);
    if (rule.status === 'absent') {
        return Storage.toggleTask(content, index, now);
    }
    if (rule.status !== 'valid' || scheduleError(raw, rule)) {
        return content;
    }
    return Storage.replaceTaskText(content, index, raw, advanceTask(raw, rule, Storage.localDateString(now)));
}
