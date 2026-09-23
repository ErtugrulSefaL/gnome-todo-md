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
        this._addingCategory = null;
        this._addingNewCategory = false;

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
        // Re-render when the height limit changes (inline max-height).
        this._heightSignal = this._settings.connect('changed::max-menu-height',
            () => {
                if (this._scrollWrapper) {
                    this._scrollWrapper.set_style(
                        `max-height: ${this._settings.get_int('max-menu-height')}px;`);
                }
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
                    this._addingCategory = null;
                    this._addingNewCategory = false;
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
        if (this._colorSignal) {
            this._settings.disconnect(this._colorSignal);
            this._colorSignal = null;
        }
        if (this._heightSignal) {
            this._settings.disconnect(this._heightSignal);
            this._heightSignal = null;
        }
        if (this._scrollWrapper) {
            this._scrollWrapper.destroy();
            this._scrollWrapper = null;
            this._contentSection = null;
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
     * @returns {{row: PopupMenu.PopupBaseMenuItem, entry: St.Entry}} The row
     *   and its entry, so the caller can grab focus after adding to the menu.
     */
    /**
     * Build the inline "new category" row: an empty entry. Enter commits via
     * Storage.addCategory; the new category becomes the active tab.
     *
     * @returns {{row: PopupMenu.PopupBaseMenuItem, entry: St.Entry}} The row
     *   and its entry, so the caller can grab focus after adding to the menu.
     */
    _makeNewCategoryRow() {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            hint_text: 'New category name…',
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                const name = e.get_text().trim();
                this._addingNewCategory = false;
                if (name) {
                    const parsed = Storage.readTodo(this._todoPath());
                    const updated = Storage.addCategory(parsed.raw, name);
                    if (updated !== parsed.raw) {
                        // Write the file FIRST: setting the color below fires
                        // changed::category-colors synchronously, and the
                        // refresh's dead-key pruning would remove the just
                        // written color because the file does not contain
                        // the new category yet (found by user testing).
                        Storage.writeTodo(this._todoPath(), updated);

                        // Auto-color: the next palette entry in order,
                        // wrapping around after the last (Faz 6 request).
                        const existingCount =
                            Storage.parseDocument(parsed.raw).categories.length;
                        const colors =
                            this._settings.get_value('category-colors')
                                .recursiveUnpack();
                        colors[name] = Storage.nextCategoryColor(existingCount);
                        this._settings.set_value('category-colors',
                            GLib.Variant.new('a{ss}', colors));

                        this._activeCategory = name;
                    }
                }
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
     * (locked Faz 6 decision: a tab switch must not leave an edit or add
     * entry open). Remembered for the session (Q2=EVET); an unknown
     * category falls back to 'All' at render time.
     *
     * @param {string|null} categoryName - Category to show, or null for 'All'.
     */
    _switchTo(categoryName) {
        this._cancelEditing();
        this._activeCategory = categoryName;
        // Different content: start the scroll view at the top.
        this._scrollToTopNext = true;
        this._refreshTodoMenu();
    }


    /**
     * Switch the active category tab. Closes any open inline interaction
        this._cancelEditing();
        this._activeCategory = categoryName;
        this._refreshTodoMenu();
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
            this._scrollWrapper.set_style(`max-height: ${maxMenuHeight}px;`);
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

        const doc = Storage.parseDocument(Storage.readTodo(this._todoPath()).raw);

        // Faz 5: category colors from the settings map. Dead keys (categories
        // that no longer exist) are pruned automatically; the write happens
        // only when the prune actually removed something, so the
        // changed:: signal does not cause a refresh loop.
        const colors = this._settings.get_value('category-colors')
            .recursiveUnpack();
        const prunedColors = Storage.pruneCategoryColors(colors,
            doc.categories.map(category => category.name));
        if (prunedColors !== colors) {
            this._settings.set_value('category-colors',
                GLib.Variant.new('a{ss}', prunedColors));
        }

        // Every category renders as a non-clickable header row (with a '+'
        // button) followed by its task rows — task-less categories are
        // actionable now that adding is per-category. An empty document (no
        // categories at all) gets a synthetic implicit 'General' header so the
        // first task can be added from an empty file.
        const sections = doc.categories.map(category => ({
            name: category.name,
            tasks: Storage.categoryTasks(category),
        }));
        if (sections.length === 0) {
            sections.push({name: Storage.FALLBACK_CATEGORY, tasks: []});
        }

                // Faz 6: tab bar, ALWAYS rendered ('All' shows every category — default;
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

        const tabBar = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const box = new St.BoxLayout({style_class: 'todo-tab-bar'});
        box.set_x_expand(true);
        if (sections.length > 1) {
            const tabs = [{name: null, label: 'All'}]
                .concat(sections.map(section => ({
                    name: section.name, label: section.name})));
            for (const tab of tabs) {
                const button = new St.Button({
                    label: tab.label,
                    style_class: 'todo-tab button',
                    toggle_mode: true,
                });
                // Tabs carry the category color too (the content header is
                // filtered away when a tab is inactive).
                if (tab.name) {
                    const tabCss = Storage.categoryColorCss(tab.name, prunedColors);
                    if (tabCss) {
                        button.set_style(tabCss);
                    }
                }
                button.set_checked(this._activeCategory === tab.name);
                button.set_x_expand(true);
                button.connect('clicked', () => {
                    this._switchTo(tab.name);
                });
                box.add_child(button);
            }
        } else {
            // Single category: show it as a (checked) tab for visual balance.
            const button = new St.Button({
                label: sections[0].name,
                style_class: 'todo-tab button',
                toggle_mode: true,
            });
            if (prunedColors[sections[0].name]) {
                button.set_style(
                    Storage.categoryColorCss(sections[0].name, prunedColors));
            }
            button.set_checked(true);
            box.add_child(button);
        }

        // Far-right '+' — the new-category entry point.
        const addCatBtn = new St.Button({
            style_class: 'todo-icon-button button',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        addCatBtn.set_x_align(Clutter.ActorAlign.END);
        addCatBtn.connect('clicked', () => {
            this._cancelEditing();
            this._addingNewCategory = !this._addingNewCategory;
            this._refreshTodoMenu();
        });
        box.add_child(addCatBtn);

        const tabItem = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        tabItem.add_child(box);
        menu.addMenuItem(tabItem);

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

        // Faz 6.5: scrollable content area (the shell's own PopupSubMenu
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
            // Q1=A: the color applies to the header TEXT via inline style
            // (set_style verified in the offline mirror, st14 st.widget).
            const colorCss = Storage.categoryColorCss(section.name, prunedColors);
            if (colorCss) {
                label.set_style(colorCss);
            }
            label.set_x_expand(true);
            header.add_child(label);

            const addBtn = new St.Button({
                style_class: 'todo-icon-button button',
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
            contentSection.addMenuItem(header);

            // The active add entry renders directly under its category
            // header; render derives solely from _addingCategory, so two
            // open adders can never coexist (single-add invariant).
            if (this._addingCategory === categoryName) {
                const addRow = this._makeAddRow(categoryName);
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
                    const editRow = this._makeEditRow(task);
                    contentSection.addMenuItem(editRow.row);
                    // Grab focus only after the row is on stage; an actor that
                    // is not yet mapped cannot take key focus.
                    editRow.entry.grab_key_focus();
                    continue;
                }

                contentSection.addMenuItem(this._makeTaskRow(task,
                    ti === 0, ti === tasks.length - 1));
            }
        }

        // A tab switch re-renders different content: start at the top. The
        // adjustment is live here (wrapper persists), so a direct set works
        // without any idle hack.
        if (this._scrollToTopNext) {
            this._scrollWrapper.vadjustment.value = 0;
            this._scrollToTopNext = false;
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
     * Switch a row into inline edit mode. Replaces any existing inline
     * interaction (single-edit rule: render derives solely from
     * _editingIndex; the add entry is closed together with the edit).
     *
     * @param {number} index - 0-based line index of the task to edit.
     */
    _startEditing(index) {
        this._editingIndex = index;
        this._addingCategory = null;
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
        this._addingCategory = null;
        this._addingNewCategory = false;
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
    /**
     * Add a task to the given category, persist and refresh.
     *
     * @param {string} text - Task text (may contain @tag(value) pairs).
     * @param {string} category - Target category name.
     */
    _addTask(text, category) {
        const trimmed = text ? text.trim() : '';
        if (!trimmed) {
            // Empty input closes the inline add instead of failing.
            this._cancelEditing();
            return;
        }

        this._editingIndex = -1;
        this._addingCategory = null;
        this._addingNewCategory = false;
        const parsed = Storage.readTodo(this._todoPath());
        const updated = Storage.addTask(parsed.raw, trimmed, category);
        Storage.writeTodo(this._todoPath(), updated);
        this._refreshTodoMenu();
    }

    /**
     * Open (or toggle closed) the inline add entry of a category. Opening
     * replaces any open inline interaction (single-interaction rule).
     *
     * @param {string} categoryName - Category whose add entry to toggle.
     */
    _toggleAdd(categoryName) {
        if (this._addingCategory === categoryName) {
            this._cancelEditing();
            return;
        }
        this._editingIndex = -1;
        this._addingCategory = categoryName;
        this._refreshTodoMenu();
    }

    /**
     * Build the inline add row for a category: an empty entry with a
     * per-category hint. Enter commits via Storage.addTask(text, category).
     *
     * @param {string} categoryName - Target category for the new task.
     * @returns {{row: PopupMenu.PopupBaseMenuItem, entry: St.Entry}} The row
     *   and its entry, so the caller can grab focus after adding to the menu.
     */
    _makeAddRow(categoryName) {
        const row = new PopupMenu.PopupBaseMenuItem(
            {activate: false, can_focus: false});
        const entry = new St.Entry({
            hint_text: `Add to "${categoryName}"…`,
            style_class: 'todo-edit-entry',
        });
        entry.set_x_expand(true);
        entry.connect('key-release-event', (e, event) => {
            if (event.get_key_symbol() === Clutter.KEY_Return) {
                this._addTask(e.get_text(), categoryName);
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });
        row.add_child(entry);
        return {row, entry};
    }

    /**
     * Toggle a task's checkbox state, persist and refresh.
     *
     * @param {number} index - 0-based line index of the task.
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
     * @param {number} index - 0-based line index of the task.
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
     * @param {number} index - 0-based line index of the task.
     * @param {string} direction - 'up' or 'down'.
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