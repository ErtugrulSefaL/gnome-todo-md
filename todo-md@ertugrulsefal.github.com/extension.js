import St from 'gi://St';
import GLib from 'gi://GLib';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import {TodoFile} from './fileSync.js';
import {TaskActions} from './taskActions.js';
import {CategoryPanel} from './categoryPanel.js';
import {DragDrop} from './dragDrop.js';
import {MenuView} from './menuView.js';
import {RowFactory} from './rowFactory.js';

export default class TodoExtension extends Extension {
    enable() {
        this._openIdleId = 0;

        // The schema id comes from metadata.json.
        this._settings = this.getSettings();
        this._file = new TodoFile(
            () => this._settings.get_string('todo-file-path'));
        this._tasks = new TaskActions(this);
        this._panel = new CategoryPanel(this);
        this._dnd = new DragDrop(this);
        this._menu = new MenuView(this);
        // Single-interaction invariant; the instance survives disable/enable.
        this._closeInteractions();
        // Live-rewire: when the configured path changes, watch the new file.
        this._settingsSignal = this._settings.connect('changed::todo-file-path',
            () => {
                this._closeInteractions();
                this._file.unwatch();
                this._file.watch(() => this._loadTodo());
                // The new path is not in the cache: clear and read.
                this._file.clear();
                this._loadTodo();
                this._menu.refreshTodoMenu();
            });
        // prefs writes the colour map live.
        this._colorSignal = this._settings.connect('changed::category-colors',
            () => {
                this._menu.refreshTodoMenu();
            });
        // The inline max-height/min-width follow the setting.
        this._heightSignal = this._settings.connect('changed::max-menu-height',
            () => {
                if (this._scrollWrapper) {
                    this._scrollWrapper.set_style(
                        `max-height: ${this._settings.get_int('max-menu-height')}px;`
                        + ` min-width: ${this._settings.get_int('menu-width')}px;`);
                }
            });
        // The menu box forces the width; the tab scroller its min/max pair.
        this._widthSignal = this._settings.connect('changed::menu-width',
            () => {
                const w = this._settings.get_int('menu-width');
                if (this._indicator) {
                    this._indicator.menu.box.set_style(
                        `width: ${w}px; max-width: ${w}px;`);
                }
                if (this._scrollWrapper) {
                    this._scrollWrapper.set_style(
                        `max-height: ${this._settings.get_int('max-menu-height')}px;`
                        + ` min-width: ${w}px;`);
                }
                this._menu.refreshTodoMenu();
            });

        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        const icon = new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        // Refresh on open; the idle lets the open transition finish first —
        // clearing items during it breaks the layout.
        this._openSignal = this._indicator.menu.connect('open-state-changed',
            (_menu, open) => {
                if (open) {
                    // Re-read in the background; the callback refreshes, and an
                    // interaction just opened survives it.
                    this._loadTodo({closeInteractions: false});
                    // GLib.idle_add takes (priority, func); the id is kept so
                    // disable() can cancel a pending idle.
                    if (this._openIdleId) {
                        GLib.Source.remove(this._openIdleId);
                    }
                    this._openIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._openIdleId = 0;
                        this._menu.refreshTodoMenu();
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    // Closed: no interaction may survive into the next open.
                    this._closeInteractions();
                    this._focusIndex = -1;
                }
            });

        // The actions are injected so rowFactory.js keeps no extension state.
        this._rowFactory = new RowFactory({
            menuWidth: this._settings.get_int('menu-width'),
            onToggle: index => this._tasks.toggleTask(index),
            onEdit: index => this._tasks.startEditing(index),
            onEditDue: (index, snapshot) => this._tasks.startDueEditing(index, snapshot),
            onDelete: index => this._tasks.deleteTask(index),
            onMove: (index, categoryName, direction) =>
                this._dnd.moveTask(index, categoryName, direction),
            onDragBegin: (index, categoryName) => this._dnd.onDragBegin(index, categoryName),
            onDragEnd: () => this._dnd.onDragEnd(),
            onDrop: (toIndex, toCategory) => this._dnd.onDrop(toIndex, toCategory),
            onAddTask: (text, categoryName, snapshot, request) =>
                this._tasks.addTask(text, categoryName, snapshot, request),
            onFinishEditing: (text, task, snapshot, request) =>
                this._tasks.finishEditing(text, task, snapshot, request),
            onCancelEditing: index => {
                this._focusIndex = index;
                this._tasks.cancelEditing();
            },
        });

        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // The insertion line must exist before _applyColorScheme() tags it.
        this._dragging = null;
        this._focusIndex = -1;
        this._autoscrollId = 0;
        this._dnd.setupDragAndDrop();

        // Theme-dependent colours follow the shell's colour scheme.
        this._applyColorScheme();
        this._colorSchemeSignal = St.Settings.get().connect(
            'notify::color-scheme', () => this._applyColorScheme());

        // Watch the file so external edits appear live, without a reload.
        this._file.watch(() => this._loadTodo());

        // Read first so the pre-fill shows the placeholder row.
        this._loadTodo();

        // GNOME Shell does not show an empty popup menu, so pre-fill it.
        this._menu.refreshTodoMenu();
    }

    // St has no `currentColor`, so a hard-coded colour is invisible in one
    // theme; stylesheet.css scopes every theme colour under `.todo-dark` /
    // `.todo-light`, and the scheme decides which class the menu box carries.
    _applyColorScheme() {
        if (!this._indicator) {
            return;
        }
        const box = this._indicator.menu.box;
        const dark = St.Settings.get().color_scheme
            === St.SystemColorScheme.PREFER_DARK;
        box.remove_style_class_name('todo-light');
        box.remove_style_class_name('todo-dark');
        box.add_style_class_name(dark ? 'todo-dark' : 'todo-light');
        // The drag actors live on Main.uiGroup, not menu.box, so they carry the
        // scheme class directly.
        for (const actor of [this._dropLine, this._tabDropLine, this._dragHint]) {
            if (!actor) {
                continue;
            }
            actor.remove_style_class_name('todo-light');
            actor.remove_style_class_name('todo-dark');
            actor.add_style_class_name(dark ? 'todo-dark' : 'todo-light');
        }
    }

    disable() {
        this._file.unwatch();
        // Every main loop source must go, even one already returning SOURCE_REMOVE.
        if (this._openIdleId) {
            GLib.Source.remove(this._openIdleId);
            this._openIdleId = 0;
        }
        if (this._settingsSignal) {
            this._settings.disconnect(this._settingsSignal);
            this._settingsSignal = null;
        }
        if (this._colorSignal) {
            this._settings.disconnect(this._colorSignal);
            this._colorSignal = null;
        }
        if (this._heightSignal) {
            this._settings.disconnect(this._heightSignal);
            this._heightSignal = null;
        }
        if (this._widthSignal) {
            this._settings.disconnect(this._widthSignal);
            this._widthSignal = null;
        }
        // St.Settings is a shell singleton; our handler must go with us.
        if (this._colorSchemeSignal) {
            St.Settings.get().disconnect(this._colorSchemeSignal);
            this._colorSchemeSignal = null;
        }
        // The drag monitor is a Shell-global list; the insertion lines and the
        // hint are our own actors on Main.uiGroup.
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._dragging = null;
        this._dnd.stopAutoScroll();
        if (this._dropLine) {
            this._dropLine.destroy();
            this._dropLine = null;
        }
        if (this._tabDropLine) {
            this._tabDropLine.destroy();
            this._tabDropLine = null;
        }
        if (this._dragHint) {
            this._dragHint.destroy();
            this._dragHint = null;
        }
        // Children before owners: the popup's destroy() tears down its subtree.
        if (this._actionsDeleteItem) {
            this._actionsDeleteItem.destroy();
            this._actionsDeleteItem = null;
        }
        if (this._colorRow) {
            this._colorRow.destroy();
            this._colorRow = null;
        }
        // The PopupSubMenu owns a Main.sessionMode connection, so it goes before
        // the content section that holds its actor.
        if (this._actions) {
            this._actions.destroy();
            this._actions = null;
            this._actionsItems = null;
            this._swatches = null;
            this._colorPickerOpen = false;
        }
        if (this._contentSection) {
            this._contentSection.destroy();
            this._contentSection = null;
        }
        if (this._scrollWrapper) {
            this._scrollWrapper.destroy();
            this._scrollWrapper = null;
        }
        if (this._tabBar) {
            this._tabBar.bar.destroy();
            this._tabBar = null;
        }
        if (this._indicator) {
            this._indicator.menu.disconnect(this._openSignal);
            this._indicator.destroy();
            this._indicator = null;
        }
        this._settings = null;
    }

    _loadTodo({closeInteractions = true} = {}) {
        this._file.load(() => {
            if (!this._indicator) {
                return;
            }
            if (closeInteractions) {
                this._closeInteractions();
            }
            this._menu.refreshTodoMenu();
        });
    }

    _closeInteractions() {
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        this._renamingCategory = null;
        this._actionsCategory = null;
        this._editingDueOnly = false;
        this._panel.hide();
    }

}
