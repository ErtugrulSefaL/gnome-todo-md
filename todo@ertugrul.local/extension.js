import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';

export default class TodoExtension extends Extension {
    enable() {
        // Single-edit invariant: at most one row is being edited at any time.
        // Reset on enable — the Extension instance survives disable/enable.
        this._editingIndex = -1;

        // Create a panel button.
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Add an icon to the panel button.
        const icon = new St.Icon({
            icon_name: 'list-add-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        // Refresh the list when the menu opens so external edits show up.
        // Delay via GLib.idle_add so the menu opens first, then gets filled,
        // avoiding layout issues from clearing items during the open transition.
        this._openSignal = this._indicator.menu.connect('open-state-changed',
            (menu, open) => {
                if (open) {
                    GLib.idle_add(() => {
                        this._refreshTodoMenu();
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    // Menu closed: an uncommitted edit must not survive.
                    this._editingIndex = -1;
                }
            });

        // Add the indicator to the panel.
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Pre-fill the menu so it is not empty on first open (an empty popup
        // menu will not be shown by GNOME Shell).
        this._refreshTodoMenu();

        // Watch ~/todo.md so externally-added tasks appear live, without
        // needing a Shell reload.
        this._todoMonitor = Gio.File.new_for_path(Storage.todoPath())
            .monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitorSignal = this._todoMonitor.connect('changed', () => {
            // Any file write (external or our own) may shift line indexes, so
            // an in-progress edit cannot be trusted: close it (single-edit
            // rule) and rebuild.
            this._editingIndex = -1;
            this._refreshTodoMenu();
        });
    }

    disable() {
        if (this._todoMonitor) {
            this._todoMonitor.disconnect(this._monitorSignal);
            this._todoMonitor.cancel();
            this._todoMonitor = null;
        }
        if (this._indicator) {
            this._indicator.menu.disconnect(this._openSignal);
            this._indicator.destroy();
            this._indicator = null;
        }
    }

    /**
     * Rebuild the menu items from the current ~/todo.md content.
     */
    _refreshTodoMenu() {
        const menu = this._indicator.menu;
        menu.removeAll();

        const {tasks} = Storage.readTodo();

        // Add-task entry pinned at the top.
        this._addEntry = new St.Entry({
            hint_text: 'Add a task…',
            can_focus: true,
        });
        // Let the entry expand with the menu width instead of a fixed 220px.
        this._addEntry.set_x_expand(true);
        this._addEntry.connect('key-release-event', (entry, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                this._addTask(entry.get_text());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        // Focusing the add entry means the user left any edit: close it
        // (single-edit rule). Guarded so focus does not re-trigger a rebuild.
        this._addEntry.connect('key-focus-in', () => {
            if (this._editingIndex !== -1) {
                this._cancelEditing();
            }
        });

        // Wrap the entry in a menu item so it lays out like other rows.
        const entryItem = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        entryItem.add_child(this._addEntry);
        menu.addMenuItem(entryItem);

        if (tasks.length === 0) {
            // Non-reactive: the row must not look clickable.
            menu.addMenuItem(new PopupMenu.PopupMenuItem('No tasks', {reactive: false}));
            return;
        }

        for (const task of tasks) {
            // The row being edited renders as an inline entry instead of the
            // usual label + buttons. Render derives solely from _editingIndex,
            // so two open editors can never coexist.
            if (task.index === this._editingIndex) {
                menu.addMenuItem(this._makeEditRow(task));
                continue;
            }

            const row = new PopupMenu.PopupBaseMenuItem();
            const label = new St.Label({
                text: task.text,
                style_class: task.done ? 'todo-text todo-done' : 'todo-text',
            });
            if (task.done) {
                row.setOrnament(PopupMenu.Ornament.CHECK);
                // Fade completed rows via actor opacity (CSS opacity is not
                // reliably honored by St.Label); 0.6 * 255.
                label.opacity = 153;
            }

            // Delete button pinned to the right of the task text.
            const delBtn = new St.Button({
                style_class: 'todo-icon-button button',
                child: new St.Icon({
                    icon_name: 'user-trash-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            const index = task.index;
            delBtn.connect('clicked', () => {
                this._deleteTask(index);
            });

            // Edit button next to delete: switches the row into an inline
            // entry. St.Button consumes its press/release (st-button.c returns
            // TRUE), so the row's activate (toggle) never fires.
            const editBtn = new St.Button({
                style_class: 'todo-icon-button button',
                child: new St.Icon({
                    icon_name: 'document-edit-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            editBtn.connect('clicked', () => {
                this._startEditing(index);
            });

            // Let the label grow so the buttons pin to the far right.
            // (Clutter uses x_expand, not GTK's hexpand.)
            label.set_x_expand(true);
            label.set_x_align(Clutter.ActorAlign.START);
            editBtn.set_x_align(Clutter.ActorAlign.END);
            delBtn.set_x_align(Clutter.ActorAlign.END);

            row.add_child(label);
            row.add_child(editBtn);
            row.add_child(delBtn);

            row.connect('activate', () => {
                this._toggleTask(index);
            });
            menu.addMenuItem(row);
        }
    }

    /**
     * Switch a row into inline edit mode. Replaces any existing edit
     * (single-edit rule: render derives solely from _editingIndex).
     *
     * @param {number} index - 0-based line index of the task to edit.
     */
    _startEditing(index) {
        this._editingIndex = index;
        this._refreshTodoMenu();
    }

    /**
     * Close the current edit without writing anything.
     */
    _cancelEditing() {
        this._editingIndex = -1;
        this._refreshTodoMenu();
    }

    /**
     * Commit the inline edit via Storage.editTask and close it.
     *
     * @param {string} text - New task text (empty/whitespace cancels the edit).
     */
    _finishEditing(text) {
        const trimmed = text ? text.trim() : '';
        if (!trimmed) {
            // Never wipe a task with an empty edit; treat it as cancel.
            this._cancelEditing();
            return;
        }
        const parsed = Storage.readTodo();
        const updated = Storage.editTask(parsed.raw, this._editingIndex, trimmed);
        Storage.writeTodo(updated);
        this._editingIndex = -1;
        this._refreshTodoMenu();
    }

    /**
     * Build the inline edit row: an entry prefilled with the current text.
     * Enter commits, Escape cancels.
     *
     * @param {object} task - Parsed task line ({index, text, done}).
     * @returns {PopupMenu.PopupBaseMenuItem} The edit row.
     */
    _makeEditRow(task) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const entry = new St.Entry({style_class: 'todo-edit-entry'});
        entry.set_text(task.text);
        entry.set_x_expand(true);
        entry.connect('key-release-event', (e, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return) {
                this._finishEditing(e.get_text());
                return Clutter.EVENT_STOP;
            }
            if (symbol === Clutter.KEY_Escape) {
                this._cancelEditing();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return row;
    }

    /**
     * Add a task to the end of ~/todo.md and refresh the menu.
     *
     * @param {string} text - Task text to add.
     */
    _addTask(text) {
        if (!text || !text.trim()) {
            return;
        }

        this._editingIndex = -1;
        const parsed = Storage.readTodo();
        const updated = Storage.addTask(parsed.raw, text.trim());
        Storage.writeTodo(updated);
        this._addEntry.set_text('');
        this._refreshTodoMenu();
    }

    /**
     * Toggle a task's checkbox state, persist and refresh.
     *
     * @param {number} index - 0-based line index of the task.
     */
    _toggleTask(index) {
        this._editingIndex = -1;
        const parsed = Storage.readTodo();
        const updated = Storage.toggleTask(parsed.raw, index);
        Storage.writeTodo(updated);
        this._refreshTodoMenu();
    }

    /**
     * Delete a task line and refresh the menu.
     *
     * @param {number} index - 0-based line index of the task.
     */
    _deleteTask(index) {
        this._editingIndex = -1;
        const parsed = Storage.readTodo();
        const updated = Storage.deleteTask(parsed.raw, index);
        Storage.writeTodo(updated);
        this._refreshTodoMenu();
    }
}