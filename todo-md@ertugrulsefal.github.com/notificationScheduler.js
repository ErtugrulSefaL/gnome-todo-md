import GLib from 'gi://GLib';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as MessageTray from 'resource:///org/gnome/shell/ui/messageTray.js';

import {categoryTasks, getTaskTagValues, parseDocument, taskDates} from './storage.js';
import {parseNotify, planReminders} from './reminders.js';

const SETTINGS_KEY = 'notification-watermarks';
const CLOCK_RECHECK_MS = 60 * 1000;

function collectReminders(raw, path) {
    const tasks = [];
    if (!raw.includes('@notify(')) {
        return tasks;
    }
    const occurrences = new Map();
    for (const category of parseDocument(raw).categories) {
        for (const task of categoryTasks(category)) {
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
                distinct.set(signature, rule);
            }

            const keyed = [];
            for (const [signature, rule] of distinct) {
                const ordinal = occurrences.get(signature) ?? 0;
                occurrences.set(signature, ordinal + 1);
                const key = GLib.compute_checksum_for_string(GLib.ChecksumType.SHA256,
                    JSON.stringify([path, signature, ordinal]), -1);
                keyed.push({rule, key});
            }
            if (keyed.length > 0) {
                tasks.push({task, dates, rules: keyed});
            }
        }
    }
    return tasks;
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

    refresh(snapshot, path) {
        this._tasks = snapshot.ok ? collectReminders(snapshot.raw, path) : [];
        this._run();
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
            this._settings.set_value(SETTINGS_KEY, GLib.Variant.new('a{ss}', this._delivered));
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
