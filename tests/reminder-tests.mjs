import {localTaskTimestamp, taskDates} from '../todo-md@ertugrulsefal.github.com/storage.js';
import {formatReminderTime, getTaskReminderSummary, parseNotify, parseReminderRule,
    planReminders, reminderWindow, shiftFixedReminders, validateNotifyDraft}
    from '../todo-md@ertugrulsefal.github.com/reminders.js';

export function testReminders(record) {
    const timestamp = localTaskTimestamp;
    const make = text => parseReminderRule(text).rule;
    const noDates = {start: null, due: null};

    const fixed = make('on=2026-12-03 at 16:00');
    const fixedTime = timestamp('2026-12-03', '16:00');
    const beforeFixed = reminderWindow(fixed, noDates, fixedTime - 1);
    const afterFixed = reminderWindow(fixed, noDates, fixedTime);
    record('notify fixed: local date and time with inclusive trigger boundary',
        beforeFixed.next === fixedTime && beforeFixed.previous === null &&
        afterFixed.next === null && afterFixed.previous === fixedTime &&
        formatReminderTime(fixedTime) === '2026-12-03 at 16:00');

    const daily = make('from=start,time=09:00,every=1d');
    const startDates = {start: '2026-12-01', due: null};
    const dailyPlan = reminderWindow(daily, startDates, timestamp('2026-12-02', '09:01'));
    record('notify start: repeat at the local time, beginning on the start day',
        dailyPlan.previous === timestamp('2026-12-02', '09:00') &&
        dailyPlan.next === timestamp('2026-12-03', '09:00') &&
        reminderWindow(daily, startDates, timestamp('2026-11-28')).next ===
        timestamp('2026-12-01', '09:00'));
    const acrossDST = reminderWindow(daily, {start: '2026-03-07', due: null},
        timestamp('2026-03-08', '09:01'));
    record('notify start: keep daily wall time across a daylight-saving transition',
        acrossDST.previous === timestamp('2026-03-08', '09:00') &&
        acrossDST.next === timestamp('2026-03-09', '09:00'));

    const timed = {start: null, due: {date: '2026-12-03', time: '10:00'}};
    const dateOnly = {start: null, due: {date: '2026-12-03'}};
    const beforeDue = make('before=due,offset=5h');
    const datesNow = timestamp('2026-12-01');
    record('notify before due: timed deadline and date-only local midnight',
        reminderWindow(beforeDue, timed, datesNow).next === timestamp('2026-12-03', '05:00') &&
        reminderWindow(beforeDue, dateOnly, datesNow).next === timestamp('2026-12-02', '19:00'));
    record('notify before due: day offset uses a local calendar day across DST',
        reminderWindow(make('before=due,offset=2d'), {
            start: null, due: {date: '2026-03-09', time: '09:00'},
        }, timestamp('2026-03-01')).next === timestamp('2026-03-07', '09:00'));

    const periodic = make('before=due,offset=3d,every=12h');
    const periodicPlan = reminderWindow(periodic, timed, timestamp('2026-12-02', '10:00'));
    const deadlinePlan = reminderWindow(periodic, timed, timestamp('2026-12-03', '10:00'));
    record('notify before due: interval begins at offset and excludes due instant',
        reminderWindow(periodic, timed, timestamp('2026-11-29')).next ===
        timestamp('2026-11-30', '10:00') &&
        periodicPlan.previous === timestamp('2026-12-02', '10:00') &&
        periodicPlan.next === timestamp('2026-12-02', '22:00') &&
        deadlinePlan.previous === timestamp('2026-12-02', '22:00') && deadlinePlan.next === null);
    record('notify start gate: suppress old fixed alerts and clip due intervals',
        reminderWindow(fixed, {start: '2026-12-04', due: null}, fixedTime + 1).previous === null &&
        reminderWindow(periodic, {...timed, start: '2026-12-02'},
            timestamp('2026-12-01', '23:59')).next === timestamp('2026-12-02', '10:00'));

    const shiftedDates = taskDates('Task @start(2026-12-04) @due(2026-12-05 at 11:00)');
    record('notify bound rules: recompute after start or due changes',
        reminderWindow(daily, shiftedDates, datesNow).next === timestamp('2026-12-04', '09:00') &&
        reminderWindow(beforeDue, shiftedDates, datesNow).next === timestamp('2026-12-05', '06:00'));
    record('notify missing anchors: report missing or invalid references per rule',
        reminderWindow(daily, noDates, datesNow).error.includes('start') &&
        reminderWindow(beforeDue, noDates, datesNow).error.includes('due') &&
        getTaskReminderSummary('Task @notify(before=due,offset=5h & on=2026-12-03 at 16:00)')
            .includes('due') &&
        validateNotifyDraft('Task', 'before=due,offset=5h & on=2026-12-03 at 16:00') === null);
    record('notify grammar: separate rules with &, reject invalid fields and duplicate keys',
        parseNotify('before=due,offset=3d,every=12h & before=due,offset=5h').rules
            .every(({rule}) => rule.kind === 'before-due') &&
        Boolean(validateNotifyDraft('Task', 'on=2026-02-29 at 10:00')) &&
        Boolean(validateNotifyDraft('Task', 'before=due,offset=5h,offset=1d')) &&
        Boolean(validateNotifyDraft('Task', 'from=start,time=24:00,every=1d')) &&
        Boolean(validateNotifyDraft('Task', 'before=due,offset=0h')) &&
        Boolean(validateNotifyDraft('Task', 'before=due,offset=5h &')) &&
        getTaskReminderSummary('Task @notify() @notify()') === 'Multiple notify tags' &&
        getTaskReminderSummary('Task @notify()') === 'Invalid reminder rule');

    const value = ' on=2028-02-28 at 16:00 & before=due,offset=5h & something=invalid ';
    record('notify repeat: only fixed calendar dates shift, preserving wall time and other rules',
        shiftFixedReminders(value, 2) ===
        ' on=2028-03-01 at 16:00 & before=due,offset=5h & something=invalid ' &&
        shiftFixedReminders('on=9999-12-31 at 16:00', 1) === null);

    const coalesced = [{
        task: {text: 'Task', done: false},
        dates: startDates,
        rules: [
            {rule: daily, key: 'daily'},
            {rule: make('on=2026-12-03 at 09:00'), key: 'fixed'},
            {rule: beforeDue, key: 'missing-due'},
        ],
    }];
    const simultaneous = timestamp('2026-12-03', '09:00');
    const first = planReminders(coalesced, {}, simultaneous);
    record('notify plan: simultaneous rules emit one reminder and consume each occurrence',
        first.notifications.length === 1 && first.notifications[0] === 'Task' &&
        first.updates.daily === String(simultaneous) && first.updates.fixed === String(simultaneous) &&
        first.updates['missing-due'] === undefined && first.next === timestamp('2026-12-04', '09:00'));
    const missedTime = timestamp('2026-12-10', '12:00');
    const catchup = planReminders(coalesced, first.updates, missedTime);
    const persisted = {...first.updates, ...catchup.updates};
    const restart = planReminders(coalesced, persisted, missedTime + 1);
    record('notify plan: offline catch-up emits one and reloading with persisted state emits none',
        catchup.notifications.length === 1 &&
        catchup.updates.daily === String(timestamp('2026-12-10', '09:00')) &&
        restart.notifications.length === 0 && Object.keys(restart.updates).length === 0);
    const completed = planReminders([{...coalesced[0], task: {text: 'Task', done: true}}],
        {}, missedTime);
    record('notify plan: completed task neither emits nor keeps an active deadline',
        completed.notifications.length === 0 && completed.next === null);
}
