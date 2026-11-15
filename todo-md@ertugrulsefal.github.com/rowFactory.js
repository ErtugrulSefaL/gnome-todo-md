import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';

// Cap an actor's width to the `menu-width` setting (also used by extension.js).
export function capWidth(actor, menuWidth) {
    actor.set_style(`max-width: ${menuWidth}px;`);
}

// Row builders: task rows, inline add/edit entries.
// Callbacks are injected; this module keeps no extension state.
export class RowFactory {
    constructor({menuWidth, onToggle, onEdit, onDelete, onMove, onDragBegin,
        onDragEnd, onDrop, onAddTask, onFinishEditing}) {
        this._menuWidth = menuWidth;
        this._onToggle = onToggle;
        this._onEdit = onEdit;
        this._onDelete = onDelete;
        this._onMove = onMove;
        this._onDragBegin = onDragBegin;
        this._onDragEnd = onDragEnd;
        this._onDrop = onDrop;
        this._onAddTask = onAddTask;
        this._onFinishEditing = onFinishEditing;
    }

    // The drag handle is an St.Button: it consumes press/release, so a click on
    // it never reaches the row's activate.
    makeTaskRow(task, categoryName, colors) {
        const index = task.index;
        const row = new PopupMenu.PopupBaseMenuItem();
        // The Shell hands back actors during a drag, so the row carries its identity.
        row._todoIndex = index;
        row._todoCategory = categoryName;
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
        row.add_child(checkBox);

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

        row.add_child(label);
        row.add_child(editBtn);
        row.add_child(delBtn);
        row.add_child(handle);

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

    // Cap to menu-width: typing must not widen the menu.
    capWidth(actor) {
        capWidth(actor, this._menuWidth);
    }

    // Escape is intercepted by the menu manager in the capture phase (it closes
    // the menu); the open-state-changed invariant then discards the edit.
    makeEditRow(task) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const entry = new St.Entry({style_class: 'todo-edit-entry'});
        // `raw` (tags included): committing rewrites the whole line.
        entry.set_text(task.raw);
        entry.set_x_expand(true);
        this.capWidth(entry);
        entry.connect('key-release-event', (e, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return) {
                this._onFinishEditing(e.get_text());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
    }

    // Inline add row for a category.
    makeAddRow(categoryName) {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            hint_text: `Add to "${categoryName}"…`,
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        this.capWidth(entry);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                this._onAddTask(e.get_text(), categoryName);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
    }
}
