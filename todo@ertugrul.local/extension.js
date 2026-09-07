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
            // Rebuild whenever the file changes. Refreshing while closed is
            // harmless (the next open shows fresh data) and avoids any
            // dependence on menu isOpen state for live updates.
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
        this._addEntry.set_width(220);
        this._addEntry.connect('key-release-event', (entry, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                this._addTask(entry.get_text());
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
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
                style_class: 'todo-delete-button button',
                child: new St.Icon({
                    icon_name: 'user-trash-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            const index = task.index;
            delBtn.connect('clicked', () => {
                this._deleteTask(index);
            });

            // Let the label grow so the delete button pins to the far right.
            // (Clutter uses x_expand, not GTK's hexpand.)
            label.set_x_expand(true);
            label.set_x_align(Clutter.ActorAlign.START);
            delBtn.set_x_align(Clutter.ActorAlign.END);

            row.add_child(label);
            row.add_child(delBtn);

            row.connect('activate', () => {
                this._toggleTask(index);
            });
            menu.addMenuItem(row);
        }
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
        const parsed = Storage.readTodo();
        const updated = Storage.deleteTask(parsed.raw, index);
        Storage.writeTodo(updated);
        this._refreshTodoMenu();
    }
}