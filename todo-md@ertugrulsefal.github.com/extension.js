import St from 'gi://St';
import GLib from 'gi://GLib';
import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import Pango from 'gi://Pango';

import {Extension} from 'resource:///org/gnome/shell/extensions/extension.js';
import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PanelMenu from 'resource:///org/gnome/shell/ui/panelMenu.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';

import * as Storage from './storage.js';
import {TabBar} from './tabBar.js';
import {RowFactory, capWidth} from './rowFactory.js';

export default class TodoExtension extends Extension {
    enable() {
        // Single-edit invariant: at most one row is being edited at any time.
        // Reset on enable — the Extension instance survives disable/enable.
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        this._openIdleId = 0;

        // GSettings backend (schema id: metadata.json settings-schema).
        this._settings = this.getSettings();
        // Live-rewire: when the configured path changes, watch the new file.
        // `changed::<key>` detail syntax per gjs.guide preferences.md.
        this._settingsSignal = this._settings.connect('changed::todo-file-path',
            () => {
                this._editingIndex = -1;
                this._addingCategory = null;
                this._addingNewCategory = false;
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
                    // Menu closed: an uncommitted edit must not survive.
                    this._editingIndex = -1;
                    this._addingCategory = null;
                    this._addingNewCategory = false;
                }
            });

        // Row factory: the actions are the extension's own methods, injected
        // so rowFactory.js stays free of this extension's private state.
        this._rowFactory = new RowFactory({
            menuWidth: this._settings.get_int('menu-width'),
            onToggle: index => this._toggleTask(index),
            onEdit: index => this._startEditing(index),
            onDelete: index => this._deleteTask(index),
            onMove: (index, direction) => this._moveTask(index, direction),
            onAddTask: (text, categoryName) => this._addTask(text, categoryName),
            onFinishEditing: text => this._finishEditing(text),
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
            // Any file write (external or our own) may shift line indexes, so
            // an in-progress edit cannot be trusted: close it (single-edit
            // rule) and rebuild.
            this._editingIndex = -1;
            this._addingCategory = null;
            this._addingNewCategory = false;
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

        const todo = Storage.readTodo(this._todoPath());
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

        // The tab bar is PERSISTENT (created once, like the
        // content scroll wrapper) and ALWAYS horizontally scrollable —
        // only the tab buttons are refilled per refresh, so the
        // hadjustment (horizontal scroll position) survives every
        // rebuild, including category switches (user test 4).
        // CRITICAL: it must be a PLAIN actor, NOT a PopupBaseMenuItem —
        // menu.box children with a PopupBaseMenuItem _delegate are
        // destroyed by menu.removeAll() (popupMenu.js 46.0 :827-850
        // _getMenuItems + destroy), which crashed the shell (SEGV,
        // journal 2026-09-26 21:26).
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
            name => this._switchTo(name));

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

        // Scrollable content area (the shell's own PopupSubMenu
        // pattern, popupMenu.js 46.0 :1060-1071: St.ScrollView +
        // clip_to_allocation + CSS max-height — the scrollbar only engages
        // once a max-height is set). The tab bar stays fixed above it and
        // the wrapper persists, keeping the scroll offset stable.
        const contentSection = this._contentSection;

        const visibleSections = this._activeCategory === ALL_TAB
            ? sections
            : sections.filter(section => section.name === this._activeCategory);

        for (const section of visibleSections) {
            // Non-reactive header + interactive child: the proven entryItem
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

            const addBtn = new St.Button({
                style_class: 'todo-icon-button button',
                accessible_name: `Add task to ${section.name}`,
                child: new St.Icon({
                    icon_name: 'list-add-symbolic',
                    style_class: 'system-status-icon',
                }),
            });
            addBtn.set_x_align(Clutter.ActorAlign.END);
            const categoryName = section.name;
            addBtn.connect('clicked', () => {
                this._toggleAdd(categoryName);
            });
            header.add_child(addBtn);
            // Every content row fills the FIXED wrapper width — without
            // x_expand a short category's rows keep their natural width and
            // the right side collapses (the menu 'shrinks' on switch — user
            // test 5).
            header.set_x_expand(true);
            contentSection.addMenuItem(header);

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
            for (let ti = 0; ti < tasks.length; ti++) {
                const task = tasks[ti];
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
                    ti === 0, ti === tasks.length - 1, section.name,
                    prunedColors);
                taskRow.set_x_expand(true);
                contentSection.addMenuItem(taskRow);
            }
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
        this._editingIndex = index;
        this._addingCategory = null;
        this._addingNewCategory = false;
        this._refreshTodoMenu();
    }

    /**
     * Close any open inline interaction (the edit row or a category add
     * entry) without writing anything.
     */
    _cancelEditing() {
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
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
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
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
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
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
        this._editingIndex = -1;
        this._addingCategory = categoryName;
        this._addingNewCategory = false;
        this._refreshTodoMenu();
    }

    /**
     * Toggle a task's checkbox state, persist and refresh.
     *
     */
    _toggleTask(index) {
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
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
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.deleteTask(parsed.raw, index);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Move a task up/down within its category, persist and refresh.
     * Closing any open edit first keeps the single-edit invariant.
     *
     */
    _moveTask(index, direction) {
        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.moveTask(parsed.raw, index, direction);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }
}