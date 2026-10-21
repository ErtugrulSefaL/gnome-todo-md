import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';

/**
 * The persistent category tab strip: the `All` tab, one tab per category, and
 * the far-right "new category" button on a horizontally scrollable rail.
 *
 * The strip is added to `menu.box` as a PLAIN actor, never as a menu item:
 * `menu.removeAll()` destroys every `menu.box` child whose `_delegate` is a
 * PopupBaseMenuItem, which crashed the Shell. So no PopupMenuItem, no
 * PopupBaseMenuItem and no menu.addMenuItem in this file; a test pins it.
 *
 * The actors are built once in `attach()`; `refill()` only replaces the
 * buttons inside `tabsBox`, which keeps the horizontal scroll position.
 */
export class TabBar {
    /**
     * Build the strip once. Nothing is attached to a menu yet.
     */
    constructor() {
        this.bar = new St.BoxLayout({style_class: 'todo-tab-bar'});
        this.bar.set_x_expand(true);
        this.bar.set_reactive(true); // receive scroll events

        this.tabsBox = new St.BoxLayout({style_class: 'todo-tab-strip'});
        this.scroller = new St.ScrollView({
            // Both must stay AUTOMATIC: StScrollView compares the content
            // WIDTH against the rail's HEIGHT whenever vscrollbar_policy is
            // not AUTOMATIC (st-scroll-view.c, st_scroll_view_allocate), which
            // kept the horizontal scrollbar visible even when the tabs fit.
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            // St's own wheel handler consumes scroll events and routes them to
            // the vertical adjustment only; the strip needs horizontal wheel
            // handling, so it is disabled and handled below.
            enable_mouse_scrolling: false,
        });
        this.scroller.add_child(this.tabsBox);
        this.scroller.set_x_expand(true);
        // No min-width/max-width here: menu.box is force-sized, and a
        // min-width on the scroller would eat the full menu width and push the
        // '+' button out of view. The scroller expands into the remaining
        // space, and the horizontal scrollbar engages once the tabs' minimum
        // width exceeds it.

        // Mouse wheel anywhere on the strip scrolls it horizontally: UP left,
        // DOWN right, smooth deltas included.
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

        // Far-right '+' — the new-category entry point, outside the scroller so
        // it is always reachable.
        this.newCategoryButton = new St.Button({
            style_class: 'todo-icon-button button',
            accessible_name: 'New category',
            child: new St.Icon({
                icon_name: 'list-add-symbolic',
                style_class: 'system-status-icon',
            }),
        });
        this.newCategoryButton.set_x_align(Clutter.ActorAlign.END);
        this.newCategoryButton.set_y_align(Clutter.ActorAlign.CENTER);

        this.bar.add_child(this.scroller);
        this.bar.add_child(this.newCategoryButton);

        // The whole strip is one drop target for a category drag: the slot is
        // computed from the pointer in dragMotion, so acceptDrop only has to
        // confirm it. The Shell walks up from the picked actor looking for
        // `_delegate.acceptDrop`, and this actor sits above every tab.
        this._drag = null;
        this.bar._delegate = {
            acceptDrop: () => this._drag !== null && this._drag.onDrop() === true,
        };
    }

    /**
     * Put the strip on the menu as its FIRST row. Refill-only: the scroller and
     * its adjustments survive, so the horizontal scroll position does too.
     *
     */
    attach(menuBox) {
        menuBox.add_child(this.bar);
    }

    /**
     * Take the strip off the menu without destroying it (called before a
     * rebuild; the actor is re-attached by `attach`).
     *
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
     * Build the buttons for the current sections. `drag`, when given, carries
     * `onBegin(name, index)` / `onEnd()` / `onDrop()`; only then does a
     * category tab become draggable.
     *
     */
    refill(sections, colors, activeCategory, onSelect, onActions, drag) {
        this._drag = drag ?? null;
        this.tabsBox.remove_all_children();
        if (sections.length > 1) {
            const tabs = [{name: null, label: 'All'}]
                .concat(sections.map(section => ({
                    name: section.name, label: section.name})));
            for (let i = 0; i < tabs.length; i++) {
                const tab = tabs[i];
                const button = this._makeButton(tab, colors, activeCategory);
                if (tab.name !== null) {
                    // The strip's index among CATEGORIES ('All' is not one).
                    button._todoCategoryName = tab.name;
                    button._todoCategoryIndex = i - 1;
                }
                button.connect('clicked', () => {
                    onSelect(tab.name);
                });
                this._connectActions(button, tab.name, onActions);
                if (tab.name !== null && this._drag !== null) {
                    this._connectDrag(button, tab.name);
                }
                this.tabsBox.add_child(button);
            }
            return;
        }
        // Single category: show it as a (checked) tab for visual balance.
        const button = this._makeButton(
            {name: sections[0].name, label: sections[0].name},
            colors, activeCategory);
        button.set_checked(true);
        this._connectActions(button, sections[0].name, onActions);
        this.tabsBox.add_child(button);
    }

    /**
     * Right-click on a category tab opens the same action panel the header's ⋮
     * button opens. St.Button's default button mask is BUTTON1, so a
     * right-click never fires 'clicked' and cannot switch the tab.
     *
     */
    _connectActions(button, categoryName, onActions) {
        if (categoryName === null) {
            return; // the 'All' tab is not a category
        }
        button.connect('button-press-event', (actor, event) => {
            if (event.get_button() !== 3) {
                return Clutter.EVENT_PROPAGATE;
            }
            onActions(categoryName);
            return Clutter.EVENT_STOP;
        });
    }

    /**
     * A category tab drags itself — the whole tab is the handle. A plain click
     * on it still fires 'clicked': the Shell's drag gesture only takes the
     * sequence once the pointer moves past the drag threshold. The clone keeps
     * the tab in place while it moves.
     *
     */
    _connectDrag(button, categoryName) {
        button._delegate = {
            getDragActor: () => new Clutter.Clone({source: button}),
            getDragActorSource: () => button,
        };
        const draggable = DND.makeDraggable(button);
        draggable.connect('drag-begin',
            () => this._drag.onBegin(categoryName, button._todoCategoryIndex));
        draggable.connect('drag-end', () => this._drag.onEnd());
    }

    /**
     * One tab button: a toggle-mode St.Button whose text lives in a child
     * St.Label (St.Button has no clutter_text of its own). The label keeps
     * EllipsizeMode.NONE: an ellipsized label reports a small minimum width, so
     * the scroll cap would never engage and the tabs would be squeezed instead
     * of scrolling.
     *
     */
    _makeButton(tab, colors, activeCategory) {
        const button = new St.Button({
            style_class: 'todo-tab button',
            toggle_mode: true,
            // The rail reserves the scrollbar's height, so the strip can end up
            // taller than the tabs; keep them centred instead of stretched.
            y_align: Clutter.ActorAlign.CENTER,
        });
        const tabLabel = new St.Label({text: tab.label});
        button.set_child(tabLabel);
        tabLabel.clutter_text.set_ellipsize(Pango.EllipsizeMode.NONE);
        // Tabs carry the category colour too; the content header is filtered
        // away when a tab is inactive.
        if (tab.name && colors[tab.name]) {
            button.set_style(Storage.categoryColorCss(tab.name, colors));
        }
        button.set_checked(activeCategory === tab.name);
        return button;
    }
}