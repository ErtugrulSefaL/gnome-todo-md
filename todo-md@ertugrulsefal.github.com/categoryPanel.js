import GLib from 'gi://GLib';
import St from 'gi://St';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';
import {popupArgs} from './compat.js';

// The ⋮ category action panel and its two sub-states (delete arm, colour
// picker). The panel state lives on the extension.
export class CategoryPanel {
    constructor(ext) {
        this._ext = ext;
    }

    hide() {
        this.resetDeleteConfirm();
        if (this._ext._colorPickerOpen) {
            this._ext._colorPickerOpen = false;
            this._ext._colorRow.hide();
            for (const item of this._ext._actionsItems) {
                item.show();
            }
        }
        if (this._ext._actions && this._ext._actions.isOpen) {
            this._ext._actions.close(
                popupArgs(this._ext._actions, 'close', false));
        }
    }

    resetDeleteConfirm() {
        if (this._ext._deleteConfirming && this._ext._actionsDeleteItem) {
            this._ext._deleteConfirming = false;
            this._ext._actionsDeleteItem.label.text = 'Delete';
            this._ext._actionsDeleteItem.remove_style_class_name(
                'todo-action-confirm');
        }
    }

    makePanel() {
        const arrow = new St.Icon({icon_name: 'pan-down-symbolic'});
        arrow.visible = false;
        this._ext._actions = new PopupMenu.PopupSubMenu(null, arrow);

        const addItem = new PopupMenu.PopupMenuItem('Add task');
        addItem.connect('activate', () => {
            const target = this._ext._actionsCategory;
            this.hide();
            this._ext._tasks.toggleAdd(target);
        });

        const colorItem = new PopupMenu.PopupMenuItem('Change color');
        colorItem.connect('activate', () => this.openColorPicker());

        const renameItem = new PopupMenu.PopupMenuItem('Rename');
        renameItem.connect('activate', () => {
            const target = this._ext._actionsCategory;
            this.hide();
            this._ext._closeInteractions();
            this._ext._renamingCategory = target;
            this._ext._menu.refreshTodoMenu();
        });

        const deleteItem = new PopupMenu.PopupMenuItem('Delete');
        deleteItem.add_style_class_name('todo-action-danger');
        deleteItem.connect('activate', () => {
            const target = this._ext._actionsCategory;
            if (!this._ext._deleteConfirming) {
                this._ext._deleteConfirming = true;
                deleteItem.label.text = 'Confirm delete?';
                deleteItem.add_style_class_name('todo-action-confirm');
                return;
            }
            this.hide();
            this.deleteCategory(target);
        });
        this._ext._actionsDeleteItem = deleteItem;

        this._ext._actionsItems = [addItem, colorItem, renameItem, deleteItem];
        for (const item of this._ext._actionsItems) {
            this._ext._actions.box.add_child(item.actor);
        }
        this._ext._actions.box.add_child(this.makeColorRow());
        this._ext._actions.actor.hide();
    }

    makeColorRow() {
        const row = new St.BoxLayout({style_class: 'todo-color-row'});
        this._ext._swatches = [];
        Storage.CATEGORY_PALETTE.forEach((hex, i) => {
            const swatch = new St.Button({
                style_class: 'todo-swatch',
                toggle_mode: true,
                accessible_name: 'Set category colour to '
                    + Storage.CATEGORY_PALETTE_NAMES[i],
            });
            swatch.set_style(`background-color: ${hex};`);
            swatch.connect('clicked', () => this.applyColor(hex));
            this._ext._swatches.push({button: swatch, hex});
            row.add_child(swatch);
        });
        const none = new St.Button({
            style_class: 'todo-swatch todo-swatch-none',
            toggle_mode: true,
            accessible_name: 'Remove category colour',
            child: new St.Icon({
                icon_name: 'action-unavailable-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        none.connect('clicked', () => this.applyColor(null));
        this._ext._swatches.push({button: none, hex: null});
        row.add_child(none);
        this._ext._colorRow = row;
        row.hide();
        return row;
    }

    openColorPicker() {
        this.resetDeleteConfirm();
        this._ext._colorPickerOpen = true;
        for (const item of this._ext._actionsItems) {
            item.hide();
        }
        this.markSelectedSwatch();
        this._ext._colorRow.show();
    }

    markSelectedSwatch() {
        const colors = this._ext._settings.get_value('category-colors')
            .recursiveUnpack();
        const current = Storage.categoryColorHex(
            this._ext._actionsCategory, colors);
        for (const {button, hex} of this._ext._swatches) {
            button.set_checked(hex === current);
        }
    }

    applyColor(hex) {
        const target = this._ext._actionsCategory;
        this.hide();
        const colors = this._ext._settings.get_value('category-colors')
            .recursiveUnpack();
        const next = hex === null
            ? Storage.removeCategoryColor(colors, target)
            : Storage.setCategoryColor(colors, target, hex);
        if (next !== colors) {
            this._ext._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', next));
        }
        this._ext._menu.refreshTodoMenu();
    }

    toggleActions(categoryName) {
        if (this._ext._actionsCategory === categoryName) {
            this._ext._closeInteractions();
            this._ext._menu.refreshTodoMenu();
            return;
        }
        this._ext._closeInteractions();
        this._ext._actionsCategory = categoryName;
        this._ext._menu.refreshTodoMenu();
    }

    openActionsFor(categoryName) {
        this._ext._closeInteractions();
        this._ext._activeCategory = categoryName;
        this._ext._actionsCategory = categoryName;
        this._ext._menu.refreshTodoMenu();
    }

    deleteCategory(categoryName) {
        const parsed = this._ext._file.read();
        const updated = Storage.deleteCategory(parsed.raw, categoryName);
        if (updated === parsed.raw) {
            this._ext._tasks.cancelEditing();
            return;
        }
        if (!this._ext._file.commit(updated)) {
            this._ext._tasks.cancelEditing();
            return;
        }
        this._ext._closeInteractions();
        // File first, then colour.
        const colors = this._ext._settings.get_value('category-colors')
            .recursiveUnpack();
        const kept = Storage.removeCategoryColor(colors, categoryName);
        if (kept !== colors) {
            this._ext._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', kept));
        }
        this._ext._menu.refreshTodoMenu();
    }
}
