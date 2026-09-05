import St from 'gi://St';
import GLib from 'gi://GLib';

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
    }

    disable() {
        this._indicator.menu.disconnect(this._openSignal);
        this._indicator?.destroy();
        this._indicator = null;
    }

    /**
     * Rebuild the menu items from the current ~/todo.md content.
     */
    _refreshTodoMenu() {
        const menu = this._indicator.menu;
        menu.removeAll();

        const {tasks} = Storage.readTodo();
        if (tasks.length === 0) {
            menu.addAction('No tasks', () => {});
            return;
        }

        for (const task of tasks) {
            const item = new PopupMenu.PopupMenuItem(task.text);
            if (task.done) {
                item.setOrnament(PopupMenu.Ornament.CHECK);
            }
            const index = task.index;
            item.connect('activate', () => {
                this._toggleTask(index);
            });
            menu.addMenuItem(item);
        }
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
}