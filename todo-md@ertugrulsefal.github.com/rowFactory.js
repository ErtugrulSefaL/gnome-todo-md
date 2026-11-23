import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';
import {setVerticalOrientation} from './compat.js';
import {makeReminderInputs} from './reminderEditor.js';
import {getTaskReminderSummary} from './reminders.js';
import {getTaskRepeatSummary} from './repeat.js';
import {makeRepeatInputs} from './repeatEditor.js';

const TAG_LABELS = {
    start: 'Start date',
    due: 'Due date',
    notify: 'Reminders',
    repeat: 'Repeat',
};

function dateLabel(task, key) {
    const {status, date, time} = key === 'start'
        ? Storage.getTaskStart(task.raw)
        : Storage.getTaskDue(task.raw);
    if (status === 'absent') {
        return null;
    }
    if (status === 'invalid') {
        return `Invalid ${TAG_LABELS[key].toLowerCase()}`;
    }
    if (status === 'duplicate') {
        return `Multiple ${key} tags`;
    }
    if (key === 'start') {
        const due = Storage.getTaskDue(task.raw);
        return due.status === 'valid' && date > due.date
            ? `Start is after due date · ${date}` : `Starts ${date}`;
    }
    const display = time ? `${date} at ${time}` : date;
    if (task.done) {
        return `Due ${display}`;
    }

    // Compare calendar dates as UTC midnights so DST does not change the day count.
    const todayDay = Date.parse(`${Storage.localDateString()}T00:00:00Z`);
    const days = (Date.parse(`${date}T00:00:00Z`) - todayDay) / 86_400_000;
    if (days < 0) {
        return `Overdue · ${display}`;
    }
    if (days === 0) {
        return `Due today · ${display}`;
    }
    if (days === 1) {
        return `Due tomorrow · ${display}`;
    }
    return days <= 7 ? `Due in ${days} days · ${display}` : `Due ${display}`;
}

function onEntryReturn(entry, callback) {
    entry.connect('key-release-event', (_entry, event) => {
        if (event.get_key_symbol() === Clutter.KEY_Return) {
            callback();
            return Clutter.EVENT_STOP;
        }
        return Clutter.EVENT_PROPAGATE;
    });
}

function editorButton(label, callback, accessibleName = label) {
    const button = new St.Button({
        label,
        accessible_name: accessibleName,
        can_focus: true,
        style_class: 'button todo-editor-button',
    });
    button.connect('clicked', callback);
    return button;
}

// Cap an actor's width to the `menu-width` setting (also used by extension.js).
export function capWidth(actor, menuWidth) {
    actor.set_style(`max-width: ${menuWidth}px;`);
}

// Row builders: task rows, inline add/edit entries.
// Callbacks are injected; this module keeps no extension state.
export class RowFactory {
    constructor({menuWidth, onToggle, onToggleStar, onEdit, onEditTag, onDelete, onMove, onDragBegin,
        onDragEnd, onDrop, onAddTask, onFinishEditing, onCancelEditing}) {
        this._menuWidth = menuWidth;
        this._onToggle = onToggle;
        this._onToggleStar = onToggleStar;
        this._onEdit = onEdit;
        this._onEditTag = onEditTag;
        this._onDelete = onDelete;
        this._onMove = onMove;
        this._onDragBegin = onDragBegin;
        this._onDragEnd = onDragEnd;
        this._onDrop = onDrop;
        this._onAddTask = onAddTask;
        this._onFinishEditing = onFinishEditing;
        this._onCancelEditing = onCancelEditing;
    }

    // The drag handle is an St.Button: it consumes press/release, so a click on
    // it never reaches the row's activate.
    makeTaskRow(task, categoryName, colors, snapshot) {
        const index = task.index;
        const row = new PopupMenu.PopupBaseMenuItem();
        // The Shell hands back actors during a drag, so the row carries its identity.
        row._todoIndex = index;
        row._todoCategory = categoryName;
        const details = [
            ['start', dateLabel(task, 'start')],
            ['due', dateLabel(task, 'due')],
            ['notify', getTaskReminderSummary(task.raw)],
            ['repeat', getTaskRepeatSummary(task.raw)],
        ].filter(([, text]) => text !== null);
        const firstLine = this.makeTagLines(row, details, task, snapshot);
        const label = new St.Label({
            text: task.text,
            style_class: task.done ? 'todo-text todo-done' : 'todo-text',
            // The row's icon buttons are taller than the text.
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Truncate rather than widen the menu.
        this.capWidth(label);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        // PopupBaseMenuItem has no checkAccessibleState (that is on
        // PopupSwitchMenuItem), so CHECKED is set here; the row is rebuilt on
        // every refresh, so this cannot go stale.
        row.accessible_role = Atk.Role.CHECK_MENU_ITEM;
        row.label_actor = label;
        if (task.done) {
            row.add_accessible_state(Atk.StateType.CHECKED);
        }
        // Fixed-size checkbox area: checking a task must not widen the row.
        const hexColor = Storage.categoryColorHex(categoryName, colors);
        const checkBox = new St.Bin({
            style_class: task.done ? 'todo-check todo-check-done' : 'todo-check',
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        if (task.done) {
            checkBox.set_child(new St.Icon({
                icon_name: 'object-select-symbolic',
                style_class: 'todo-check-icon',
            }));
        }
        if (task.done && hexColor) {
            checkBox.set_style(
                `background-color: ${hexColor}; border-color: transparent;`);
        }
        firstLine.add_child(checkBox);

        if (task.done) {
            // Actor opacity, not CSS: St.Label does not honour CSS opacity. 0.6 * 255.
            label.opacity = 153;
        }

        // Adwaita's grip icon: Yaru's drag-handle-symbolic does not exist there.
        const handle = new St.Button({
            style_class: 'todo-icon-button todo-drag-handle button',
            // Icon-only: without a name a screen reader announces just "button".
            accessible_name: 'Reorder task',
            child: new St.Icon({
                icon_name: 'list-drag-handle-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        // The Shell asks the handle's delegate for the drag actor.
        handle._delegate = {
            getDragActor: () => new Clutter.Clone({source: row}),
            getDragActorSource: () => row,
        };
        const draggable = DND.makeDraggable(handle);
        draggable.connect('drag-begin', () => this._onDragBegin(index, categoryName, snapshot));
        draggable.connect('drag-end', () => this._onDragEnd());

        const delBtn = new St.Button({
            style_class: 'todo-icon-button button',
            accessible_name: 'Delete task',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        delBtn.connect('clicked', () => {
            this._onDelete(index, snapshot);
        });

        const editBtn = new St.Button({
            style_class: 'todo-icon-button button',
            accessible_name: 'Edit task',
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        editBtn.connect('clicked', () => {
            this._onEdit(index);
        });

        // x_expand (not GTK's hexpand) so the buttons pin right.
        label.set_x_expand(true);
        label.set_x_align(Clutter.ActorAlign.START);
        editBtn.set_x_align(Clutter.ActorAlign.END);
        delBtn.set_x_align(Clutter.ActorAlign.END);
        handle.set_x_align(Clutter.ActorAlign.END);

        firstLine.add_child(label);
        firstLine.add_child(editBtn);
        firstLine.add_child(delBtn);
        firstLine.add_child(handle);

        row.connect('activate', () => {
            this._onToggle(index, snapshot);
        });

        // true lets the Shell finish the drag (destroy the drag actor, pop the
        // modal grab, emit drag-end); false snaps the row back.
        row.acceptDrop = () => this._onDrop(index, categoryName) === true;

        // Alt+↑/↓; the row's own handler ignores modified presses, so they reach us.
        row.connect('key-press-event', (_actor, event) => {
            if ((event.get_state() & Clutter.ModifierType.MOD1_MASK) === 0) {
                return Clutter.EVENT_PROPAGATE;
            }
            const symbol = event.get_key_symbol();
            if (symbol !== Clutter.KEY_Up && symbol !== Clutter.KEY_Down) {
                return Clutter.EVENT_PROPAGATE;
            }
            this._onMove(index, categoryName,
                symbol === Clutter.KEY_Up ? 'up' : 'down', snapshot);
            return Clutter.EVENT_STOP;
        });
        return row;
    }

    makeTagLines(row, details, task, snapshot) {
        const lines = new St.BoxLayout({x_expand: true});
        setVerticalOrientation(lines, Clutter.Orientation.VERTICAL);
        const firstLine = new St.BoxLayout({style_class: 'todo-task-first-line'});
        lines.add_child(firstLine);
        const buttons = details.map(([key, text]) => {
            const detail = this.makeEditorLabel(text);
            const button = new St.Button({
                child: detail,
                style_class: 'todo-task-tag',
                x_align: Clutter.ActorAlign.START,
                can_focus: true,
                accessible_name: `Edit ${TAG_LABELS[key].toLowerCase()}: ${text}`,
            });
            button.connect('clicked', () => this._onEditTag(task.index, snapshot, key));
            return button;
        });
        const secondLine = new St.BoxLayout({style_class: 'todo-task-details'});
        const star = this.makeStarButton(task, snapshot);
        const firstTag = buttons[0];
        if (firstTag) {
            firstTag.set_x_expand(true);
            secondLine.add_child(firstTag);
        } else {
            secondLine.set_x_align(Clutter.ActorAlign.END);
        }
        secondLine.add_child(star);
        lines.add_child(secondLine);
        for (const button of buttons.slice(1)) {
            lines.add_child(button);
        }
        buttons.splice(firstTag ? 1 : 0, 0, star);
        // St skips the children of a widget that is itself focusable.
        const modifiers = Clutter.ModifierType.MODIFIER_MASK
            & ~(Clutter.ModifierType.LOCK_MASK | Clutter.ModifierType.MOD2_MASK);
        row.connect('key-press-event', (_actor, event) => {
            if (row.has_key_focus() && event.get_key_symbol() === Clutter.KEY_Tab
                && (event.get_state() & modifiers) === 0) {
                buttons[0].grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        for (const [index, button] of buttons.entries()) {
            button.connect('key-press-event', (_actor, event) => {
                const key = event.get_key_symbol();
                const state = event.get_state() & modifiers;
                const backwards = (key === Clutter.KEY_Tab && state === Clutter.ModifierType.SHIFT_MASK)
                    || (key === Clutter.KEY_ISO_Left_Tab
                        && (state === 0 || state === Clutter.ModifierType.SHIFT_MASK));
                if (backwards) {
                    (buttons[index - 1] ?? row).grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
                const next = buttons[index + 1];
                if (key === Clutter.KEY_Tab && state === 0 && next) {
                    next.grab_key_focus();
                    return Clutter.EVENT_STOP;
                }
                return Clutter.EVENT_PROPAGATE;
            });
        }
        row.add_child(lines);
        row.get_accessible().set_description(details.map(([, text]) => text).join('. '));
        return firstLine;
    }

    makeStarButton(task, snapshot) {
        const {status} = Storage.getTaskStarred(task.raw);
        const activate = () => this._onToggleStar(task, snapshot);
        if (status === 'duplicate' || status === 'invalid') {
            const warning = status === 'duplicate' ? 'Multiple starred tags' : 'Invalid starred tag';
            return editorButton(warning, activate, `${warning}. Set one star tag.`);
        }
        const starred = status === 'valid';
        const button = new St.Button({
            style_class: 'todo-icon-button button',
            accessible_name: starred ? 'Remove star' : 'Add star',
            can_focus: true,
            child: new St.Icon({
                icon_name: starred ? 'starred-symbolic' : 'non-starred-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        button.connect('clicked', activate);
        return button;
    }

    // Cap to menu-width: typing must not widen the menu.
    capWidth(actor) {
        capWidth(actor, this._menuWidth);
    }

    makeEditor() {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const box = new St.BoxLayout({
            x_expand: true,
            style_class: 'todo-task-editor',
        });
        setVerticalOrientation(box, Clutter.Orientation.VERTICAL);
        row.add_child(box);
        return {row, box};
    }

    makeEditorLabel(text, styleClass = '') {
        const label = new St.Label({text, style_class: styleClass});
        this.capWidth(label);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    makeEditorEntry(name, hint, value = '') {
        const entry = new St.Entry({
            accessible_name: name,
            hint_text: hint,
            style_class: 'todo-edit-entry',
        });
        entry.set_text(value);
        entry.set_x_expand(true);
        this.capWidth(entry);
        return entry;
    }

    makeDateInputs({key, box, values, onSubmit, makeEntry}) {
        const hint = key === 'due' ? 'YYYY-MM-DD or YYYY-MM-DD at HH:MM' : 'YYYY-MM-DD';
        const entry = makeEntry(TAG_LABELS[key], hint, values.length === 1 ? values[0] : '');
        onEntryReturn(entry, onSubmit);
        box.add_child(entry);
        return {entry, getValue: () => entry.get_text().trim()};
    }

    makeTagControls(key, getRaw, onSave, onCancel, isNew = false, rawEntry = null) {
        const box = new St.BoxLayout({style_class: 'todo-task-editor'});
        setVerticalOrientation(box, Clutter.Orientation.VERTICAL);
        const raw = getRaw();
        const values = Storage.getTaskTagValues(raw, key);
        const duplicates = values.length > 1;
        const label = TAG_LABELS[key];
        const isDate = key === 'start' || key === 'due';
        const invalidDate = isDate && values.length === 1 &&
            !Storage.parseTaskDate(values[0], {allowTime: key === 'due'});
        const status = duplicates ? `Multiple ${key} tags`
            : invalidDate ? `Invalid ${label.toLowerCase()}` : null;
        if (status) {
            const tags = values.map(value => `@${key}(${value})`).join(', ');
            box.add_child(this.makeEditorLabel(`${status}: ${tags}`, 'todo-editor-message'));
        }
        const message = this.makeEditorLabel('', 'todo-editor-message');
        message.visible = false;
        const report = error => {
            if (error !== null) {
                message.text = error;
                message.visible = true;
            }
        };
        const save = resolveDuplicates => {
            const input = getValue();
            if (input.error) {
                report(input.error);
                return;
            }
            const {value, companion = []} = typeof input === 'string' ? {value: input} : input;
            if (!value && !isNew) {
                report(values.length > 0
                    ? 'Enter a value, or use Clear to remove the tag.' : `Enter a ${label.toLowerCase()}.`);
                return;
            }
            report(onSave(value ? [...companion, {key, value, resolveDuplicates}] : undefined));
        };
        const submitQuick = () => {
            if (duplicates) {
                report('Use Replace all or Clear all to repair these tags.');
            } else {
                save(false);
            }
        };
        const options = {
            key, box, values, getRaw, rawEntry, onEntryReturn,
            onSubmit: submitQuick,
            makeEntry: this.makeEditorEntry.bind(this),
            makeLabel: (text, styleClass = 'todo-editor-message') => this.makeEditorLabel(text, styleClass),
            makeButton: editorButton,
        };
        const makeInputs = {
            notify: makeReminderInputs,
            repeat: makeRepeatInputs,
        }[key] ?? this.makeDateInputs;
        const {entry, getValue} = makeInputs(options);

        const actions = new St.BoxLayout({style_class: 'todo-editor-actions'});
        actions.add_child(editorButton(duplicates ? 'Replace all' : 'Save',
            () => save(duplicates), duplicates ? `Replace all ${key} tags` : `Save ${label.toLowerCase()}`));
        if (values.length > 0) {
            actions.add_child(editorButton(duplicates ? 'Clear all' : 'Clear',
                () => report(onSave({key, value: null, resolveDuplicates: duplicates})),
                duplicates ? `Clear all ${key} tags` : `Clear ${label.toLowerCase()}`));
        }
        actions.add_child(editorButton('Cancel', onCancel, `Cancel ${label.toLowerCase()} edit`));
        box.add_child(actions);
        box.add_child(message);
        return {box, entry, submitQuick};
    }

    makeTaskEditor(raw, hint, onSave, isNew = false) {
        const {row, box} = this.makeEditor();
        const entry = this.makeEditorEntry(isNew ? 'New task title' : 'Task text', hint, raw);
        box.add_child(entry);

        const message = this.makeEditorLabel('', 'todo-editor-message');
        message.visible = false;
        const disclosure = new St.BoxLayout({style_class: 'todo-editor-actions'});
        let controls = null;
        for (const [key, label] of Object.entries(TAG_LABELS)) {
            disclosure.add_child(editorButton(label, () => {
                controls = this.makeTagControls(key, () => entry.get_text(),
                    request => onSave(entry.get_text(), request), () => {
                        const editorBox = controls.box;
                        controls = null;
                        editorBox.destroy();
                        disclosure.visible = true;
                        entry.grab_key_focus();
                    }, isNew, entry);
                disclosure.visible = false;
                message.visible = false;
                box.add_child(controls.box);
                controls.entry.grab_key_focus();
            }));
        }
        box.add_child(disclosure);
        box.add_child(message);
        onEntryReturn(entry, () => {
            if (controls) {
                controls.submitQuick();
                return;
            }
            const error = onSave(entry.get_text());
            if (error !== null) {
                message.text = error;
                message.visible = true;
            }
        });
        return {row, entry};
    }

    makeEditRow(task, snapshot) {
        // Prefilling raw text preserves Markdown tags during a task text edit.
        return this.makeTaskEditor(task.raw, 'Task text',
            (text, request) => this._onFinishEditing(text, task, snapshot, request));
    }

    makeAddRow(categoryName, snapshot) {
        return this.makeTaskEditor('', `Add to "${categoryName}"…`,
            (text, request) => this._onAddTask(text, categoryName, snapshot, request), true);
    }

    makeTagEditRow(task, snapshot, key) {
        const {row, box} = this.makeEditor();
        if (task.text) {
            box.add_child(this.makeEditorLabel(task.text, 'todo-text'));
        }
        const {box: controls, entry} = this.makeTagControls(key, () => task.raw,
            request => this._onFinishEditing(task.raw, task, snapshot, request),
            () => this._onCancelEditing(task.index));
        box.add_child(controls);
        return {row, entry};
    }
}
