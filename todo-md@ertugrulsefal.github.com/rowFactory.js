import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';

/**
 * Cap an actor's width to the `menu-width` setting.
 *
 * Exported as a plain function as well as used through the factory: the
 * new-category entry lives in extension.js (it is a workflow — validate, write,
 * colour, switch tab — not a row builder) and needs the same cap.
 *
 */
export function capWidth(actor, menuWidth) {
    actor.set_style(`max-width: ${menuWidth}px;`);
}

/**
 * Row builders: task rows, the inline add/edit entries, and the width cap.
 *
 * WHY A SEPARATE MODULE (EGO best practices): a row is one stateless actor
 * tree, and it is where the roadmap's colour-control and drag-and-drop
 * features land. The menu width and the actions are injected by extension.js;
 * this module stays free of the extension's private fields.
 *
 * NOT here, on purpose: `_makeNewCategoryRow`. That entry is a workflow, not a
 * row — validate the name, write the file, assign the auto-colour, switch tab —
 * and it carries the rejected-name and failed-write guards. Moving it here
 * would scatter the most heavily guarded code in the project.
 */
export class RowFactory {
    constructor({menuWidth, onToggle, onEdit, onDelete, onMove,
        onAddTask, onFinishEditing}) {
        this._menuWidth = menuWidth;
        this._onToggle = onToggle;
        this._onEdit = onEdit;
        this._onDelete = onDelete;
        this._onMove = onMove;
        this._onAddTask = onAddTask;
        this._onFinishEditing = onFinishEditing;
    }

    /**
     * Build a clickable task row: label (strikethrough + fade when done),
     * move up/down buttons, and edit + delete buttons pinned to the right.
     *
     */
    makeTaskRow(task, isFirst, isLast, categoryName, colors) {
        const index = task.index;
        const row = new PopupMenu.PopupBaseMenuItem();
        const label = new St.Label({
            text: task.text,
            style_class: task.done ? 'todo-text todo-done' : 'todo-text',
        });
        // Fixed behavior (deliberately NOT user-configurable):
        // long task texts truncate with an ellipsis instead of widening the
        // menu. The full text stays reachable via the row's edit button.
        // Width from GSettings menu-width (inline style; CSS max-width
        // + Pango.EllipsizeMode.END = the constrained-width pattern).
        label.set_style(
            `max-width: ${this._menuWidth}px;`);
        label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);

        // Accessibility (audit D8): a task row is a checkable menu item, so
        // tell assistive technology what it is and whether it is done.
        // PopupBaseMenuItem defaults to Atk.Role.MENU_ITEM and has no
        // checkAccessibleState() (that lives on PopupSwitchMenuItem), so the
        // CHECKED state is maintained here — the row is rebuilt on every
        // refresh, which keeps it in sync with `task.done`.
        row.accessible_role = Atk.Role.CHECK_MENU_ITEM;
        row.label_actor = label;
        if (task.done) {
            row.add_accessible_state(Atk.StateType.CHECKED);
        }
        // Fixed-width checkbox area at the START of every row:
        // the check never appends to the text, so checking a task can
        // never widen the menu). A 16x16 circle in BOTH states: empty
        // outline when pending, filled with the CATEGORY COLOR and a
        // white check when done (St.Bin centers the child; St.Widget has
        // no layout, which is why the check drifted — user test).
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
            // Category color fill (validated hex only — same guard as the
            // inline header colors).
            checkBox.set_style(
                `background-color: ${hexColor}; border-color: transparent;`);
        }
        row.add_child(checkBox);

        if (task.done) {
            // Fade completed rows via actor opacity (CSS opacity is not
            // reliably honored by St.Label); 0.6 * 255.
            label.opacity = 153;
        }

        // Move up/down within the category (locked: no cross-category moves).
        // ALWAYS created and allocated (go-up/go-down-symbolic verified in
        // the local Adwaita icon theme) but INSENSITIVE at the category's
        // edges: rows must keep a constant button area so every task line
        // ends at the same x position regardless of its position (user
        // test: rows at the edges had different widths).
        const upBtn = new St.Button({
            style_class: 'todo-icon-button button',
            // Icon-only button: without this a screen reader announces
            // "button" with no name (audit D8).
            accessible_name: 'Move up',
            child: new St.Icon({
                icon_name: 'go-up-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        upBtn.set_reactive(!isFirst);
        if (isFirst) {
            upBtn.set_style('opacity: 0.4;');
        }
        upBtn.connect('clicked', () => {
            this._onMove(index, 'up');
        });
        const downBtn = new St.Button({
            style_class: 'todo-icon-button button',
            // Icon-only button: without this a screen reader announces
            // "button" with no name (audit D8).
            accessible_name: 'Move down',
            child: new St.Icon({
                icon_name: 'go-down-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        downBtn.set_reactive(!isLast);
        if (isLast) {
            downBtn.set_style('opacity: 0.4;');
        }
        downBtn.connect('clicked', () => {
            this._onMove(index, 'down');
        });

        // Delete button pinned to the right of the task text.
        const delBtn = new St.Button({
            style_class: 'todo-icon-button button',
            // Icon-only button: without this a screen reader announces
            // "button" with no name (audit D8).
            accessible_name: 'Delete task',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        delBtn.connect('clicked', () => {
            this._onDelete(index);
        });

        // Edit button next to delete: switches the row into an inline
        // entry. St.Button consumes its press/release (st-button.c returns
        // TRUE), so the row's activate (toggle) never fires.
        const editBtn = new St.Button({
            style_class: 'todo-icon-button button',
            // Icon-only button: without this a screen reader announces
            // "button" with no name (audit D8).
            accessible_name: 'Edit task',
            child: new St.Icon({
                icon_name: 'document-edit-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        editBtn.connect('clicked', () => {
            this._onEdit(index);
        });

        // Let the label grow so the buttons pin to the far right.
        // (Clutter uses x_expand, not GTK's hexpand.)
        label.set_x_expand(true);
        label.set_x_align(Clutter.ActorAlign.START);
        upBtn.set_x_align(Clutter.ActorAlign.END);
        downBtn.set_x_align(Clutter.ActorAlign.END);
        editBtn.set_x_align(Clutter.ActorAlign.END);
        delBtn.set_x_align(Clutter.ActorAlign.END);

        row.add_child(label);
        row.add_child(upBtn);
        row.add_child(downBtn);
        row.add_child(editBtn);
        row.add_child(delBtn);

        row.connect('activate', () => {
            this._onToggle(index);
        });
        return row;
    }

    /**
     * Constrain an actor's width to the GSettings menu-width cap
     * (fixed default + user-adjustable). Used by the inline add/edit/
     * new-category entries so a long text being typed cannot widen the
     * menu (user test: 'not ekleme sırasında ... büyüyor').
     */
    capWidth(actor) {
        capWidth(actor, this._menuWidth);
    }

    /**
     * Build the inline edit row: an entry prefilled with the current text.
     * Enter commits, Escape cancels. Note: Escape is actually intercepted by
     * the shell's MenuManager in the capture phase (popupMenu.js
     * _onCapturedEvent), so it closes the menu; the edit is then discarded by
     * the open-state-changed invariant instead.
     *
     */
    makeEditRow(task) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const entry = new St.Entry({style_class: 'todo-edit-entry'});
        // Prefill with `raw` (tags inline), NOT the tag-stripped display text:
        // committing the edit rewrites the whole line, and raw keeps the tags.
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
     * per-category hint. Enter commits via Storage.addTask(text, category).
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
