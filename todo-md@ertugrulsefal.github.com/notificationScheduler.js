import Gio from 'gi://Gio';
import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {categoryTasks, getReminderTaskId, getTaskTagValues, parseDocument, REMINDER_ID_TAG,
    replaceTaskTexts, splitLines, taskDates, updateTaskTagText} from './storage.js';
import {parseNotify, planReminders} from './reminders.js';

const SETTINGS_KEY = 'notification-watermarks';
const CLOCK_RECHECK_MS = 60 * 1000;

function reminderKey(identity) {
    return GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256, JSON.stringify(identity), -1);
}

function collectReminders(raw, path, assignIds = false) {
    const tasks = [];
    const changes = [];
    const transfers = [];
    if (!raw.includes('@notify(')) {
        return {tasks, updated: raw, transfers};
    }
    const occurrences = new Map();
    const seenIds = new Set();
    const rows = parseDocument(raw).categories.flatMap(categoryTasks);
    const reservedIds = new Set(rows.map(task => getReminderTaskId(task.raw)));
    for (const task of rows) {
        const existingId = getReminderTaskId(task.raw);
        const id = seenIds.has(existingId) ? null : existingId;
        seenIds.add(existingId);
        const tags = getTaskTagValues(task.raw, 'notify');
        if (tags.length !== 1) {
            continue;
        }
        const dates = taskDates(task.raw);
        const {rules} = parseNotify(tags[0]);
        const distinct = new Map();
        for (const {rule} of rules) {
            if (!rule) {
                continue;
            }
            const dependency = rule.kind === 'from-start' ? dates.start
                : rule.kind === 'before-due' ? dates.due : null;
            const signature = JSON.stringify([task.text, rule, dependency]);
            distinct.set(signature, {rule, dependency});
        }
        if (distinct.size === 0) {
            continue;
        }

        let newId = null;
        if (assignIds && !id && (existingId || !getTaskTagValues(task.raw, REMINDER_ID_TAG).length)) {
            let candidate;
            do {
                candidate = GLib.uuid_string_random();
            } while (reservedIds.has(candidate));
            const nextRaw = updateTaskTagText(task.raw, REMINDER_ID_TAG, candidate);
            if (nextRaw !== null) {
                newId = candidate;
                reservedIds.add(newId);
                changes.push({index: task.index, expectedRaw: task.raw, nextRaw});
            }
        }

        const keyed = [];
        for (const [signature, {rule, dependency}] of distinct) {
            const ordinal = occurrences.get(signature) ?? 0;
            occurrences.set(signature, ordinal + 1);
            const key = id ? reminderKey([path, id, rule, dependency])
                : reminderKey([path, signature, ordinal]);
            if (newId && !existingId) {
                transfers.push({id: newId, from: key,
                    to: reminderKey([path, newId, rule, dependency])});
            }
            keyed.push({rule, key});
        }
        tasks.push({task, dates, rules: keyed});
    }
    const updated = changes.length ? replaceTaskTexts(raw, changes) : raw;
    return {tasks, updated, transfers};
}

function settleTransfers(delivered, journalKey, transfers, hasCommittedId) {
    const next = {...delivered};
    for (const {id, from, to} of transfers) {
        delete next[hasCommittedId(id) ? from : to];
    }
    delete next[journalKey];
    return next;
}

export class NotificationScheduler {
    constructor(settings) {
        this._settings = settings;
        this._delivered = settings.get_value(SETTINGS_KEY).recursiveUnpack();
        this._tasks = [];
        this._timer = 0;
        this._source = null;
        this._sourceSignal = 0;
    }

    refresh(snapshot, path, saveIds) {
        this._tasks = [];
        if (snapshot.ok) {
            const journalKey = reminderKey([path, 'notifyid-migration']);
            this._recoverTaskIdMigration(snapshot.raw, journalKey);
            const {tasks, updated, transfers} = collectReminders(snapshot.raw, path, Boolean(saveIds));
            this._tasks = tasks;
            if (updated !== snapshot.raw) {
                const result = this._saveTaskIds(updated, transfers, journalKey, saveIds);
                if (result === 'conflict' || result === 'pending') {
                    this._tasks = [];
                    this._stopTimer();
                    return;
                }
                if (result === 'saved') {
                    this._tasks = collectReminders(updated, path).tasks;
                }
            }
        }
        this._run();
    }

    _recoverTaskIdMigration(raw, journalKey) {
        if (!(journalKey in this._delivered)) {
            return;
        }
        let transfers;
        try {
            transfers = JSON.parse(this._delivered[journalKey]);
        } catch {
            return;
        }
        const checksum = /^[0-9a-f]{64}$/;
        if (!Array.isArray(transfers) || !transfers.every(transfer =>
            typeof transfer?.id === 'string' && checksum.test(transfer.from) && checksum.test(transfer.to))) {
            return;
        }
        const ids = new Set(splitLines(raw).tasks.map(task => getReminderTaskId(task.text)));
        this._delivered = settleTransfers(this._delivered, journalKey, transfers, id => ids.has(id));
        this._writeDelivered(this._delivered);
    }

    _saveTaskIds(updated, transfers, journalKey, saveIds) {
        const previous = this._delivered;
        const migrated = transfers.filter(({from}) => from in previous);
        if (migrated.length === 0) {
            return saveIds(updated);
        }

        const staged = {...previous};
        for (const {from, to} of migrated) {
            staged[to] = previous[from];
        }
        staged[journalKey] = JSON.stringify(migrated);
        if (!this._writeDelivered(staged)) {
            return 'failed';
        }
        // The file must not expose a new ID until its prior delivery history is durable.
        Gio.Settings.sync();
        const result = saveIds(updated);
        this._delivered = result === 'saved'
            ? settleTransfers(staged, journalKey, migrated, () => true) : previous;
        this._writeDelivered(this._delivered);
        return result;
    }

    _writeDelivered(delivered) {
        return this._settings.set_value(SETTINGS_KEY, GLib.Variant.new('a{ss}', delivered));
    }

    destroy() {
        this._stopTimer();
        if (this._source) {
            this._source.disconnect(this._sourceSignal);
            this._sourceSignal = 0;
            this._source.destroy(MessageTray.NotificationDestroyedReason.SOURCE_CLOSED);
            this._source = null;
        }
        this._tasks = [];
        this._settings = null;
    }

    _run() {
        const now = Date.now();
        const {notifications, updates, next} = planReminders(this._tasks, this._delivered, now);
        if (Object.keys(updates).length > 0) {
            Object.assign(this._delivered, updates);
            this._writeDelivered(this._delivered);
        }
        for (const notification of notifications) {
            this._notify(notification);
        }

        this._stopTimer();
        if (next !== null) {
            // GLib timers use monotonic time. Recheck wall time after clock changes.
            const delay = Math.min(CLOCK_RECHECK_MS, Math.max(1, next - Date.now()));
            this._timer = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
                this._timer = 0;
                this._run();
                return GLib.SOURCE_REMOVE;
            });
        }
    }

    _stopTimer() {
        if (this._timer) {
            GLib.Source.remove(this._timer);
            this._timer = 0;
        }
    }

    _notify(text) {
        if (!this._source) {
            this._source = new MessageTray.Source({
                title: 'Todo MD',
                iconName: 'checkbox-checked-symbolic',
            });
            this._sourceSignal = this._source.connect('destroy', () => {
                this._source = null;
                this._sourceSignal = 0;
            });
            Main.messageTray.add(this._source);
        }
        this._source.addNotification(new MessageTray.Notification({
            source: this._source,
            title: 'Task reminder',
            body: text,
        }));
    }
}
