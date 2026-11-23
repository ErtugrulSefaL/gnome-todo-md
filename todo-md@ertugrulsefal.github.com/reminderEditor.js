import St from 'gi://St';
import Clutter from 'gi://Clutter';

import {setVerticalOrientation} from './compat.js';
import {taskDates} from './storage.js';
import {formatReminderTime, parseReminderRule, reminderWindow} from './reminders.js';

const MULTIPLE_RULES_ERROR = 'Use Add reminder rule for additional rules.';

export function makeReminderInputs(options) {
    const {box, values, getRaw, rawEntry, onSubmit, makeEntry, makeLabel, makeButton} = options;
    const list = new St.BoxLayout({x_expand: true});
    setVerticalOrientation(list, Clutter.Orientation.VERTICAL);
    box.add_child(list);

    const entries = [];
    const addRule = (value, focus) => {
        const ruleBox = new St.BoxLayout({x_expand: true});
        setVerticalOrientation(ruleBox, Clutter.Orientation.VERTICAL);
        const line = new St.BoxLayout({x_expand: true});
        const entry = makeEntry('Reminder rule', 'on=YYYY-MM-DD at HH:MM', value);
        const preview = makeLabel('');
        const remove = makeButton('Remove', () => {
            const index = entries.indexOf(entry);
            entries.splice(index, 1);
            const focusTarget = entries[index] ?? entries[index - 1] ?? add;
            focusTarget.grab_key_focus();
            ruleBox.destroy();
        }, 'Remove reminder rule');

        const refreshPreview = () => {
            const raw = entry.get_text().trim();
            if (!raw) {
                preview.set_text('');
                return;
            }
            if (raw.includes('&')) {
                preview.set_text(MULTIPLE_RULES_ERROR);
                return;
            }
            const result = parseReminderRule(raw);
            if (!result.rule) {
                preview.set_text(result.error);
                return;
            }
            const {next, error} = reminderWindow(result.rule, taskDates(getRaw()));
            preview.set_text(error ?? (next === null
                ? 'No upcoming reminder' : `Next ${formatReminderTime(next)}`));
        };
        entry.clutter_text.connect('text-changed', refreshPreview);
        if (rawEntry) {
            rawEntry.clutter_text.connectObject('text-changed', refreshPreview, ruleBox);
        }
        options.onEntryReturn(entry, onSubmit);

        line.add_child(entry);
        line.add_child(remove);
        ruleBox.add_child(line);
        ruleBox.add_child(preview);
        list.add_child(ruleBox);
        entries.push(entry);
        refreshPreview();
        if (focus) {
            entry.grab_key_focus();
        }
    };
    const add = makeButton('Add reminder rule', () => addRule('', true));
    box.add_child(add);

    const rules = values.flatMap(value => value.split('&').map(part => part.trim()));
    for (const value of rules.length > 0 ? rules : ['']) {
        addRule(value, false);
    }
    return {
        entry: entries[0],
        getValue() {
            const texts = entries.map(entry => entry.get_text().trim()).filter(Boolean);
            return texts.some(text => text.includes('&'))
                ? {error: MULTIPLE_RULES_ERROR} : texts.join(' & ');
        },
    };
}
