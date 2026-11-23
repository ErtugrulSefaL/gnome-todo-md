import {getTaskTagValues, localDateString, localTaskTimestamp, parseTaskDate,
    taskDates} from './storage.js';

const DAY_MS = 86400000;
const UNIT_MS = {m: 60000, h: 3600000, d: DAY_MS};

function parseDuration(value) {
    const match = value?.match(/^([1-9]\d*)([mhd])$/);
    if (!match) {
        return null;
    }
    const [, number, unit] = match;
    const amount = Number(number);
    return Number.isSafeInteger(amount * UNIT_MS[unit]) ? {amount, unit} : null;
}

export function parseReminderRule(text) {
    const fields = new Map();
    for (const part of text.split(',')) {
        const field = part.trim().match(/^([a-z]+)\s*=\s*(\S.*?)$/);
        if (!field || fields.has(field[1])) {
            return {error: 'Use one value per rule field.'};
        }
        fields.set(field[1], field[2].trim());
    }

    if (fields.has('on') && fields.size === 1) {
        const when = parseTaskDate(fields.get('on'), {allowTime: true});
        if (when?.time) {
            return {rule: {kind: 'fixed', ...when}};
        }
        return {error: 'Use on=YYYY-MM-DD at HH:MM.'};
    }
    if (fields.get('from') === 'start' && fields.size === 3) {
        const time = fields.get('time');
        const every = parseDuration(fields.get('every'));
        if (/^(?:[01]\d|2[0-3]):[0-5]\d$/.test(time ?? '') && every?.unit === 'd') {
            return {rule: {kind: 'from-start', time, every}};
        }
        return {error: 'Use from=start,time=HH:MM,every=1d (or another day interval).'};
    }
    if (fields.get('before') === 'due' &&
        fields.size === (fields.has('every') ? 3 : 2)) {
        const offset = parseDuration(fields.get('offset'));
        const every = parseDuration(fields.get('every'));
        if (offset && (!fields.has('every') || every)) {
            return {rule: {kind: 'before-due', offset, every}};
        }
        return {error: 'Use before=due,offset=5h and optionally every=12h.'};
    }
    return {error: 'Use on, from=start, or before=due for each rule.'};
}

export function parseNotify(value) {
    const rules = value.split('&').map(part => {
        const text = part.trim();
        return {text, ...parseReminderRule(text)};
    });
    return {rules};
}

function civilDay(date) {
    const [year, month, day] = date.split('-').map(Number);
    const utc = new Date(0);
    utc.setUTCFullYear(year, month - 1, day);
    return utc.getTime() / DAY_MS;
}

function shiftDate(date, days) {
    const utc = new Date((civilDay(date) + days) * DAY_MS);
    const year = utc.getUTCFullYear();
    if (!(year >= 1 && year <= 9999)) {
        return null;
    }
    return utc.toISOString().slice(0, 10);
}

function timestamp(date, time) {
    return date === null ? Infinity : localTaskTimestamp(date, time);
}

function localTimeString(ms) {
    const date = new Date(ms);
    const pad = value => String(value).padStart(2, '0');
    return `${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function formatReminderTime(ms) {
    return `${localDateString(new Date(ms))} at ${localTimeString(ms)}`;
}

function sequence(first, every, date, time) {
    const days = every.unit === 'd';
    const elapsed = every.amount * UNIT_MS[every.unit];
    return {
        at(index) {
            return days && index !== 0 ? timestamp(shiftDate(date, index * every.amount), time)
                : first + index * elapsed;
        },
        index(timeMs) {
            return days
                ? Math.floor((civilDay(localDateString(new Date(timeMs))) - civilDay(date))
                    / every.amount)
                : Math.floor((timeMs - first) / elapsed);
        },
    };
}

function recurringWindow(first, every, calendarDate, calendarTime, lower, upper, now) {
    if (first >= upper) {
        return {previous: null, next: null};
    }
    const series = sequence(first, every, calendarDate, calendarTime);
    const latest = Math.min(now, upper - 1);
    let previousIndex = series.index(latest);
    if (previousIndex >= 0 && series.at(previousIndex) > latest) {
        previousIndex--;
    }
    const previous = previousIndex >= 0 ? series.at(previousIndex) : null;
    const threshold = Math.max(now + 1, lower);
    let nextIndex = Math.max(0, series.index(threshold));
    if (series.at(nextIndex) < threshold) {
        nextIndex++;
    }
    const next = series.at(nextIndex);
    return {
        previous: previous !== null && previous >= lower ? previous : null,
        next: Number.isFinite(next) && next < upper ? next : null,
    };
}

export function reminderWindow(rule, {start, due}, now = Date.now()) {
    const lower = start ? timestamp(start) : -Infinity;
    let first;
    let calendarDate;
    let calendarTime;
    let upper = Infinity;
    if (rule.kind === 'fixed') {
        first = timestamp(rule.date, rule.time);
    } else if (rule.kind === 'from-start') {
        if (!start) {
            return {previous: null, next: null, error: 'Requires a valid start date.'};
        }
        first = timestamp(start, rule.time);
        calendarDate = start;
        calendarTime = rule.time;
    } else {
        if (!due) {
            return {previous: null, next: null, error: 'Requires a valid due date.'};
        }
        upper = timestamp(due.date, due.time);
        const {amount, unit} = rule.offset;
        if (unit === 'd') {
            calendarDate = shiftDate(due.date, -amount);
            calendarTime = due.time ?? '00:00';
            first = timestamp(calendarDate, calendarTime);
        } else {
            first = upper - amount * UNIT_MS[unit];
        }
        if (!Number.isFinite(new Date(first).getTime()) ||
            localDateString(new Date(first)) < '0001-01-01') {
            return {previous: null, next: null, error: 'Offset is outside the supported calendar.'};
        }
    }

    if (rule.every) {
        return recurringWindow(first, rule.every,
            calendarDate ?? localDateString(new Date(first)),
            calendarTime ?? localTimeString(first), lower, upper, now);
    }
    const scheduled = first >= lower && first < upper;
    return {
        previous: scheduled && first <= now ? first : null,
        next: scheduled && first > now ? first : null,
    };
}

export function getTaskReminderSummary(raw) {
    const tags = getTaskTagValues(raw, 'notify');
    if (tags.length === 0) {
        return null;
    }
    if (tags.length > 1) {
        return 'Multiple notify tags';
    }
    const {rules} = parseNotify(tags[0]);
    const dates = taskDates(raw);
    for (const {rule} of rules) {
        if (!rule) {
            return 'Invalid reminder rule';
        }
        const {error} = reminderWindow(rule, dates);
        if (error) {
            return `Reminder: ${error}`;
        }
    }
    return rules.length === 1 ? '1 reminder' : `${rules.length} reminders`;
}

export function validateNotifyDraft(_raw, value) {
    if (value === null) {
        return null;
    }
    return parseNotify(value).rules.find(({error}) => error)?.error ?? null;
}

export function shiftFixedReminders(value, dayDelta) {
    let overflow = false;
    const shifted = value.split('&').map(part => {
        const {rule} = parseReminderRule(part.trim());
        if (rule?.kind !== 'fixed') {
            return part;
        }
        const date = shiftDate(rule.date, dayDelta);
        overflow ||= date === null;
        return date === null ? part : part.replace(rule.date, date);
    });
    return overflow ? null : shifted.join('&');
}

// Each task entry pairs a rule with a persistent delivery watermark key.
export function planReminders(tasks, delivered, now) {
    const notifications = [];
    const updates = {};
    let next = null;
    for (const {task, dates, rules} of tasks) {
        let due = false;
        for (const {rule, key} of rules) {
            const window = reminderWindow(rule, dates, now);
            if (window.previous !== null &&
                (!(key in delivered) || window.previous > Number(delivered[key]))) {
                updates[key] = String(window.previous);
                due = true;
            }
            if (!task.done && window.next !== null && (next === null || window.next < next)) {
                next = window.next;
            }
        }
        if (due && !task.done) {
            notifications.push(task.text);
        }
    }
    return {notifications, updates, next};
}
