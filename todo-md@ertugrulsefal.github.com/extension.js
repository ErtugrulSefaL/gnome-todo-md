import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';
import {TabBar} from './tabBar.js';
import {RowFactory, capWidth} from './rowFactory.js';

export default class TodoExtension extends Extension {
    enable() {
        // Single-edit invariant: at most one row is edited at a time. Reset on
        // enable — the Extension instance survives disable/enable.
        this._closeInteractions();
        this._openIdleId = 0;

        // GSettings backend (the schema id comes from metadata.json).
        this._settings = this.getSettings();
        // Live-rewire: when the configured path changes, watch the new file.
        this._settingsSignal = this._settings.connect('changed::todo-file-path',
            () => {
                this._closeInteractions();
                this._unwatchTodoFile();
                this._watchTodoFile();
                this._refreshTodoMenu();
            });
        // Re-render when the color map changes (prefs writes it live).
        this._colorSignal = this._settings.connect('changed::category-colors',
            () => {
                this._refreshTodoMenu();
            });
        // Re-render when the height or width changes (inline styles).
        this._heightSignal = this._settings.connect('changed::max-menu-height',
            () => {
                if (this._scrollWrapper) {
                    this._scrollWrapper.set_style(
                        `max-height: ${this._settings.get_int('max-menu-height')}px;`
                        + ` min-width: ${this._settings.get_int('menu-width')}px;`);
                }
            });
        // Re-render when the menu width changes: the menu box carries the forced
        // width and the persistent tab scroller its min/max pair, both applied
        // inline before the menu rebuilds.
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
                this._refreshTodoMenu();
            });

        // Create a panel button.
        this._indicator = new PanelMenu.Button(0.0, this.metadata.name, false);

        // Add an icon to the panel button.
        const icon = new St.Icon({
            icon_name: 'checkbox-checked-symbolic',
            style_class: 'system-status-icon',
        });
        this._indicator.add_child(icon);

        // Refresh the list when the menu opens, so external edits show up. The
        // idle lets the menu open first: clearing items during the open
        // transition breaks the layout.
        this._openSignal = this._indicator.menu.connect('open-state-changed',
            (menu, open) => {
                if (open) {
                    // GLib.idle_add takes (priority, func); a one-argument call
                    // throws and the rebuild silently never runs. The id is
                    // kept so disable() can cancel it — a pending idle would
                    // otherwise refresh a torn-down menu.
                    if (this._openIdleId) {
                        GLib.Source.remove(this._openIdleId);
                    }
                    this._openIdleId = GLib.idle_add(GLib.PRIORITY_DEFAULT_IDLE, () => {
                        this._openIdleId = 0;
                        this._refreshTodoMenu();
                        return GLib.SOURCE_REMOVE;
                    });
                } else {
                    // Menu closed: neither an uncommitted edit nor an open
                    // action panel may survive into the next open.
                    this._closeInteractions();
                    this._focusIndex = -1;
                }
            });

        // Row factory: the actions are the extension's own methods, injected
        // so rowFactory.js stays free of this extension's private state.
        this._rowFactory = new RowFactory({
            menuWidth: this._settings.get_int('menu-width'),
            onToggle: index => this._toggleTask(index),
            onEdit: index => this._startEditing(index),
            onDelete: index => this._deleteTask(index),
            onMove: (index, categoryName, direction) =>
                this._moveTask(index, categoryName, direction),
            onDragBegin: (index, categoryName) => this._onDragBegin(index, categoryName),
            onDragEnd: () => this._onDragEnd(),
            onDrop: (toIndex, toCategory) => this._onDrop(toIndex, toCategory),
            onAddTask: (text, categoryName) => this._addTask(text, categoryName),
            onFinishEditing: text => this._finishEditing(text),
        });

        // Add the indicator to the panel.
        Main.panel.addToStatusArea(this.uuid, this._indicator);

        // Drag-and-drop state and the insertion line. The line must exist
        // before _applyColorScheme(), which tags it.
        this._dragging = null;
        this._focusIndex = -1;
        this._lastWritten = null;
        this._setupDragAndDrop();

        // Theme-dependent colours (checkbox ring, swatch ring, scrollbars)
        // follow the shell's colour scheme; the shell announces changes.
        this._applyColorScheme();
        this._colorSchemeSignal = St.Settings.get().connect(
            'notify::color-scheme', () => this._applyColorScheme());

        // Pre-fill the menu so it is not empty on first open (an empty popup
        // menu will not be shown by GNOME Shell).
        this._refreshTodoMenu();

        // Watch ~/todo.md so externally-added tasks appear live, without
        // needing a Shell reload.
        this._watchTodoFile();
    }

    /**
     * Follow the shell's colour scheme.
     *
     * St's stylesheet grammar has no `currentColor`, so a hard-coded colour is
     * invisible in one of the two themes. The scheme is read here and the menu
     * box is tagged; stylesheet.css scopes every theme-dependent colour under
     * `.todo-dark` / `.todo-light`.
     */
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
        // The insertion line is not inside menu.box (it lives on Main.uiGroup so
        // it never joins the menu's layout), so it carries the scheme class
        // directly instead of inheriting it.
        if (this._dropLine) {
            this._dropLine.remove_style_class_name('todo-light');
            this._dropLine.remove_style_class_name('todo-dark');
            this._dropLine.add_style_class_name(dark ? 'todo-dark' : 'todo-light');
        }
    }

    disable() {
        this._unwatchTodoFile();
        // Every main loop source has to go, even one that already returned
        // SOURCE_REMOVE: a pending idle would call back into a torn-down menu.
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
        // St.Settings is a shell singleton, not ours: our handler must go with
        // the extension, or a disabled extension keeps being called back.
        if (this._colorSchemeSignal) {
            St.Settings.get().disconnect(this._colorSchemeSignal);
            this._colorSchemeSignal = null;
        }
        // The drag monitor is a module-global list in the Shell, so it must
        // never outlive the extension; the insertion line is our own actor on
        // Main.uiGroup.
        if (this._dragMonitor) {
            DND.removeDragMonitor(this._dragMonitor);
            this._dragMonitor = null;
        }
        this._dragging = null;
        if (this._dropLine) {
            this._dropLine.destroy();
            this._dropLine = null;
        }
        // The panel's actor lives inside the content section, but the
        // PopupSubMenu owns shell-side state (a Main.sessionMode connection), so
        // it is destroyed before its actor's parent goes away.
        if (this._actions) {
            this._actions.destroy();
            this._actions = null;
            this._actionsDeleteItem = null;
            this._actionsItems = null;
            this._colorRow = null;
            this._swatches = null;
            this._colorPickerOpen = false;
        }
        if (this._scrollWrapper) {
            this._scrollWrapper.destroy();
            this._scrollWrapper = null;
            this._contentSection = null;
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

    /**
     * Watch the configured todo file for external changes. Created per enable();
     * re-created when the path setting changes, so there is one monitor at a
     * time.
     */
    _watchTodoFile() {
        this._todoMonitor = Gio.File.new_for_path(this._todoPath())
            .monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitorSignal = this._todoMonitor.connect('changed', () => {
            // Our own writes fire the monitor too, and their refresh already
            // happened; refreshing again would throw away what that refresh
            // restored — the key focus after a keyboard move. Identical content
            // is therefore ignored.
            const current = Storage.readTodo(this._todoPath());
            if (current.ok && current.raw === this._lastWritten) {
                return;
            }
            // Any write may shift line indexes, so an in-progress edit cannot
            // be trusted: close it and rebuild.
            this._closeInteractions();
            this._refreshTodoMenu();
        });
    }

    /**
     * Close every inline interaction at once: at most one may be open — a task
     * edit, a category add entry, the new-category entry, a category rename or a
     * category action panel. These fields are reset only here, so they cannot
     * drift apart.
     */
    _closeInteractions() {
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        this._renamingCategory = null;
        this._actionsCategory = null;
        this._hideActionsPanel();
    }

    /**
     * Hide the category action panel and reset its sub-states: the pending
     * delete confirmation and the colour picker.
     */
    _hideActionsPanel() {
        this._resetDeleteConfirm();
        if (this._colorPickerOpen) {
            this._colorPickerOpen = false;
            this._colorRow.hide();
            for (const item of this._actionsItems) {
                item.show();
            }
        }
        if (this._actions && this._actions.isOpen) {
            this._actions.close(false);
        }
    }

    /**
     * Forget a pending delete confirmation — a panel sub-state, dropped both
     * when the panel closes and when the colour picker takes the panel over.
     */
    _resetDeleteConfirm() {
        if (this._deleteConfirming && this._actionsDeleteItem) {
            this._deleteConfirming = false;
            this._actionsDeleteItem.label.text = 'Delete';
            this._actionsDeleteItem.remove_style_class_name('todo-action-confirm');
        }
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
     * Build the inline "new category" row: an empty entry. Enter commits via
     * Storage.addCategory; the new category becomes the active tab.
     *
     */
    _makeNewCategoryRow() {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            hint_text: 'New category name…',
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        capWidth(entry, this._settings.get_int('menu-width'));
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                const name = e.get_text().trim();
                const parsed = Storage.readTodo(this._todoPath());
                const updated = Storage.addCategory(parsed.raw, name);
                if (updated === parsed.raw) {
                    // Rejected: empty, already taken, or a name that cannot be
                    // written as a heading. The entry stays open with the typed
                    // text — closing it here would make Enter look broken.
                    return Clutter.EVENT_STOP;
                }
                if (!Storage.writeTodo(this._todoPath(), updated)) {
                    // A failed write changes nothing: the entry stays open and
                    // no colour is stored for a category the file lacks.
                    return Clutter.EVENT_STOP;
                }
                // File first, then colour: changed::category-colors fires
                // synchronously and the refresh prunes keys the file lacks.
                this._addingNewCategory = false;

                // Auto colour: the next palette entry, wrapping around.
                const existingCount =
                    Storage.parseDocument(parsed.raw).categories.length;
                const colors = this._settings.get_value('category-colors')
                    .recursiveUnpack();
                colors[name] = Storage.nextCategoryColor(existingCount);
                this._settings.set_value('category-colors',
                    GLib.Variant.new('a{ss}', colors));

                this._activeCategory = name;
                this._refreshTodoMenu();
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
    }

    /**
     * Build the inline category rename row: the new-category row shape,
     * prefilled with the current name and preselected so typing replaces it.
     * Enter commits through Storage.renameCategory.
     *
     */
    _makeRenameRow(categoryName) {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            text: categoryName,
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        capWidth(entry, this._settings.get_int('menu-width'));
        // Preselect, so typing replaces the old name instead of appending.
        entry.clutter_text.set_selection(0, categoryName.length);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Return) {
                return Clutter.EVENT_PROPAGATE;
            }
            const name = e.get_text().trim();
            const parsed = Storage.readTodo(this._todoPath());
            const updated = Storage.renameCategory(parsed.raw, categoryName, name);
            if (updated === parsed.raw) {
                // Rejected: an unusable name, the unchanged name, or one
                // already taken. The entry stays open with the typed text.
                return Clutter.EVENT_STOP;
            }
            if (!Storage.writeTodo(this._todoPath(), updated)) {
                // A failed write changes nothing: the text stays.
                return Clutter.EVENT_STOP;
            }
            this._closeInteractions();
            // The active tab follows the rename before the colour write:
            // set_value fires changed::category-colors synchronously, and that
            // refresh drops an active category the file no longer has.
            if (this._activeCategory === categoryName) {
                this._activeCategory = name;
            }
            // File first, then colour: the stored colour follows the new name,
            // so a rename never loses a colour.
            const colors = this._settings.get_value('category-colors')
                .recursiveUnpack();
            const moved = Storage.moveCategoryColor(colors, categoryName, name);
            if (moved !== colors) {
                this._settings.set_value('category-colors',
                    GLib.Variant.new('a{ss}', moved));
            }
            this._refreshTodoMenu();
            return Clutter.EVENT_STOP;
        });
        row.add_child(entry);
        return {row, entry};
    }

    /**
     * Build the category action panel once.
     *
     * It is a PopupSubMenu — the shell's own inline expander — so it looks and
     * animates like a native submenu while living in the content flow, right
     * below the header that opened it.
     *
     * Its items are added to the submenu box directly, not through
     * addMenuItem(): that call wires 'activate' to itemActivated(), which closes
     * the menu on the first click, and the two-step delete needs the panel to
     * survive it. Every item therefore closes the panel itself.
     *
     */
    _makeActionsPanel() {
        // The submenu arrow exists only because open()/close() animate it; it is
        // kept invisible rather than borrowing the button's icon, which would
        // mean reaching into the submenu's private _arrow.
        const arrow = new St.Icon({icon_name: 'pan-down-symbolic'});
        arrow.visible = false;
        this._actions = new PopupMenu.PopupSubMenu(null, arrow);

        const addItem = new PopupMenu.PopupMenuItem('Add task');
        addItem.connect('activate', () => {
            const target = this._actionsCategory;
            this._hideActionsPanel();
            this._toggleAdd(target);
        });

        // Opens the colour picker row inside the panel (a panel sub-state, so
        // the invariant does not grow).
        const colorItem = new PopupMenu.PopupMenuItem('Change color');
        colorItem.connect('activate', () => {
            this._openColorPicker();
        });

        const renameItem = new PopupMenu.PopupMenuItem('Rename');
        renameItem.connect('activate', () => {
            const target = this._actionsCategory;
            this._hideActionsPanel();
            this._closeInteractions();
            this._renamingCategory = target;
            this._refreshTodoMenu();
        });

        const deleteItem = new PopupMenu.PopupMenuItem('Delete');
        deleteItem.add_style_class_name('todo-action-danger');
        deleteItem.connect('activate', () => {
            const target = this._actionsCategory;
            if (!this._deleteConfirming) {
                // The first click arms the confirmation and the panel stays
                // open — that is why the items bypass addMenuItem.
                this._deleteConfirming = true;
                deleteItem.label.text = 'Confirm delete?';
                deleteItem.add_style_class_name('todo-action-confirm');
                return;
            }
            this._deleteConfirming = false;
            deleteItem.label.text = 'Delete';
            deleteItem.remove_style_class_name('todo-action-confirm');
            this._hideActionsPanel();
            this._deleteCategory(target);
        });
        this._actionsDeleteItem = deleteItem;

        this._actionsItems = [addItem, colorItem, renameItem, deleteItem];
        for (const item of this._actionsItems) {
            this._actions.box.add_child(item.actor);
        }
        this._actions.box.add_child(this._makeColorRow());
        this._actions.actor.hide();
    }

    /**
     * The colour picker row: one swatch per palette entry plus a "remove
     * colour" button, hidden until 'Change color' is chosen.
     *
     * It lives inside the panel, so the single-interaction invariant does not
     * grow: the picker is a panel sub-state, like the two-step delete arm, and
     * _hideActionsPanel() resets both.
     *
     * The swatch colour is set inline from Storage.CATEGORY_PALETTE; only the
     * shape and the selected ring live in stylesheet.css.
     */
    _makeColorRow() {
        const row = new St.BoxLayout({style_class: 'todo-color-row'});
        this._swatches = [];
        Storage.CATEGORY_PALETTE.forEach((hex, i) => {
            const swatch = new St.Button({
                style_class: 'todo-swatch',
                toggle_mode: true,
                accessible_name: 'Set category colour to '
                    + Storage.CATEGORY_PALETTE_NAMES[i],
            });
            swatch.set_style(`background-color: ${hex};`);
            swatch.connect('clicked', () => {
                this._applyCategoryColor(hex);
            });
            this._swatches.push({button: swatch, hex});
            row.add_child(swatch);
        });
        // The 'none' swatch: a category may carry no colour at all, and a
        // picker that can only add colours could never go back.
        const none = new St.Button({
            style_class: 'todo-swatch todo-swatch-none',
            toggle_mode: true,
            accessible_name: 'Remove category colour',
            child: new St.Icon({
                icon_name: 'action-unavailable-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        none.connect('clicked', () => {
            this._applyCategoryColor(null);
        });
        this._swatches.push({button: none, hex: null});
        row.add_child(none);
        this._colorRow = row;
        row.hide();
        return row;
    }

    /**
     * Swap the panel into its colour-picker state: the swatch row replaces the
     * four items, and the delete arm is dropped (the sub-states exclude each
     * other).
     */
    _openColorPicker() {
        this._resetDeleteConfirm();
        this._colorPickerOpen = true;
        for (const item of this._actionsItems) {
            item.hide();
        }
        this._markSelectedSwatch();
        this._colorRow.show();
    }

    /**
     * Ring the swatch that matches the category's current colour (or 'none'
     * when it has none), so the picker shows the same colour the header and the
     * tab are painted with.
     */
    _markSelectedSwatch() {
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const current = Storage.categoryColorHex(this._actionsCategory, colors);
        for (const {button, hex} of this._swatches) {
            button.set_checked(hex === current);
        }
    }

    /**
     * Apply (or remove) the colour of the panel's target category, then close
     * the panel and re-render.
     *
     * No file write happens here, and that is correct: colours live in GSettings
     * only, so the map is their source of truth. A guard pins that no writeTodo
     * creeps into this path.
     */
    _applyCategoryColor(hex) {
        const target = this._actionsCategory;
        this._hideActionsPanel();
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const next = hex === null
            ? Storage.removeCategoryColor(colors, target)
            : Storage.setCategoryColor(colors, target, hex);
        if (next !== colors) {
            this._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', next));
        }
        this._refreshTodoMenu();
    }


    /**
     * Toggle the action panel of one category (the header's ⋮ button).
     *
     */
    _toggleActions(categoryName) {
        if (this._actionsCategory === categoryName) {
            this._closeInteractions();
            this._refreshTodoMenu();
            return;
        }
        this._closeInteractions();
        this._actionsCategory = categoryName;
        this._refreshTodoMenu();
    }

    /**
     * Right-click on a tab: switch to that category and show its action panel
     * under its header.
     *
     */
    _openActionsFor(categoryName) {
        this._closeInteractions();
        this._activeCategory = categoryName;
        this._actionsCategory = categoryName;
        this._refreshTodoMenu();
    }

    /**
     * Delete a category with everything in it, persist and refresh. The
     * two-step confirmation happens in the panel, not here.
     *
     */
    _deleteCategory(categoryName) {
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.deleteCategory(parsed.raw, categoryName);
        if (updated === parsed.raw) {
            this._cancelEditing();
            return;
        }
        if (!Storage.writeTodo(this._todoPath(), updated)) {
            // A failed write changes nothing: no colour is dropped for a
            // category the file still contains.
            this._cancelEditing();
            return;
        }
        this._closeInteractions();
        // File first, then colour: drop the deleted category's colour
        // explicitly. The refresh prune keeps the whole map when it was the
        // file's last heading (see removeCategoryColor).
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const kept = Storage.removeCategoryColor(colors, categoryName);
        if (kept !== colors) {
            this._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', kept));
        }
        this._refreshTodoMenu();
    }

    /**
     * Switch the active category tab. Closes any open inline interaction, so a
     * tab switch cannot leave an edit or an add entry open. An unknown category
     * falls back to 'All' at render time.
     *
     */
    _switchTo(categoryName) {
        this._cancelEditing();
        this._activeCategory = categoryName;
        // The scroll position is deliberately not reset here: the persistent
        // wrapper keeps both offsets across refreshes.
        this._refreshTodoMenu();
    }

    /**
     * Resolve the todo file path from the GSettings value (see
     * Storage.resolveTodoPath).
     *
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
        // The BoxPointer sizes itself from the menu's NATURAL width, so
        // min-width alone only raises the minimum and short content still
        // shrank the menu. CSS 'width' forces the preferred width and
        // 'max-width' clamps the natural to the same value, so the frame can
        // never be narrower or wider than the setting.
        const menuWidth = this._settings.get_int('menu-width');
        menu.box.set_style(`width: ${menuWidth}px; max-width: ${menuWidth}px;`);
        // Persistent scroll wrapper: created once and refilled per refresh, so
        // the vadjustment — and the scroll position — survive every rebuild.
        // menu.removeAll() does not track it (it is added via menu.box).
        if (!this._scrollWrapper) {
            const maxMenuHeight = this._settings.get_int('max-menu-height');
            this._contentSection = new PopupMenu.PopupMenuSection();
            this._scrollWrapper = new St.ScrollView({
                style_class: 'todo-scroll',
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
            });
            // Fixed width (min == max): the menu must not widen with content nor
            // shrink with short categories. menu.box is force-sized below; this
            // min-width keeps the wrapper filling it.
            const menuWidth = this._settings.get_int('menu-width');
            this._scrollWrapper.set_style(
                `max-height: ${maxMenuHeight}px; min-width: ${menuWidth}px;`);
            this._scrollWrapper.clip_to_allocation = true;
            this._scrollWrapper.add_child(this._contentSection.actor);
        } else {
            // Detach before rebuilding the fixed rows: the wrapper is
            // re-attached right below them, so the tab bar stays the first row.
            menu.box.remove_child(this._scrollWrapper);
        }
        this._contentSection.removeAll();

        if (!this._actions) {
            this._makeActionsPanel();
        }

        // The panel actor is untracked by removeAll() (its delegate is a
        // PopupSubMenu), so it is detached here and placed under the right
        // header by the render step below.
        if (this._actions.actor.get_parent()) {
            this._actions.actor.get_parent().remove_child(this._actions.actor);
        }

        const todo = Storage.readTodo(this._todoPath());
        // What the menu now shows: the file monitor compares against this, so
        // our own writes never trigger a second rebuild.
        this._lastWritten = todo.ok ? todo.raw : null;
        const doc = Storage.parseDocument(todo.raw);

        // Every category renders as a non-clickable header row followed by its
        // task rows; task-less categories render too, since adding is
        // per-category.
        const sections = Storage.renderSections(doc);

        // Category colours from the settings map. Dead keys are pruned
        // automatically, and the write happens only when the prune removed
        // something, so the changed:: signal cannot cause a refresh loop.
        //
        // Which list is authoritative, and when not to prune at all, lives in
        // Storage.prunedColorsForDocument() so it is unit-testable. A failed
        // read is skipped entirely: readTodo reports it via `ok`, and a
        // transient failure would otherwise look exactly like "the user
        // deleted every category" and wipe the map for good.
        //
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const prunedColors = todo.ok
            ? Storage.prunedColorsForDocument(colors, doc)
            : colors;
        if (todo.ok && prunedColors !== colors) {
            this._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', prunedColors));
        }

        // Tab bar, always rendered: 'All' shows every category, other tabs
        // filter the content. A '+' button at the far right opens the
        // new-category entry, so categories can be created from any file state.
        const ALL_TAB = null;
        if (this._activeCategory === undefined) {
            this._activeCategory = ALL_TAB;
        }
        // Drop the remembered selection if its category no longer exists.
        if (this._activeCategory !== ALL_TAB
            && !sections.some(section => section.name === this._activeCategory)) {
            this._activeCategory = ALL_TAB;
        }
        // A target that vanished (an external edit) must not leave a panel
        // armed for a dead name.
        const knownCategory = name => name === null
            || sections.some(section => section.name === name);
        if (!knownCategory(this._actionsCategory)
            || !knownCategory(this._renamingCategory)) {
            this._closeInteractions();
        }

        // The tab bar is persistent (created once, like the content wrapper) and
        // always horizontally scrollable: only the tab buttons are refilled, so
        // the hadjustment survives every rebuild. It must be a PLAIN actor, not
        // a PopupBaseMenuItem: menu.box children whose _delegate is a
        // PopupBaseMenuItem are destroyed by menu.removeAll(), which crashed the
        // Shell.
        if (!this._tabBar) {
            // The strip itself lives in tabBar.js; this file decides when it
            // exists, where it sits and what fills it.
            this._tabBar = new TabBar();
            this._tabBar.newCategoryButton.connect('clicked', () => {
                this._cancelEditing();
                this._addingNewCategory = !this._addingNewCategory;
                this._refreshTodoMenu();
            });
        } else {
            // Detach and clear the tab buttons; the strip and its hadjustment
            // survive.
            this._tabBar.detach(menu.box);
            this._tabBar.clearTabs();
        }

        // Re-attach the persistent tab bar as the first row (refill only, so the
        // scroller's hadjustment survives).
        this._tabBar.attach(menu.box);
        this._tabBar.refill(sections, prunedColors, this._activeCategory,
            name => this._switchTo(name),
            name => this._openActionsFor(name));

        // The new-category inline entry renders right under the tab bar.
        if (this._addingNewCategory) {
            const newCategoryRow = this._makeNewCategoryRow();
            menu.addMenuItem(newCategoryRow.row);
            newCategoryRow.entry.grab_key_focus();
        }

        // Re-attach the persistent scroll wrapper below the fixed rows;
        // detaching does not touch the vadjustment.
        menu.box.add_child(this._scrollWrapper);

        // Scrollable content area, using the Shell's own pattern: St.ScrollView
        // with clip_to_allocation and a CSS max-height (the scrollbar only
        // engages once a max-height is set).
        const contentSection = this._contentSection;

        const visibleSections = this._activeCategory === ALL_TAB
            ? sections
            : sections.filter(section => section.name === this._activeCategory);

        // The row a keyboard move produced takes the key focus back, so a second
        // Alt+↑/↓ press works without re-clicking. The target is consumed here
        // and never left set.
        const focusTarget = this._focusIndex;
        this._focusIndex = -1;
        let focusRow = null;

        for (const section of visibleSections) {
            // Non-reactive header + interactive child: the proven entryItem
            // pattern (an interactive child inside a non-reactive row).
            const header = new PopupMenu.PopupBaseMenuItem(
                {activate: false, can_focus: false});
            const label = new St.Label({
                text: section.name,
                style_class: 'todo-category-header',
                // The row's ⋮ button is taller than the text.
                y_align: Clutter.ActorAlign.CENTER,
            });
            // Same width cap as task labels plus a fixed ellipsize: a long
            // category name must not widen the menu.
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            // The colour applies to the header text via an inline style.
            const colorCss = Storage.categoryColorCss(section.name, prunedColors);
            const headerStyle
                = `max-width: ${this._settings.get_int('menu-width')}px;`;
            label.set_style(headerStyle + (colorCss || ''));
            label.set_x_expand(true);
            header.add_child(label);

            // The panel renders right below this header (see the render step
            // below), so this button only toggles it.
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
                this._toggleActions(categoryName);
            });
            header.add_child(actionsBtn);
            // Right-click anywhere on the row — the category NAME included —
            // opens the same panel. The row is reactive with activate disabled,
            // so the press reaches this handler and stops there (it never
            // counts as choosing a menu item).
            header.connect('button-press-event', (actor, event) => {
                if (event.get_button() !== 3) {
                    return Clutter.EVENT_PROPAGATE;
                }
                this._toggleActions(categoryName);
                return Clutter.EVENT_STOP;
            });
            // Every content row fills the fixed wrapper width: without x_expand
            // a short category's rows keep their natural width and the right
            // side collapses.
            header.set_x_expand(true);
            contentSection.addMenuItem(header);

            // The action panel renders as an untracked row directly below its
            // header — a PopupSubMenu actor, not a menu item, so
            // contentSection.removeAll() never destroys it.
            if (this._actionsCategory === categoryName) {
                contentSection.box.add_child(this._actions.actor);
                // sourceActor must be a menu item: the submenu's own Left-key
                // handler dereferences sourceActor._delegate.active, and this
                // header is the item the panel belongs to.
                this._actions.sourceActor = header;
                this._actions.focusActor = actionsBtn;
                this._actions.open(true);
            }

            // The rename entry takes the panel's slot when Rename was chosen.
            if (this._renamingCategory === categoryName) {
                const renameRow = this._makeRenameRow(categoryName);
                renameRow.row.set_x_expand(true);
                contentSection.addMenuItem(renameRow.row);
                renameRow.entry.grab_key_focus();
            }

            // The active add entry renders directly under its category header;
            // render derives solely from _addingCategory, so two open adders
            // cannot coexist.
            if (this._addingCategory === categoryName) {
                const addRow = this._rowFactory.makeAddRow(categoryName);
                addRow.row.set_x_expand(true);
                contentSection.addMenuItem(addRow.row);
                // Grab focus only after the row is on stage.
                addRow.entry.grab_key_focus();
            }

            const tasks = section.tasks;
            for (const task of tasks) {
                // The row being edited renders as an inline entry instead of the
                // usual label and buttons; render derives solely from
                // _editingIndex, so two open editors cannot coexist.
                if (task.index === this._editingIndex) {
                    const editRow = this._rowFactory.makeEditRow(task);
                    editRow.row.set_x_expand(true);
                    contentSection.addMenuItem(editRow.row);
                    // Grab focus only after the row is on stage; an actor that
                    // is not yet mapped cannot take key focus.
                    editRow.entry.grab_key_focus();
                    continue;
                }

                const taskRow = this._rowFactory.makeTaskRow(task,
                    section.name, prunedColors);
                taskRow.set_x_expand(true);
                contentSection.addMenuItem(taskRow);
                if (task.index === focusTarget) {
                    focusRow = taskRow;
                }
            }
        }

        // Hand the key focus to the row a keyboard move produced, so a second
        // Alt+↑/↓ press works without re-clicking.
        if (focusRow) {
            focusRow.grab_key_focus();
        }

        // (The scroll position is never reset: the persistent wrapper keeps
        // it across tab switches.)
    }


    /**
     * Switch a row into inline edit mode. Replaces any existing inline
     * interaction: render derives solely from _editingIndex.
     *
     */
    _startEditing(index) {
        this._closeInteractions();
        this._editingIndex = index;
        this._refreshTodoMenu();
    }

    /**
     * Close any open inline interaction (the edit row or a category add
     * entry) without writing anything.
     */
    _cancelEditing() {
        this._closeInteractions();
        this._refreshTodoMenu();
    }

    /**
     * Commit the inline edit via Storage.editTask and close it.
     *
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
        // A failed write must not close the edit and discard the new text.
        if (!Storage.writeTodo(this._todoPath(), updated)) {
            return;
        }
        this._closeInteractions();
        this._refreshTodoMenu();
    }

    /**
     * Add a task to the given category, persist and refresh.
     *
     */
    _addTask(text, category) {
        const trimmed = text ? text.trim() : '';
        if (!trimmed) {
            // Empty input closes the inline add instead of failing.
            this._cancelEditing();
            return;
        }

        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.addTask(parsed.raw, trimmed, category);
        // The write result decides whether the entry may close: on failure
        // (disk full, read-only file) the typed text stays in the entry instead
        // of vanishing with a refresh that re-reads the old file.
        if (!Storage.writeTodo(this._todoPath(), updated)) {
            return;
        }
        this._closeInteractions();
        this._refreshTodoMenu();
    }

    /**
     * Open (or toggle closed) the inline add entry of a category, replacing any
     * other open interaction.
     *
     */
    _toggleAdd(categoryName) {
        if (this._addingCategory === categoryName) {
            this._cancelEditing();
            return;
        }
        this._closeInteractions();
        this._addingCategory = categoryName;
        this._refreshTodoMenu();
    }

    /**
     * Toggle a task's checkbox state, persist and refresh.
     *
     */
    _toggleTask(index) {
        this._closeInteractions();
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.toggleTask(parsed.raw, index);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Delete a task line and refresh the menu.
     *
     */
    _deleteTask(index) {
        this._closeInteractions();
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.deleteTask(parsed.raw, index);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Set up the drag-and-drop plumbing once per enable().
     *
     * The monitor is registered only while a drag is in flight; the insertion
     * line lives on Main.uiGroup, like the Shell's own drag actor, so it never
     * takes part in the menu's layout.
     */
    _setupDragAndDrop() {
        this._dragMonitor = {
            dragMotion: event => this._onDragMotion(event),
            // CONTINUE, never SUCCESS: a monitor returning SUCCESS/FAILURE makes
            // the Shell return early and skip its own cleanup — the drag actor is
            // never destroyed, the modal grab is never popped and drag-end never
            // fires. The drop itself belongs to the row's acceptDrop, which the
            // Shell calls next.
            dragDrop: () => DND.DragDropResult.CONTINUE,
        };
        this._dropLine = new St.Widget({style_class: 'todo-drop-line'});
        this._dropLine.visible = false;
        Main.uiGroup.add_child(this._dropLine);
    }

    /**
     * A drag started on a row's handle: remember what is moving and start
     * listening for its motion.
     */
    _onDragBegin(index, categoryName) {
        this._dragging = {index, category: categoryName};
        DND.addDragMonitor(this._dragMonitor);
        // The menu raises itself above every uiGroup sibling on each open
        // (PopupMenu.open), which puts the insertion line behind the menu's
        // background: raise it back on top once per drag. Here and not in
        // _onDragMotion, so the drag clone — raised after drag-begin — stays
        // above the line.
        if (this._dropLine) {
            Main.uiGroup.set_child_above_sibling(this._dropLine, null);
        }
    }

    /**
     * The drag is over, dropped or not. Clear the drag state and rebuild — not
     * inside acceptDrop: the Shell still holds the drag actor while that runs.
     */
    _onDragEnd() {
        this._dragging = null;
        DND.removeDragMonitor(this._dragMonitor);
        this._hideDropLine();
        this._refreshTodoMenu();
    }

    /**
     * The drop itself, called by the Shell through the row's acceptDrop.
     * Returning true makes the Shell finish the drag.
     *
     * A task only moves inside its own category, so a drop on another category's
     * row (the 'All' tab) is rejected and the row snaps back. Every rejected
     * path returns false and writes nothing.
     */
    _onDrop(toIndex, toCategory) {
        if (!this._dragging
            || this._dragging.category !== toCategory
            || this._dragging.index === toIndex) {
            return false;
        }
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.moveTaskTo(parsed.raw, this._dragging.index, toIndex);
        if (updated === parsed.raw) {
            return false;
        }
        Storage.writeTodo(this._todoPath(), updated);
        return true;
    }

    /**
     * Drag feedback: show the insertion line above or below the row under the
     * pointer, and tell the Shell whether that spot can take the drop (NO_DROP
     * gives the no-drop cursor for free).
     */
    _onDragMotion(event) {
        if (!this._dragging) {
            return DND.DragMotionResult.CONTINUE;
        }
        const row = this._findTaskRow(event.targetActor);
        if (!row
            || row._todoCategory !== this._dragging.category
            || row._todoIndex === this._dragging.index) {
            this._hideDropLine();
            return DND.DragMotionResult.NO_DROP;
        }
        const [x, y] = row.get_transformed_position();
        const height = row.get_height();
        const below = event.y >= y + height / 2;
        this._dropLine.set_width(row.get_width());
        this._dropLine.set_position(x, below ? y + height : y);
        this._dropLine.visible = true;
        return DND.DragMotionResult.MOVE_DROP;
    }

    /**
     * The task row an actor belongs to, or null.
     */
    _findTaskRow(actor) {
        let current = actor;
        while (current) {
            if (current._delegate instanceof PopupMenu.PopupBaseMenuItem
                && current._todoCategory !== undefined) {
                return current;
            }
            current = current.get_parent();
        }
        return null;
    }

    _hideDropLine() {
        if (this._dropLine) {
            this._dropLine.visible = false;
        }
    }

    /**
     * Reorder a task with Alt+↑ / Alt+↓: the adjacent task is the target, so one
     * press is one step. The moved row keeps the key focus (see
     * _refreshTodoMenu).
     */
    _moveTask(index, categoryName, direction) {
        const parsed = Storage.readTodo(this._todoPath());
        const section = Storage.renderSections(Storage.parseDocument(parsed.raw))
            .find(candidate => candidate.name === categoryName);
        const pos = section
            ? section.tasks.findIndex(task => task.index === index)
            : -1;
        const other = direction === 'up' ? pos - 1 : pos + 1;
        if (pos === -1 || other < 0 || other >= section.tasks.length) {
            return;
        }
        const updated = Storage.moveTaskTo(parsed.raw, index, section.tasks[other].index);
        if (updated === parsed.raw) {
            return;
        }
        // Only once the move is known to happen: closing interactions without a
        // refresh would leave the menu showing a row that is already gone.
        this._closeInteractions();
        Storage.writeTodo(this._todoPath(), updated);
        // moveTaskTo lands the task in the target's slot, so it sits at `other`
        // in the new document; remember its line index for the focus hand-back.
        const moved = Storage.renderSections(Storage.parseDocument(updated))
            .find(candidate => candidate.name === categoryName);
        this._focusIndex = moved ? moved.tasks[other].index : -1;
        this._refreshTodoMenu();
    }
}