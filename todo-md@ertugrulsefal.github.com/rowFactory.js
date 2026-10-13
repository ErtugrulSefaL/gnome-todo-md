import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';

/**
 * Cap an actor's width to the `menu-width` setting. Exported because the
 * new-category entry in extension.js needs the same cap.
 *
 */
export function capWidth(actor, menuWidth) {
    actor.set_style(`max-width: ${menuWidth}px;`);
}

/**
 * Builders for the menu's rows: task rows, the inline add/edit entries and the
 * width cap. Callbacks are injected by extension.js, so this module never
 * reaches into the extension's state.
 *
 * The new-category entry stays in extension.js: it is a workflow (validate,
 * write, colour, switch tab), not a row.
 */
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

    /**
     * Build a clickable task row: label (struck through and faded when done),
     * edit and delete buttons, and the drag handle at the far right.
     *
     * Dragging starts from the handle only. The handle is an St.Button on
     * purpose: st-button.c consumes press/release, so a plain click never
     * reaches the row's activate. The Shell drags a CLONE of the row, which
     * leaves the row itself in place.
     *
     */
    makeTaskRow(task, categoryName, colors) {
        const index = task.index;
        const row = new PopupMenu.PopupBaseMenuItem();
        // The Shell hands back actors during a drag, never our model, so the
        // row carries which task it stands for.
        row._todoIndex = index;
        row._todoCategory = categoryName;
        const label = new St.Label({
            text: task.text,
            style_class: task.done ? 'todo-text todo-done' : 'todo-text',
            // The row's icon buttons are taller than the text.
            y_align: Clutter.ActorAlign.CENTER,
        });
        // Long texts truncate with an ellipsis instead of widening the menu.
        // The cap comes from the menu-width setting; CSS max-width plus
        // Pango.EllipsizeMode.END is the constrained-width pattern.
        label.set_style(
            `max-width: ${this._menuWidth}px;`);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        // A task row is a checkable menu item. PopupBaseMenuItem has no
        // checkAccessibleState() — that lives on PopupSwitchMenuItem — so the
        // CHECKED state is maintained here; the row is rebuilt on every
        // refresh, which keeps it in sync with task.done.
        row.accessible_role = Atk.Role.CHECK_MENU_ITEM;
        row.label_actor = label;
        if (task.done) {
            row.add_accessible_state(Atk.StateType.CHECKED);
        }
        // Fixed-width checkbox area at the start of every row, so checking a
        // task can never widen the menu. A 16x16 circle in both states: an
        // empty outline when pending, filled with the category colour and a
        // check icon when done (St.Bin centres the child).
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
            // Category colour fill (validated hex only).
            checkBox.set_style(
                `background-color: ${hexColor}; border-color: transparent;`);
        }
        row.add_child(checkBox);

        if (task.done) {
            // Fade completed rows via actor opacity; CSS opacity is not
            // reliably honoured by St.Label. 0.6 * 255.
            label.opacity = 153;
        }

        // Drag handle. Adwaita's grip icon is used; Yaru's
        // `drag-handle-symbolic` is not — it does not exist in Adwaita. The old
        // ↑↓ buttons are gone: the keyboard path is Alt+↑/↓ on the focused row
        // (see below).
        const handle = new St.Button({
            style_class: 'todo-icon-button todo-drag-handle button',
            // Icon-only button: without an accessible name a screen reader
            // announces just "button".
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

        // Delete button pinned to the right of the task text.
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

        // Edit button next to delete: switches the row into an inline entry.
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

        // Let the label grow so the buttons pin to the far right (Clutter
        // uses x_expand, not GTK's hexpand).
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

        // Drop target. Returning true lets the Shell finish the drag (destroy
        // the drag actor, pop the modal grab, emit drag-end); false makes it
        // walk up the tree and snap the row back. A drop on another category
        // is rejected by the extension.
        row.acceptDrop = () => this._onDrop(index, categoryName) === true;

        // Keyboard path: Alt+↑/↓ on the focused row. The row's own key handler
        // ignores any press with a modifier held, so the event reaches us.
        row.connect('key-press-event', (actor, event) => {
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

    /**
     * Constrain an actor to the menu-width cap, so a long text being typed
     * cannot widen the menu.
     */
    capWidth(actor) {
        capWidth(actor, this._menuWidth);
    }

    /**
     * Build the inline edit row: an entry prefilled with the current text.
     * Enter commits. Escape is intercepted by the Shell's menu manager in the
     * capture phase, which closes the menu; the edit is then discarded by the
     * open-state-changed invariant.
     *
     */
    makeEditRow(task) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const entry = new St.Entry({style_class: 'todo-edit-entry'});
        // Prefill with `raw`, tags included: committing rewrites the whole
        // line, and raw is what keeps the tags.
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

    /**
     * Build the inline add row for a category: an empty entry with a
     * per-category hint. Enter commits.
     *
     */
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
