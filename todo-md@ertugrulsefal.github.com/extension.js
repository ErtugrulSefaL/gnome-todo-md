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
        // Single-edit invariant: at most one row is being edited at any time.
        // Reset on enable — the Extension instance survives disable/enable.
        this._closeInteractions();
        this._openIdleId = 0;

        // GSettings backend (schema id: metadata.json settings-schema).
        this._settings = this.getSettings();
        // Live-rewire: when the configured path changes, watch the new file.
        // `changed::<key>` detail syntax per gjs.guide preferences.md.
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
        // Re-render when the menu width changes: the menu box carries the
        // forced width, the persistent tab scroller its min/max pair —
        // both re-applied inline, then the menu rebuilds.
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
                    //
                    // The source id is kept so disable() can cancel it: the
                    // guidelines require every main loop source to be removed
                    // there, even one that returns SOURCE_REMOVE, and a
                    // pending idle would otherwise refresh a torn-down menu.
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

        // Faz 9: drag-and-drop state and the insertion line. The line has to
        // exist BEFORE _applyColorScheme() so it gets the scheme class too.
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
     * The extension's own CSS cannot read the theme's ink: St's stylesheet
     * grammar has no `currentColor` (verified against libst — the token does
     * not exist), so hard-coded colours end up invisible in one of the two
     * themes. That is exactly what happened: white rings on the light shell
     * theme, plus scrollbar handles that the theme itself draws at an effective
     * ~2px (#bdbdbd inside an 8px bar with a 3px transparent border).
     *
     * The scheme is read here and the menu box is tagged; stylesheet.css scopes
     * every theme-dependent colour under `.todo-dark` / `.todo-light`.
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
        // The insertion line is NOT inside menu.box — it lives on Main.uiGroup
        // so it never joins the menu's layout — so it carries the scheme class
        // DIRECTLY instead of inheriting it as a descendant.
        if (this._dropLine) {
            this._dropLine.remove_style_class_name('todo-light');
            this._dropLine.remove_style_class_name('todo-dark');
            this._dropLine.add_style_class_name(dark ? 'todo-dark' : 'todo-light');
        }
    }

    disable() {
        this._unwatchTodoFile();
        // Every main loop source has to go, even one that already returned
        // SOURCE_REMOVE — a pending idle would call back into a torn-down
        // menu (review-guidelines: "Remove main loop sources").
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
        // Faz 9: the drag monitor is a MODULE-GLOBAL list in the Shell, so it
        // must never outlive the extension; the insertion line is our own actor
        // on Main.uiGroup and has to go too.
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
        // PopupSubMenu object itself owns shell-side state (a
        // Main.sessionMode connection) — destroy it before its actor's
        // parent goes away.
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
     * Watch the configured todo file for external changes. Created per
     * enable(); re-created by the settings-changed handler when the path
     * setting changes (single monitor at any time).
     */
    _watchTodoFile() {
        this._todoMonitor = Gio.File.new_for_path(this._todoPath())
            .monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitorSignal = this._todoMonitor.connect('changed', () => {
            // Our OWN writes fire the monitor too (replace_contents emits
            // CREATED/CHANGES_DONE_HINT — measured in the Faz 9 fix round). We
            // already refreshed for them, and refreshing AGAIN throws away what
            // that refresh just restored — the key focus after a keyboard move.
            // Identical content is therefore ignored.
            const current = Storage.readTodo(this._todoPath());
            if (current.ok && current.raw === this._lastWritten) {
                return;
            }
            // Any file write (external or our own) may shift line indexes, so
            // an in-progress edit cannot be trusted: close it (single-edit
            // rule) and rebuild.
            this._closeInteractions();
            this._refreshTodoMenu();
        });
    }

    /**
     * Close every inline interaction at once: at most ONE may be open at a
     * time — a task edit, a category add entry, the new-category entry, a
     * category rename or a category action panel. The five fields are reset
     * ONLY here (the static guard asserts exactly that), so they cannot
     * drift apart and two interactions can never be open together.
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
     * Hide the category action panel (Faz 7) and reset its sub-states: the
     * pending delete confirmation (the next open starts from 'Delete') and
     * the colour picker (the next open starts from the four items).
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
                    // written as a heading. Keep the entry open with the text
                    // the user typed — closing it here would make Enter look
                    // like a broken button.
                    return Clutter.EVENT_STOP;
                }
                if (!Storage.writeTodo(this._todoPath(), updated)) {
                    // Audit N4: a failed write changes NOTHING — the entry
                    // stays open with the typed name, and no colour is stored
                    // for a category the file does not contain.
                    return Clutter.EVENT_STOP;
                }
                // File first, then colour: `changed::category-colors` fires
                // synchronously and the refresh prunes keys the file lacks.
                this._addingNewCategory = false;

                // Auto-color: the next palette entry in order,
                // wrapping around after the last.
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
     * Build the inline category RENAME row (Faz 7): the same row shape as the
     * new-category entry, prefilled with the current name and preselected, so
     * typing replaces it. Enter commits through Storage.renameCategory.
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
        // Preselect: typing a new name replaces the old one instead of
        // appending to it.
        entry.clutter_text.set_selection(0, categoryName.length);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() !== Clutter.KEY_Return) {
                return Clutter.EVENT_PROPAGATE;
            }
            const name = e.get_text().trim();
            const parsed = Storage.readTodo(this._todoPath());
            const updated = Storage.renameCategory(parsed.raw, categoryName, name);
            if (updated === parsed.raw) {
                // Rejected: an unusable name, the unchanged name, or a name
                // already taken. Keep the entry open with the typed text (D5).
                return Clutter.EVENT_STOP;
            }
            if (!Storage.writeTodo(this._todoPath(), updated)) {
                // Audit N4: a failed write changes NOTHING — the text stays.
                return Clutter.EVENT_STOP;
            }
            this._closeInteractions();
            // The active tab follows the rename BEFORE the colour write:
            // set_value fires changed::category-colors SYNCHRONOUSLY (L-018),
            // and that refresh drops an active category the file no longer has
            // — which is what threw the user back to 'All' (reported
            // 2026-10-10, right after the first manual test of this panel).
            if (this._activeCategory === categoryName) {
                this._activeCategory = name;
            }
            // File first, then colour (L-018): the stored colour follows the
            // new name, so a rename never silently loses a colour.
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
     * Build the category ACTION PANEL (Faz 7, approved design H) ONCE.
     *
     * It is a PopupSubMenu — the shell's own inline expander (popupMenu.js
     * :1053-1192) — so it looks and animates like a native submenu while
     * living in the content flow, right below the header that opened it.
     *
     * Its items are added to the submenu box DIRECTLY, not through
     * addMenuItem(): that call wires 'activate' to itemActivated(), which
     * closes the menu on the FIRST click (:694-701) — and the two-step delete
     * needs the panel to survive that first click. Every item therefore closes
     * the panel itself, explicitly.
     *
     */
    _makeActionsPanel() {
        // The header's ⋮ button is the affordance; the submenu arrow exists
        // only because open()/close() animate it (:1128-1136). It is kept
        // invisible rather than borrowing the button's icon, which would mean
        // reaching into the submenu's private _arrow.
        const arrow = new St.Icon({icon_name: 'pan-down-symbolic'});
        arrow.visible = false;
        this._actions = new PopupMenu.PopupSubMenu(null, arrow);

        const addItem = new PopupMenu.PopupMenuItem('Add task');
        addItem.connect('activate', () => {
            const target = this._actionsCategory;
            this._hideActionsPanel();
            this._toggleAdd(target);
        });

        // Faz 8: opens the colour picker row INSIDE the panel (a panel
        // sub-state, so the five-field invariant does not grow).
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
                // First click arms the confirmation and the panel stays open
                // (see the docstring: that is why the items bypass
                // addMenuItem).
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
     * The colour picker row (Faz 8): one swatch per palette entry plus a
     * "remove colour" button, hidden until 'Change color' is chosen.
     *
     * It lives INSIDE the panel, so the single-interaction invariant does not
     * grow a sixth field — the picker is a panel sub-state, exactly like the
     * two-step delete arm, and _hideActionsPanel() resets both.
     *
     * The swatch colour is set inline from Storage.CATEGORY_PALETTE (our own
     * constant, never user input); only the shape and the selected ring live in
     * stylesheet.css.
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
        // picker that can only ADD colours could never go back.
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
     * Swap the panel into its colour-picker state: the four items give the
     * panel to the swatch row. The two-step delete arm is dropped — the two
     * sub-states exclude each other.
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
     * Ring the swatch that matches the category's CURRENT colour (and the
     * 'none' swatch when it has none), so the picker always shows the truth —
     * the same colour the header and the tab are painted with.
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
     * NO file write happens on this path, and that is correct: the colour lives
     * in GSettings only, so the L-018 "file first, then the map" rule does not
     * apply here — the map IS the source of truth for colours. (A guard pins
     * that no writeTodo creeps in.)
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
     * under its header (one panel, one place to render it).
     *
     */
    _openActionsFor(categoryName) {
        this._closeInteractions();
        this._activeCategory = categoryName;
        this._actionsCategory = categoryName;
        this._refreshTodoMenu();
    }

    /**
     * Delete a category with everything in it (approved semantics A), persist
     * and refresh. The two-step confirmation happens in the panel, not here.
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
            // Audit N4: a failed write changes NOTHING — no colour is dropped
            // for a category the file still contains.
            this._cancelEditing();
            return;
        }
        this._closeInteractions();
        // File first, then colour (L-018): drop the deleted category's colour
        // explicitly. The refresh prune keeps the whole map when the deleted
        // category was the file's last heading (see removeCategoryColor).
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
     * Switch the active category tab. Closes any open inline interaction
     * (locked decision: a tab switch must not leave an edit or add
     * entry open). Remembered for the session; an unknown
     * category falls back to 'All' at render time.
     *
     */
    _switchTo(categoryName) {
        this._cancelEditing();
        this._activeCategory = categoryName;
        // NOTE: the scroll position is deliberately NOT reset here
        // (selecting a category must not jump to the top — the
        // persistent wrapper keeps both scroll offsets across refreshes).
        this._refreshTodoMenu();
    }

    /**
     * Resolve the todo file path from the GSettings value (empty value and
     * '~' forms fall back / expand — see Storage.resolveTodoPath).
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
        // FIXED menu width: the BoxPointer takes its size from
        // the menu's NATURAL width; min-width alone only raises the
        // minimum (st-theme-node.c :3936) and never widens the natural
        // (:3943), so short content still shrank the menu (user test 5).
        // CSS 'width' FORCES the preferred width to W and 'max-width'
        // clamps the natural down to the same W — the frame can then
        // never be narrower or wider than W.
        const menuWidth = this._settings.get_int('menu-width');
        menu.box.set_style(`width: ${menuWidth}px; max-width: ${menuWidth}px;`);
        // Persistent scroll wrapper (created once, lives as long as the
        // extension is enabled): content is cleared and refilled per
        // refresh, so the vadjustment — and the scroll position — survive
        // every rebuild WITHOUT visible jumps. menu.removeAll() does not
        // track it (added via menu.box), which is exactly what we want.
        if (!this._scrollWrapper) {
            const maxMenuHeight = this._settings.get_int('max-menu-height');
            this._contentSection = new PopupMenu.PopupMenuSection();
            this._scrollWrapper = new St.ScrollView({
                style_class: 'todo-scroll',
                vscrollbar_policy: St.PolicyType.AUTOMATIC,
                x_expand: true,
            });
            // Fixed width (single GSettings value, min == max): the menu
            // must not widen with content nor shrink with short categories
            // (single adjustable width, user decision). The menu
            // box itself is force-sized in _refreshTodoMenu (width +
            // max-width); this min-width keeps the wrapper filling it.
            const menuWidth = this._settings.get_int('menu-width');
            this._scrollWrapper.set_style(
                `max-height: ${maxMenuHeight}px; min-width: ${menuWidth}px;`);
            this._scrollWrapper.clip_to_allocation = true;
            this._scrollWrapper.add_child(this._contentSection.actor);
        } else {
            // Detach before rebuilding the fixed rows: the wrapper is re
            // attached right below them further down, so the tab bar stays
            // the first row (set_child_below_sibling only affects stacking,
            // not the BoxLayout order — user-tested).
            menu.box.remove_child(this._scrollWrapper);
        }
        this._contentSection.removeAll();

        if (!this._actions) {
            this._makeActionsPanel();
        }

        // The panel actor is UNTRACKED by removeAll() (its delegate is a
        // PopupSubMenu, not a menu item) — detach it here so the render
        // step below can place it under the right header, or drop it.
        if (this._actions.actor.get_parent()) {
            this._actions.actor.get_parent().remove_child(this._actions.actor);
        }

        const todo = Storage.readTodo(this._todoPath());
        // What the menu now shows: the file monitor compares against this, so
        // our OWN writes never trigger a second, redundant rebuild.
        this._lastWritten = todo.ok ? todo.raw : null;
        const doc = Storage.parseDocument(todo.raw);

        // Every category renders as a non-clickable header row (with a '+'
        // button) followed by its task rows — task-less categories are
        // actionable now that adding is per-category.
        const sections = Storage.renderSections(doc);

        // Category colors from the settings map. Dead keys (categories
        // that no longer exist) are pruned automatically; the write happens
        // only when the prune actually removed something, so the
        // changed:: signal does not cause a refresh loop.
        //
        // The whole decision — which list is authoritative, and WHEN not to
        // prune at all — lives in Storage.prunedColorsForDocument() so it can
        // be unit-tested; it used to sit here, untested, and twice wrong
        // (audit D1: pruning against `doc.categories` dropped the whole map
        // for an empty file; then pruning against the rendered sections still
        // dropped it, because a file that lost every '##' heading renders one
        // implicit 'General' section and all six real colours looked dead —
        // 6 → 0, written permanently through set_value).
        //
        // A failed read is skipped entirely. `readTodo` reports it via `ok`,
        // and a transient failure (editor atomic save, rename window) would
        // otherwise look exactly like "the user deleted every category" and
        // wipe the map for good.
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const prunedColors = todo.ok
            ? Storage.prunedColorsForDocument(colors, doc)
            : colors;
        if (todo.ok && prunedColors !== colors) {
            this._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', prunedColors));
        }

        // Tab bar, ALWAYS rendered ('All' shows every category — default;
        // other tabs filter the content to one category). The content model
        // is unchanged — a tab only picks what gets rendered. A '+' button at
        // the far right opens the new-category inline entry (design change:
        // the separate 'New category' row was ugly; the bar is permanent so
        // categories can be created from any file state).
        const ALL_TAB = null;
        if (this._activeCategory === undefined) {
            this._activeCategory = ALL_TAB;
        }
        // Drop the remembered selection if its category no longer exists.
        if (this._activeCategory !== ALL_TAB
            && !sections.some(section => section.name === this._activeCategory)) {
            this._activeCategory = ALL_TAB;
        }
        // Same rule for the two Faz 7 states: a target that vanished (an
        // external edit) must not leave a panel armed for a dead name.
        const knownCategory = name => name === null
            || sections.some(section => section.name === name);
        if (!knownCategory(this._actionsCategory)
            || !knownCategory(this._renamingCategory)) {
            this._closeInteractions();
        }

        // The tab bar is PERSISTENT (created once, like the
        // content scroll wrapper) and ALWAYS horizontally scrollable —
        // only the tab buttons are refilled per refresh, so the
        // hadjustment (horizontal scroll position) survives every
        // rebuild, including category switches (user test 4).
        // CRITICAL: it must be a PLAIN actor, NOT a PopupBaseMenuItem —
        // menu.box children with a PopupBaseMenuItem _delegate are destroyed
        // by menu.removeAll() (_getMenuItems + destroy), which crashed the
        // shell (SEGV, journal 2026-09-26 21:26).
        // Per-version shell line numbers for every API claim: docs/verified-apis.md.
        if (!this._tabBar) {
            // The strip itself lives in tabBar.js; this file only decides WHEN
            // it exists, where it sits and what fills it.
            this._tabBar = new TabBar();
            this._tabBar.newCategoryButton.connect('clicked', () => {
                this._cancelEditing();
                this._addingNewCategory = !this._addingNewCategory;
                this._refreshTodoMenu();
            });
        } else {
            // Detach and clear the tab buttons; the strip (and its
            // hadjustment) survive.
            this._tabBar.detach(menu.box);
            this._tabBar.clearTabs();
        }

        // Re-attach the persistent tab bar as the FIRST row (refill only; the
        // scroller's hadjustment — horizontal scroll — survives).
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

        // Re-attach the persistent scroll wrapper BELOW the fixed rows
        // (tab bar first). Detaching/re-attaching does not touch the
        // vadjustment, so the scroll position survives.
        menu.box.add_child(this._scrollWrapper);

        // Scrollable content area (the shell's own PopupSubMenu pattern:
        // St.ScrollView + clip_to_allocation + CSS max-height — the
        // scrollbar only engages once a max-height is set). The tab bar stays
        // fixed above it and the wrapper persists, keeping the scroll offset
        // stable. (Shell line numbers: docs/verified-apis.md.)
        const contentSection = this._contentSection;

        const visibleSections = this._activeCategory === ALL_TAB
            ? sections
            : sections.filter(section => section.name === this._activeCategory);

        // Faz 9: the row a keyboard move produced takes the key focus back, so
        // a second Alt+↑/↓ press keeps working without re-clicking. The target
        // is CONSUMED here and never left set, so an unrelated later refresh
        // cannot yank the focus back.
        const focusTarget = this._focusIndex;
        this._focusIndex = -1;
        let focusRow = null;

        for (const section of visibleSections) {            // Non-reactive header + interactive child: the proven entryItem
            // pattern (an interactive child inside a non-reactive row).
            const header = new PopupMenu.PopupBaseMenuItem(
                {activate: false, can_focus: false});
            const label = new St.Label({
                text: section.name,
                style_class: 'todo-category-header',
            });
            // Same width cap as task labels (menu-width, GSettings) + fixed
            // ellipsize: a long category name must not widen the menu.
            label.clutter_text.set_ellipsize(Pango.EllipsizeMode.END);
            // Q1=A: the color applies to the header TEXT via inline style
            // (set_style verified in the offline mirror, st14 st.widget).
            const colorCss = Storage.categoryColorCss(section.name, prunedColors);
            const headerStyle
                = `max-width: ${this._settings.get_int('menu-width')}px;`;
            label.set_style(headerStyle + (colorCss || ''));
            label.set_x_expand(true);
            header.add_child(label);

            // Faz 7: the category action menu replaced the per-header '+'
            // button. The panel itself renders right below this header
            // (see the render step further down), so the button only
            // toggles it; adding a task is now the panel's first entry.
            const categoryName = section.name;
            const actionsBtn = new St.Button({
                style_class: 'todo-icon-button button',
                accessible_name: `Actions for ${categoryName}`,
                child: new St.Icon({
                    icon_name: 'view-more-symbolic',
                    style_class: 'system-status-icon',
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
            // Every content row fills the FIXED wrapper width — without
            // x_expand a short category's rows keep their natural width and
            // the right side collapses (the menu 'shrinks' on switch — user
            // test 5).
            header.set_x_expand(true);
            contentSection.addMenuItem(header);

            // Faz 7: the action panel renders as an untracked row directly
            // below its header — a PopupSubMenu actor, NOT a menu item, so
            // contentSection.removeAll() never destroys it (popupMenu.js
            // :827-850).
            if (this._actionsCategory === categoryName) {
                contentSection.box.add_child(this._actions.actor);
                // sourceActor must be a menu item: the submenu's own
                // Left-key handler dereferences sourceActor._delegate.active
                // (popupMenu.js :1160-1164), and this header is the item
                // the panel belongs to.
                this._actions.sourceActor = header;
                this._actions.focusActor = actionsBtn;
                this._actions.open(true);
            }

            // The rename entry takes the panel's slot when Rename was
            // chosen (the single-interaction rule keeps them apart).
            if (this._renamingCategory === categoryName) {
                const renameRow = this._makeRenameRow(categoryName);
                renameRow.row.set_x_expand(true);
                contentSection.addMenuItem(renameRow.row);
                renameRow.entry.grab_key_focus();
            }

            // The active add entry renders directly under its category
            // header; render derives solely from _addingCategory, so two
            // open adders can never coexist (single-add invariant).
            if (this._addingCategory === categoryName) {
                const addRow = this._rowFactory.makeAddRow(categoryName);
                addRow.row.set_x_expand(true);
                contentSection.addMenuItem(addRow.row);
                // Grab focus only after the row is on stage.
                addRow.entry.grab_key_focus();
            }

            const tasks = section.tasks;
            for (const task of tasks) {
                // The row being edited renders as an inline entry instead of
                // the usual label + buttons. Render derives solely from
                // _editingIndex, so two open editors can never coexist.
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

        // Faz 9: hand the key focus to the row a keyboard move produced, so a
        // second Alt+↑/↓ press keeps working without re-clicking.
        if (focusRow) {
            focusRow.grab_key_focus();
        }

        // (The scroll position is never reset: the persistent wrapper keeps
        // it across tab switches.)
    }


    /**
     * Switch a row into inline edit mode. Replaces any existing inline
     * interaction (single-edit rule: render derives solely from
     * _editingIndex; the add entry is closed together with the edit).
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
        // Audit N4: a failed write must not close the edit and discard the new
        // text. Same rule as _addTask.
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
        // Audit N4: the write result decides whether the entry may close. On
        // failure (disk full, read-only file) the typed text STAYS in the entry
        // instead of vanishing with a refresh that re-reads the old file — the
        // same behaviour the rejected-category-name path already uses (audit D5).
        if (!Storage.writeTodo(this._todoPath(), updated)) {
            return;
        }
        this._closeInteractions();
        this._refreshTodoMenu();
    }

    /**
     * Open (or toggle closed) the inline add entry of a category. Opening
     * replaces any open inline interaction (single-interaction rule).
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
     * Set up the drag-and-drop plumbing ONCE per enable() (Faz 9).
     *
     * The monitor is registered only while a drag is in flight (drag-begin →
     * drag-end); the insertion line lives on Main.uiGroup, like the Shell's own
     * drag actor, so it never takes part in the menu's layout.
     */
    _setupDragAndDrop() {
        this._dragMonitor = {
            dragMotion: event => this._onDragMotion(event),
            // CONTINUE, never SUCCESS: a monitor that returns SUCCESS/FAILURE
            // makes the Shell return early and SKIP its own cleanup — the drag
            // actor is never destroyed, the modal grab is never popped and
            // drag-end never fires (measured in the Faz 9 spike). The DROP
            // itself belongs to the row's acceptDrop, which the Shell calls
            // next once we continue.
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
    }

    /**
     * The drag is over, dropped or not. Clear the drag state and rebuild —
     * NOT inside acceptDrop: the Shell is still holding the drag actor while
     * that runs, and a rebuild there would pull the row out from under it.
     */
    _onDragEnd() {
        this._dragging = null;
        DND.removeDragMonitor(this._dragMonitor);
        this._hideDropLine();
        this._refreshTodoMenu();
    }

    /**
     * The drop itself, called by the Shell through the row's acceptDrop.
     * Returning true makes the Shell finish the drag properly.
     *
     * Locked rule: a task only moves inside its own category, so a drop on
     * another category's row (the 'All' tab) is rejected and the row snaps
     * back. Every rejected path returns false and writes nothing.
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
     * pointer, and tell the Shell whether that spot can take the drop (the
     * no-drop cursor comes for free from NO_DROP).
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
     * The task row an actor belongs to, or null. Rows carry `_todoCategory`
     * (see rowFactory) precisely so a drag can map actors back to tasks.
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
     * Reorder a task with Alt+↑ / Alt+↓ — the keyboard path that replaced the
     * ↑↓ buttons in Faz 9. The adjacent task is the target, so one press is
     * one step; the moved row keeps the key focus (see _refreshTodoMenu).
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
        // Only once the move is known to happen: closing interactions WITHOUT
        // a refresh would leave the menu showing a row that is already gone.
        this._closeInteractions();
        Storage.writeTodo(this._todoPath(), updated);
        // moveTaskTo lands the task in the target's slot, so in the NEW
        // document it sits at `other`; remember its line index so the rebuild
        // can hand the key focus back to it.
        const moved = Storage.renderSections(Storage.parseDocument(updated))
            .find(candidate => candidate.name === categoryName);
        this._focusIndex = moved ? moved.tasks[other].index : -1;
        this._refreshTodoMenu();
    }
}