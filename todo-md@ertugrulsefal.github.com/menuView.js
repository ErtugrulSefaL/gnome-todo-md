import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';
import {TabBar} from './tabBar.js';
import {popupArgs, setVerticalOrientation} from './compat.js';
import {capWidth} from './rowFactory.js';

// Match the Shell's fixed 250 ms submenu reveal so the fade does not outlive it.
const PANEL_FADE_MS = 250;

// The popup menu: the scroll wrapper, tab strip and rows.
export class MenuView {
    constructor(ext) {
        this._ext = ext;
    }

    toggleNewCategoryEntry() {
        this._ext._tasks.cancelEditing();
        this._ext._addingNewCategory = !this._ext._addingNewCategory;
        this.refreshTodoMenu();
    }

    // One button filling the row; CSS fixes the row's height.
    makeEmptyStateRow() {
        // Non-reactive so the row does not double the button's hover tint.
        const row = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
            reactive: false,
            style_class: 'todo-empty-row',
        });
        row.set_x_expand(true);
        // A Button, not the row: activating a menu item would close the menu.
        const button = new St.Button({
            style_class: 'todo-empty-hint',
            x_expand: true,
            y_expand: true,
            accessible_name: 'Create your first category',
        });
        const box = new St.BoxLayout({
            x_align: Clutter.ActorAlign.CENTER,
            y_align: Clutter.ActorAlign.CENTER,
        });
        setVerticalOrientation(box, Clutter.Orientation.VERTICAL);
        box.add_child(new St.Label({
            text: 'No categories yet',
            style_class: 'todo-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        box.add_child(new St.Label({
            text: 'Create your first category',
            style_class: 'todo-empty-link',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        button.set_child(box);
        button.connect('clicked', () => this.toggleNewCategoryEntry());
        row.add_child(button);
        return row;
    }

    // Shown while the async read runs: the Shell will not open an empty menu.
    makePlaceholderRow() {
        const row = new PopupMenu.PopupBaseMenuItem({
            activate: false,
            can_focus: false,
            reactive: false,
            style_class: 'todo-empty-row',
        });
        row.add_child(new St.Label({
            text: 'Loading…',
            style_class: 'todo-empty-title',
            x_align: Clutter.ActorAlign.CENTER,
        }));
        return row;
    }

    makeNewCategoryRow() {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            hint_text: 'New category name…',
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        capWidth(entry, this._ext._settings.get_int('menu-width'));
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                const name = e.get_text().trim();
                const parsed = this._ext._file.read();
                const updated = Storage.addCategory(parsed.raw, name);
                if (updated === parsed.raw) {
                    // Rejected name: keep the entry open with the typed text.
                    return Clutter.EVENT_STOP;
                }
                if (!this._ext._file.commit(updated)) {
                    // A failed write changes nothing; keep the entry open.
                    return Clutter.EVENT_STOP;
                }
                // changed::category-colors fires synchronously; write the file first.
                this._ext._addingNewCategory = false;

                const existingCount =
                    Storage.parseDocument(parsed.raw).categories.length;
                const colors = this._ext._settings.get_value('category-colors')
                    .recursiveUnpack();
                colors[name] = Storage.nextCategoryColor(existingCount);
                this._ext._settings.set_value('category-colors',
                    GLib.Variant.new('a{ss}', colors));

                this._ext._activeCategory = name;
                this.refreshTodoMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
    }

    makeRenameRow(categoryName) {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            text: categoryName,
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        capWidth(entry, this._ext._settings.get_int('menu-width'));
        entry.clutter_text.set_selection(0, categoryName.length);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Return) {
                return Clutter.EVENT_PROPAGATE;
            }
            const name = e.get_text().trim();
            const parsed = this._ext._file.read();
            const updated = Storage.renameCategory(parsed.raw, categoryName, name);
            if (updated === parsed.raw) {
                // Rejected name: keep the entry open with the typed text.
                return Clutter.EVENT_STOP;
            }
            if (!this._ext._file.commit(updated)) {
                // A failed write changes nothing; keep the text.
                return Clutter.EVENT_STOP;
            }
            this._ext._closeInteractions();
            // set_value fires changed::category-colors synchronously and drops an
            // active category the file lacks, so follow the rename first.
            if (this._ext._activeCategory === categoryName) {
                this._ext._activeCategory = name;
            }
            // File first, then move the colour to the new name.
            const colors = this._ext._settings.get_value('category-colors')
                .recursiveUnpack();
            const moved = Storage.moveCategoryColor(colors, categoryName, name);
            if (moved !== colors) {
                this._ext._settings.set_value('category-colors',
                    GLib.Variant.new('a{ss}', moved));
            }
            this.refreshTodoMenu();
            return Clutter.EVENT_STOP;
        });
        row.add_child(entry);
        return {row, entry};
    }

    switchTo(categoryName) {
        this._ext._tasks.cancelEditing();
        this._ext._activeCategory = categoryName;
        // Scroll position is not reset: the persistent wrapper keeps it.
        this.refreshTodoMenu();
    }

    refreshTodoMenu() {
        const menu = this._ext._indicator.menu;
        menu.removeAll();
        const menuWidth = this._ext._settings.get_int('menu-width');
        menu.box.set_style(`width: ${menuWidth}px; max-width: ${menuWidth}px;`);
        if (!this._ext._scrollWrapper) {
            const maxMenuHeight = this._ext._settings.get_int('max-menu-height');
            this._ext._contentSection = new PopupMenu.PopupMenuSection();
            this._ext._scrollWrapper = new St.ScrollView({
                style_class: 'todo-scroll',
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
            });
            // min-width matches menu.box's fixed width so the wrapper fills it.
            this._ext._scrollWrapper.set_style(
                `max-height: ${maxMenuHeight}px; min-width: ${menuWidth}px;`);
            this._ext._scrollWrapper.clip_to_allocation = true;
            this._ext._scrollWrapper.add_child(this._ext._contentSection.actor);
        } else {
            // Detach before the rebuild so the tab bar stays the first row.
            menu.box.remove_child(this._ext._scrollWrapper);
        }
        this._ext._contentSection.removeAll();

        if (!this._ext._actions) {
            this._ext._panel.makePanel();
        }

        // The panel actor is untracked by removeAll() (delegate is a PopupSubMenu);
        // detach it here to re-add it under its header.
        if (this._ext._actions.actor.get_parent()) {
            this._ext._actions.actor.get_parent().remove_child(this._ext._actions.actor);
        }

        const todo = this._ext._file.read();
        // The monitor compares against this so our own writes do not rebuild.
        this._ext._file.noteShown();
        const doc = Storage.parseDocument(todo.raw);
        const sections = Storage.renderSections(doc);
        const emptyDocument = Storage.hasNoCategories(doc);
        const colors = this._ext._settings.get_value('category-colors')
            .recursiveUnpack();
        // A pending read is not a read: pruning the placeholder would wipe the map.
        const colorsAreAuthoritative = todo.ok && !this._ext._file.pending;
        const prunedColors = colorsAreAuthoritative
            ? Storage.prunedColorsForDocument(colors, doc)
            : colors;
        if (colorsAreAuthoritative && prunedColors !== colors) {
            this._ext._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', prunedColors));
        }

        const ALL_TAB = null;
        if (this._ext._activeCategory === undefined) {
            this._ext._activeCategory = ALL_TAB;
        }
        if (this._ext._activeCategory !== ALL_TAB
            && !sections.some(section => section.name === this._ext._activeCategory)) {
            this._ext._activeCategory = ALL_TAB;
        }
        // A vanished target (external edit) must not leave the panel armed.
        const knownCategory = name => name === null
            || sections.some(section => section.name === name);
        if (!knownCategory(this._ext._actionsCategory)
            || !knownCategory(this._ext._renamingCategory)) {
            this._ext._closeInteractions();
        }

        // Persistent, horizontally scrollable: only the tab buttons are refilled, so the hadjustment survives
        if (!this._ext._tabBar) {
            this._ext._tabBar = new TabBar({
                onNewCategory: () => this.toggleNewCategoryEntry(),
            });
        } else {
            // Detach and clear the tab buttons; the strip (and hadjustment) survive.
            this._ext._tabBar.detach(menu.box);
        }

        // Re-attach as the first row (refill only, so the hadjustment survives).
        this._ext._tabBar.attach(menu.box);
        this._ext._tabBar.refill(emptyDocument ? [] : sections,
            prunedColors, this._ext._activeCategory,
            name => this.switchTo(name),
            name => this._ext._panel.openActionsFor(name),
            {
                onBegin: (name, index) => this._ext._dnd.onCategoryDragBegin(name, index),
                onEnd: () => this._ext._dnd.onDragEnd(),
                onDrop: () => this._ext._dnd.onCategoryDrop(),
            });
        this._ext._tabBar.setEmptyState(emptyDocument);

        if (this._ext._addingNewCategory) {
            const newCategoryRow = this.makeNewCategoryRow();
            menu.addMenuItem(newCategoryRow.row);
            newCategoryRow.entry.grab_key_focus();
        }

        menu.box.add_child(this._ext._scrollWrapper);

        const contentSection = this._ext._contentSection;

        const visibleSections = emptyDocument
            ? []
            : (this._ext._activeCategory === ALL_TAB
                ? sections
                : sections.filter(section => section.name === this._ext._activeCategory));

        if (emptyDocument) {
            contentSection.addMenuItem(this._ext._file.pending
                ? this.makePlaceholderRow()
                : this.makeEmptyStateRow());
        }

        // A keyboard-move target takes the focus back; consumed here, never left set.
        const focusTarget = this._ext._focusIndex;
        this._ext._focusIndex = -1;
        let focusRow = null;

        for (const section of visibleSections) {
            const header = new PopupMenu.PopupBaseMenuItem(
                {activate: false, can_focus: false});
            const label = new St.Label({
                text: section.name,
                style_class: 'todo-category-header',
                y_align: Clutter.ActorAlign.CENTER,
            });
            // Fixed ellipsize; a long name must not widen the menu.
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            const colorCss = Storage.categoryColorCss(section.name, prunedColors);
            const headerStyle
                = `max-width: ${this._ext._settings.get_int('menu-width')}px;`;
            label.set_style(headerStyle + (colorCss || ''));
            label.set_x_expand(true);
            header.add_child(label);

            const categoryName = section.name;
            const actionsBtn = new St.Button({
                style_class: 'todo-icon-button button',
                accessible_name: `Actions for ${categoryName}`,
                child: new St.Icon({
                    icon_name: 'view-more-symbolic',
                    style_class: 'system-status-icon todo-more-icon',
                }),
            });
            actionsBtn.set_x_align(Clutter.ActorAlign.END);
            actionsBtn.connect('clicked', () => {
                this._ext._panel.toggleActions(categoryName);
            });
            header.add_child(actionsBtn);
            // Right-click anywhere on the row opens the same panel; activate is
            // disabled, so the press never counts as choosing a menu item.
            header.connect('button-press-event', (_actor, event) => {
                if (event.get_button() !== 3) {
                    return Clutter.EVENT_PROPAGATE;
                }
                this._ext._panel.toggleActions(categoryName);
                return Clutter.EVENT_STOP;
            });
            // Fill the fixed wrapper width; without x_expand short rows collapse right.
            header.set_x_expand(true);
            contentSection.addMenuItem(header);

            if (this._ext._actionsCategory === categoryName) {
                contentSection.box.add_child(this._ext._actions.actor);
                this._ext._actions.sourceActor = header;
                this._ext._actions.focusActor = actionsBtn;
                const reduceMotion =
                    St.ReducedMotion !== undefined &&
                    St.Settings.get().reducedMotion === St.ReducedMotion.REDUCE;
                this._ext._actions.actor.remove_transition('opacity');
                this._ext._actions.actor.opacity = 0;
                this._ext._actions.actor.ease({
                    opacity: 255,
                    duration: reduceMotion ? 0 : PANEL_FADE_MS,
                    mode: Clutter.AnimationMode.EASE_OUT_QUAD,
                });
                this._ext._actions.open(popupArgs(this._ext._actions, 'open', true));
            }

            if (this._ext._renamingCategory === categoryName) {
                const renameRow = this.makeRenameRow(categoryName);
                renameRow.row.set_x_expand(true);
                contentSection.addMenuItem(renameRow.row);
                renameRow.entry.grab_key_focus();
            }

            // Renders solely from _addingCategory, so two open adders cannot coexist.
            if (this._ext._addingCategory === categoryName) {
                const addRow = this._ext._rowFactory.makeAddRow(categoryName, todo);
                addRow.row.set_x_expand(true);
                contentSection.addMenuItem(addRow.row);
                addRow.entry.grab_key_focus();
            }

            const tasks = section.tasks;
            for (const task of tasks) {
                // Renders solely from _editingIndex, so two open editors cannot coexist.
                if (task.index === this._ext._editingIndex) {
                    const editRow = this._ext._editingDueOnly
                        ? this._ext._rowFactory.makeDueEditRow(task, todo)
                        : this._ext._rowFactory.makeEditRow(task, todo);
                    editRow.row.set_x_expand(true);
                    contentSection.addMenuItem(editRow.row);
                    // An actor that is not yet mapped cannot take key focus.
                    editRow.entry.grab_key_focus();
                    continue;
                }

                const taskRow = this._ext._rowFactory.makeTaskRow(task,
                    section.name, prunedColors, todo);
                taskRow.set_x_expand(true);
                contentSection.addMenuItem(taskRow);
                if (task.index === focusTarget) {
                    focusRow = taskRow;
                }
            }
        }

        if (focusRow) {
            focusRow.grab_key_focus();
        }
    }
}
