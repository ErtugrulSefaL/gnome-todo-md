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

        // GSettings backend (schema id: metadata.json settings-schema).
        this._settings = this.getSettings();
        // Live-rewire: when the configured path changes, watch the new file.
        // `changed::<key>` detail syntax per gjs.guide preferences.md.
        this._settingsSignal = this._settings.connect('changed::todo-file-path',
            () => {
                this._editingIndex = -1;
                this._unwatchTodoFile();
                this._watchTodoFile();
                this._refreshTodoMenu();
            });

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
                    // GLib.idle_add takes (priority, func). A single-argument
                    // call throws and the rebuild silently never runs.
                    GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
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
        this._watchTodoFile();
    }

    disable() {
        this._unwatchTodoFile();
        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }
        if (this._indicator) {
            this._indicator.menu.disconnect(this._openSignal);
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }

    /**
     * Watch the configured todo file for external changes. Created per
     * enable(); re-created by the settings-changed handler when the path
     * setting changes (single monitor at any time).
     */
    _watchTodoFile() {
        this._todoMonitor = Gio.File.new_for_path(this._todoPath())
            .monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitorSignal = this._todoMonitor.connect('changed', () => {
            // Any file write (external or our own) may shift line indexes, so
            // an in-progress edit cannot be trusted: close it (single-edit
            // rule) and rebuild.
            this._editingIndex = -1;
            this._refreshTodoMenu();
        });
    }

    /**
     * Disconnect the active file monitor, if any.
     */
    _unwatchTodoFile() {
        if (this._todoMonitor) {
            this._todoMonitor.disconnect(this._monitorSignal);
            this._todoMonitor.cancel();
            this._todoMonitor = null;
        }
    }

    /**
     * Resolve the todo file path from the GSettings value (empty value and
     * '~' forms fall back / expand — see Storage.resolveTodoPath).
     *
     * @returns {string} Absolute path of the todo file to use.
     */
    _todoPath() {
        return Storage.resolveTodoPath(
            this._settings.get_string('todo-file-path'));
    }

    /**
     * Rebuild the menu items from the current ~/todo.md content.
     */
    _refreshTodoMenu() {
        const menu = this._indicator.menu;
        menu.removeAll();

        const doc = Storage.parseDocument(Storage.readTodo(this._todoPath()).raw);

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
        // Cancel an in-progress edit when the add entry gains focus.
        // A mouse click moves Clutter's key focus to the INNER Clutter.Text
        // (st-entry.c wires the press to the inner text actor), so connect on
        // both the entry (keyboard navigation) and its clutter_text (clicks).
        this._addEntry.connect('key-focus-in', () => {
            if (this._editingIndex !== -1) {
                this._cancelEditing();
            }
        });
        this._addEntry.get_clutter_text().connect('key-focus-in', () => {
            if (this._editingIndex !== -1) {
                this._cancelEditing();
            }
        });

        // Wrap the entry in a menu item so it lays out like other rows.
        const entryItem = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        entryItem.add_child(this._addEntry);
        menu.addMenuItem(entryItem);

        // Categories with at least one task render as a non-clickable header
        // row followed by their task rows. Task-less categories are skipped
        // (nothing interactive to show); their extras stay in the file.
        const sections = [];
        for (const category of doc.categories) {
            const tasks = Storage.categoryTasks(category);
            if (tasks.length > 0) {
                sections.push({name: category.name, tasks});
            }
        }

        if (sections.length === 0) {
            // Non-reactive: the row must not look clickable.
            menu.addMenuItem(new PopupMenu.PopupMenuItem('No tasks', {reactive: false}));
            return;
        }

        for (const section of sections) {
            const header = new PopupMenu.PopupMenuItem(section.name,
                {reactive: false, can_focus: false});
            // PopupMenuItem exposes its St.Label (popupMenu.js 46.0 :285-298);
            // there is no first-class section-header widget in the shell.
            header.label.style_class = 'todo-category-header';
            menu.addMenuItem(header);

            const tasks = section.tasks;
            for (let ti = 0; ti < tasks.length; ti++) {
                const task = tasks[ti];
                // The row being edited renders as an inline entry instead of
                // the usual label + buttons. Render derives solely from
                // _editingIndex, so two open editors can never coexist.
                if (task.index === this._editingIndex) {
                    const editRow = this._makeEditRow(task);
                    menu.addMenuItem(editRow.row);
                    // Grab focus only after the row is on stage; an actor that
                    // is not yet mapped cannot take key focus.
                    editRow.entry.grab_key_focus();
                    continue;
                }

                menu.addMenuItem(this._makeTaskRow(task,
                    ti === 0, ti === tasks.length - 1));
            }
        }
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
    _makeTaskRow(task, isFirst, isLast) {
        const index = task.index;
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

        // Move up/down within the category (locked: no cross-category moves).
        // Hidden at the category's edges; go-up/go-down-symbolic verified in
        // the local Adwaita icon theme.
        let upBtn = null;
        let downBtn = null;
        if (!isFirst) {
            upBtn = new St.Button({
                style_class: 'todo-icon-button button',
                child: new St.Icon({
                    icon_name: 'go-up-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            upBtn.connect('clicked', () => {
                this._moveTask(index, 'up');
            });
        }
        if (!isLast) {
            downBtn = new St.Button({
                style_class: 'todo-icon-button button',
                child: new St.Icon({
                    icon_name: 'go-down-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            downBtn.connect('clicked', () => {
                this._moveTask(index, 'down');
            });
        }

        // Delete button pinned to the right of the task text.
        const delBtn = new St.Button({
            style_class: 'todo-icon-button button',
            child: new St.Icon({
                icon_name: 'user-trash-symbolic',
                style_class: 'system-status-icon',
            }),
        });
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
        if (upBtn !== null) {
            upBtn.set_x_align(Clutter.ActorAlign.END);
        }
        if (downBtn !== null) {
            downBtn.set_x_align(Clutter.ActorAlign.END);
        }
        editBtn.set_x_align(Clutter.ActorAlign.END);
        delBtn.set_x_align(Clutter.ActorAlign.END);

        row.add_child(label);
        if (upBtn !== null) {
            row.add_child(upBtn);
        }
        if (downBtn !== null) {
            row.add_child(downBtn);
        }
        row.add_child(editBtn);
        row.add_child(delBtn);

        row.connect('activate', () => {
            this._toggleTask(index);
        });
        return row;
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
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.editTask(parsed.raw, this._editingIndex, trimmed);
        Storage.writeTodo(this._todoPath(), updated);
        this._editingIndex = -1;
        this._refreshTodoMenu();
    }

    /**
     * Build the inline edit row: an entry prefilled with the current text.
     * Enter commits, Escape cancels. Note: Escape is actually intercepted by
     * the shell's MenuManager in the capture phase (popupMenu.js
     * _onCapturedEvent), so it closes the menu; the edit is then discarded by
     * the open-state-changed invariant instead.
     *
     * @param {object} task - Document task item ({index, raw, text, done, tags}).
     * @returns {{row: PopupMenu.PopupBaseMenuItem, entry: St.Entry}} The row
     *   and its entry, so the caller can grab focus after adding to the menu.
     */
    _makeEditRow(task) {
        const row = new PopupMenu.PopupBaseMenuItem({activate: false, can_focus: false});
        const entry = new St.Entry({style_class: 'todo-edit-entry'});
        // Prefill with `raw` (tags inline), NOT the tag-stripped display text:
        // committing the edit rewrites the whole line, and raw keeps the tags.
        entry.set_text(task.raw);
        entry.set_x_expand(true);
        entry.connect('key-release-event', (e, event) => {
            const symbol = event.get_key_symbol();
            if (symbol === Clutter.KEY_Return) {
                this._finishEditing(e.get_text());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
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
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.addTask(parsed.raw, text.trim());
        Storage.writeTodo(this._todoPath(), updated);
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
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.toggleTask(parsed.raw, index);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Delete a task line and refresh the menu.
     *
     * @param {number} index - 0-based line index of the task.
     */
    _deleteTask(index) {
        this._editingIndex = -1;
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.deleteTask(parsed.raw, index);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Move a task up/down within its category, persist and refresh.
     * Closing any open edit first keeps the single-edit invariant.
     *
     * @param {number} index - 0-based line index of the task.
     * @param {string} direction - 'up' or 'down'.
     */
    _moveTask(index, direction) {
        this._editingIndex = -1;
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.moveTask(parsed.raw, index, direction);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }
}