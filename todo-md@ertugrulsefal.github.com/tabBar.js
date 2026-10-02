import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as Storage from './storage.js';

/**
 * The persistent category tab strip: the `All` tab, one tab per category and
 * the far-right "new category" button, on a horizontally scrollable rail.
 *
 * WHY THIS IS A SEPARATE MODULE (audit A1, EGO best practices "Modules are
 * Better Than a Single File" / "Keep the Default Entry Point as Small as
 * Possible"): it is one self-contained actor tree with one lifecycle, and it
 * is where feature #3 (drag-and-drop reordering of categories) will land.
 *
 * 🔴 THE ONE INVARIANT THAT MUST NOT CHANGE — the shell SEGVs otherwise:
 * the strip is added to `menu.box` as a PLAIN actor. `menu.removeAll()`
 * destroys every `menu.box` child whose `_delegate` is a PopupBaseMenuItem
 * (popupMenu.js 46.0 :827-850 → `_getMenuItems` → `destroy()`), and this cost
 * a real shell crash on 2026-09-26 21:26. So: no PopupMenuItem, no
 * PopupBaseMenuItem, no `menu.addMenuItem` in this file. Pinned by a test.
 *
 * Persistent by design: the actors are built once in `attach()` and only the
 * buttons inside `tabsBox` are refilled by `refill()`. That is what keeps the
 * horizontal scroll position (`hadjustment`) across rebuilds, including when
 * the user switches category (user test 4).
 */
export class TabBar {
    /**
     * Build the strip once. Nothing is attached to a menu yet.
     */
    constructor() {
        this.bar = new St.BoxLayout({style_class: 'todo-tab-bar'});
        this.bar.set_x_expand(true);
        this.bar.set_reactive(true); // receive scroll events

        this.tabsBox = new St.BoxLayout();
        this.scroller = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.NEVER,
            // CRITICAL: St's own wheel handler consumes scroll events
            // (st-scroll-view.c :751 returns TRUE) and routes the wheel to the
            // VADJUSTMENT only (`:771`) — useless here (vscrollbar NEVER).
            // Disabling it lets our handler on `bar` receive the wheel.
            enable_mouse_scrolling: false,
        });
        this.scroller.add_child(this.tabsBox);
        this.scroller.set_x_expand(true);
        // NOTE: no min-width/max-width here — the menu.box itself is
        // force-sized (width + max-width, set in _refreshTodoMenu), and a
        // min-width on the scroller would eat the full menu width and push
        // the far-right '+' button out of view (user report). The scroller
        // just expands into the remaining space; once the tabs' minimum
        // width exceeds that allocation the horizontal scrollbar engages.

        // Mouse wheel anywhere on the strip scrolls it horizontally.
        // UP = scroll left, DOWN = scroll right; SMOOTH deltas supported.
        this.bar.connect('scroll-event', (actor, event) => {
            const adj = this.scroller.hadjustment;
            if (!adj) {
                return Clutter.EVENT_PROPAGATE;
            }
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.SMOOTH) {
                // Vertical wheel produces dy; horizontal wheel/trackpad dx.
                const [dx, dy] = event.get_scroll_delta();
                adj.value += (dx + dy) * adj.step_increment;
                return Clutter.EVENT_STOP;
            }
            if (direction === Clutter.ScrollDirection.DOWN) {
                adj.value += adj.step_increment;
                return Clutter.EVENT_STOP;
            }
            if (direction === Clutter.ScrollDirection.UP) {
                adj.value -= adj.step_increment;
                return Clutter.EVENT_STOP;
            }
            return Clutter.EVENT_PROPAGATE;
        });

        // Far-right '+' — the new-category entry point (fixed, outside the
        // scroller so it is always reachable).
        this.newCategoryButton = new St.Button({
            style_class: 'todo-icon-button button',
            accessible_name: 'New category',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        this.newCategoryButton.set_x_align(Clutter.ActorAlign.END);

        this.bar.add_child(this.scroller);
        this.bar.add_child(this.newCategoryButton);
    }

    /**
     * Put the strip on the menu as its FIRST row. Refill-only: the scroller and
     * its adjustments survive, so the horizontal scroll position does too.
     *
     * @param {St.BoxLayout} menuBox - The popup menu's box (NOT the menu
     *   object: children added here are invisible to `menu.removeAll()`'s
     *   bookkeeping, which is exactly what keeps the strip alive).
     */
    attach(menuBox) {
        menuBox.add_child(this.bar);
    }

    /**
     * Take the strip off the menu without destroying it (called before a
     * rebuild; the actor is re-attached by `attach`).
     *
     * @param {St.BoxLayout} menuBox - The menu box to remove the child from.
     */
    detach(menuBox) {
        menuBox.remove_child(this.bar);
    }

    /**
     * Drop the tab buttons; the strip and its scroll position stay.
     */
    clearTabs() {
        this.tabsBox.remove_all_children();
    }

    /**
     * Build the buttons for the current sections.
     *
     * @param {Array<{name: string, tasks: Array}>} sections - From
     *   Storage.renderSections().
     * @param {Object<string, string>} colors - Pruned category → colour map.
     * @param {string|null} activeCategory - Currently shown category, `null`
     *   for the `All` tab.
     * @param {Function} onSelect - Called with the category name (or `null`
     *   for `All`) when a tab is activated.
     */
    refill(sections, colors, activeCategory, onSelect) {
        this.tabsBox.remove_all_children();
        if (sections.length > 1) {
            const tabs = [{name: null, label: 'All'}]
                .concat(sections.map(section => ({
                    name: section.name, label: section.name})));
            for (const tab of tabs) {
                const button = this._makeButton(tab, colors, activeCategory);
                button.connect('clicked', () => {
                    onSelect(tab.name);
                });
                this.tabsBox.add_child(button);
            }
            return;
        }
        // Single category: show it as a (checked) tab for visual balance.
        const button = this._makeButton(
            {name: sections[0].name, label: sections[0].name},
            colors, activeCategory);
        button.set_checked(true);
        this.tabsBox.add_child(button);
    }

    /**
     * One tab button: a toggle-mode St.Button whose text lives in a child
     * St.Label (St.Button has no clutter_text of its own — journal
     * 2026-09-26). Labels keep EllipsizeMode.NONE: an ellipsized label reports
     * a small MINIMUM width, so the scroll cap never engages and the tabs get
     * squeezed instead of scrolling (St.Label defaults to END, st-label.c
     * :336 — user-tested).
     *
     * @param {{name: string|null, label: string}} tab - Tab to build.
     * @param {Object<string, string>} colors - Category → colour map.
     * @param {string|null} activeCategory - Currently shown category.
     * @returns {St.Button} The button (not yet added to the strip).
     */
    _makeButton(tab, colors, activeCategory) {
        const button = new St.Button({
            style_class: 'todo-tab button',
            toggle_mode: true,
        });
        const tabLabel = new St.Label({text: tab.label});
        button.set_child(tabLabel);
        tabLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        // Tabs carry the category color too (the content header is filtered
        // away when a tab is inactive).
        if (tab.name && colors[tab.name]) {
            button.set_style(Storage.categoryColorCss(tab.name, colors));
        }
        button.set_checked(activeCategory === tab.name);
        return button;
    }
}