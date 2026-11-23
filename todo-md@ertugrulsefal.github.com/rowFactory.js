import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';
import {setVerticalOrientation} from './compat.js';

function dueLabel(task) {
    const {status, date} = Storage.getTaskDue(task.raw);
    if (status === 'absent') {
        return null;
    }
    if (status === 'invalid') {
        return 'Invalid due date';
    }
    if (status === 'duplicate') {
        return 'Multiple due tags';
    }
    if (task.done) {
        return `Due ${date}`;
    }

    // Compare calendar dates as UTC midnights so DST does not change the day count.
    const today = new Date();
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate());
    const days = (Date.parse(`${date}T00:00:00Z`) - todayDay) / 86_400_000;
    if (days < 0) {
        return `Overdue · ${date}`;
    }
    if (days === 0) {
        return `Due today · ${date}`;
    }
    if (days === 1) {
        return `Due tomorrow · ${date}`;
    }
    return days <= 7 ? `Due in ${days} days · ${date}` : `Due ${date}`;
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
    constructor({menuWidth, onToggle, onEdit, onEditDue, onDelete, onMove, onDragBegin,
        onDragEnd, onDrop, onAddTask, onFinishEditing, onCancelEditing}) {
        this._menuWidth = menuWidth;
        this._onToggle = onToggle;
        this._onEdit = onEdit;
        this._onEditDue = onEditDue;
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
        const due = dueLabel(task);
        const firstLine = due ? this.makeDueLines(row, due, task, snapshot) : row;
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
        draggable.connect('drag-begin', () => this._onDragBegin(index, categoryName));
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
            this._onDelete(index);
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
            this._onToggle(index);
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
                symbol === Clutter.KEY_Up ? 'up' : 'down');
            return Clutter.EVENT_STOP;
        });
        return row;
    }

    makeDueLines(row, due, task, snapshot) {
        const lines = new St.BoxLayout({x_expand: true});
        setVerticalOrientation(lines, Clutter.Orientation.VERTICAL);
        const firstLine = new St.BoxLayout({style_class: 'todo-task-first-line'});
        const detail = new St.Label({
            text: due,
        });
        const button = new St.Button({
            child: detail,
            style_class: 'todo-task-due',
            x_align: Clutter.ActorAlign.START,
            can_focus: true,
            accessible_name: `Edit due date: ${due}`,
        });
        button.connect('clicked', () => this._onEditDue(task.index, snapshot));
        // St skips the children of a widget that is itself focusable.
        const modifiers = Clutter.ModifierType.MODIFIER_MASK
            & ~(Clutter.ModifierType.LOCK_MASK | Clutter.ModifierType.MOD2_MASK);
        row.connect('key-press-event', (_actor, event) => {
            if (row.has_key_focus() && event.get_key_symbol() === Clutter.KEY_Tab
                && (event.get_state() & modifiers) === 0) {
                button.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        button.connect('key-press-event', (_actor, event) => {
            const key = event.get_key_symbol();
            const state = event.get_state() & modifiers;
            const backwards = (key === Clutter.KEY_Tab && state === Clutter.ModifierType.SHIFT_MASK)
                || (key === Clutter.KEY_ISO_Left_Tab
                    && (state === 0 || state === Clutter.ModifierType.SHIFT_MASK));
            if (backwards) {
                row.grab_key_focus();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        this.capWidth(detail);
        detail.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        lines.add_child(firstLine);
        lines.add_child(button);
        row.add_child(lines);
        row.get_accessible().set_description(due);
        return firstLine;
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

    makeEditorLabel(text, styleClass) {
        const label = new St.Label({text, style_class: styleClass});
        this.capWidth(label);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
        return label;
    }

    makeDueControls(raw, onSave, onCancel, isNew = false) {
        const box = new St.BoxLayout({style_class: 'todo-task-editor'});
        setVerticalOrientation(box, Clutter.Orientation.VERTICAL);
        const values = Storage.getTaskDueValues(raw);
        const duplicates = values.length > 1;
        if (duplicates || (values.length === 1 && !Storage.isDueDate(values[0]))) {
            const tags = values.map(value => `@due(${value})`).join(', ');
            const status = duplicates ? 'Multiple due tags' : 'Invalid due date';
            box.add_child(this.makeEditorLabel(`${status}: ${tags}`, 'todo-editor-message'));
        }
        const entry = new St.Entry({
            accessible_name: 'Due date',
            hint_text: 'YYYY-MM-DD',
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        this.capWidth(entry);
        if (values.length === 1 && Storage.isDueDate(values[0])) {
            entry.set_text(values[0]);
        }
        box.add_child(entry);

        const message = this.makeEditorLabel('', 'todo-editor-message');
        message.visible = false;
        const report = error => {
            if (error !== null) {
                message.text = error;
                message.visible = true;
            }
        };
        const save = resolveDuplicates => {
            const date = entry.get_text().trim();
            if (!date && !isNew) {
                report(values.length > 0
                    ? 'Enter a date, or use the clear button to remove it.'
                    : 'Enter a date in YYYY-MM-DD format.');
            } else {
                report(onSave(date ? {date, resolveDuplicates} : undefined));
            }
        };
        const submitQuick = () => {
            if (duplicates) {
                report('Use Replace all or Clear all to repair these tags.');
            } else {
                save(false);
            }
        };
        onEntryReturn(entry, submitQuick);
        const actions = new St.BoxLayout({style_class: 'todo-editor-actions'});
        actions.add_child(editorButton(duplicates ? 'Replace all' : 'Save',
            () => save(duplicates), duplicates ? 'Replace all due tags' : 'Save due date'));
        if (values.length > 0) {
            actions.add_child(editorButton(duplicates ? 'Clear all' : 'Clear',
                () => report(onSave({date: null, resolveDuplicates: duplicates})),
                duplicates ? 'Clear all due tags' : 'Clear due date'));
        }
        actions.add_child(editorButton('Cancel', onCancel, 'Cancel due date edit'));
        box.add_child(actions);
        box.add_child(message);
        return {box, entry, submitQuick};
    }

    makeTaskEditor(raw, hint, disclosureText, onSave, isNew = false) {
        const {row, box} = this.makeEditor();
        const entry = new St.Entry({
            hint_text: hint,
            accessible_name: isNew ? 'New task title' : 'Task text',
            style_class: 'todo-edit-entry',
        });
        entry.set_text(raw);
        entry.set_x_expand(true);
        this.capWidth(entry);
        box.add_child(entry);

        const message = this.makeEditorLabel('', 'todo-editor-message');
        message.visible = false;
        let due = null;
        const disclosure = editorButton(disclosureText, () => {
            due = this.makeDueControls(entry.get_text(), request => onSave(entry.get_text(), request),
                () => {
                    const controls = due.box;
                    due = null;
                    controls.destroy();
                    disclosure.visible = true;
                    entry.grab_key_focus();
                }, isNew);
            disclosure.visible = false;
            message.visible = false;
            box.add_child(due.box);
            due.entry.grab_key_focus();
        });
        disclosure.set_x_align(Clutter.ActorAlign.START);
        box.add_child(disclosure);
        box.add_child(message);
        onEntryReturn(entry, () => {
            if (due) {
                due.submitQuick();
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
        return this.makeTaskEditor(task.raw, 'Task text', 'Due date',
            (text, request) => this._onFinishEditing(text, task, snapshot, request));
    }

    makeAddRow(categoryName, snapshot) {
        return this.makeTaskEditor('', `Add to "${categoryName}"…`, 'Add tags',
            (text, request) => this._onAddTask(text, categoryName, snapshot, request), true);
    }

    makeDueEditRow(task, snapshot) {
        const {row, box} = this.makeEditor();
        if (task.text) {
            box.add_child(this.makeEditorLabel(task.text, 'todo-text'));
        }
        const {box: controls, entry} = this.makeDueControls(task.raw,
            request => this._onFinishEditing(task.raw, task, snapshot, request),
            () => this._onCancelEditing(task.index));
        box.add_child(controls);
        return {row, entry};
    }
}
