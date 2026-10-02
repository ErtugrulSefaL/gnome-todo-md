import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';
import Atk from 'gi://Atk';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';

/**
 * Task rows: the label plus its move / edit / delete controls.
 *
 * WHY A SEPARATE MODULE (audit A1, EGO best practices "Modules are Better Than
 * a Single File"): a row is one actor tree with no state of its own, and it is
 * where roadmap features #1 (a colour control in the category header) and #2
 * (drag-and-drop reordering) land.
 *
 * The factory holds no state of its own: the menu width and the five actions
 * are injected by extension.js, so this module stays free of the extension's
 * private fields. Everything inside the class was moved verbatim from
 * `_makeTaskRow()`; only the six `this.<action>(…)` calls were repointed at the
 * injected callbacks and the method lost its leading underscore.
 */
export class RowFactory {
    /**
     * @param {object} options - Injected dependencies.
     * @param {number} options.menuWidth - `menu-width` setting in px; caps the
     *   label so a long task text cannot widen the menu.
     * @param {Function} options.onToggle - Called with the task index.
     * @param {Function} options.onEdit - Called with the task index.
     * @param {Function} options.onDelete - Called with the task index.
     * @param {Function} options.onMove - Called with (index, 'up'|'down').
     */
    constructor({menuWidth, onToggle, onEdit, onDelete, onMove}) {
        this._menuWidth = menuWidth;
        this._onToggle = onToggle;
        this._onEdit = onEdit;
        this._onDelete = onDelete;
        this._onMove = onMove;
    }

    /**
     * Build a clickable task row: label (strikethrough + fade when done),
     * move up/down buttons, and edit + delete buttons pinned to the right.
     *
     * @param {object} task - Document task item ({index, raw, done, tags, text}).
     * @param {boolean} isFirst - True when the task is first in its category
     *   (the up button is hidden at the category's top edge).
     * @param {boolean} isLast - True when the task is last in its category
     *   (the down button is hidden at the category's bottom edge).
     * @returns {PopupMenu.PopupBaseMenuItem} The task row.
     */
    makeTaskRow(task, isFirst, isLast, categoryName, colors) {
        const index = task.index;
        const row = new PopupMenu.PopupBaseMenuItem();
        const label = new St.Label({
            text: task.text,
            style_class: task.done ? 'todo-text todo-done' : 'todo-text',
        });
        // Fixed behavior (Faz 6.6 decision: A is NOT user-configurable):
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
        // Fixed-width checkbox area at the START of every row (Faz 6.6:
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
}
