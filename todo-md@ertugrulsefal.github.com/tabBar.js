import St from 'gi://St';
import Clutter from 'gi://Clutter';
import Pango from 'gi://Pango';

import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';

export class TabBar {
    constructor({onNewCategory}) {
        this.bar = new St.BoxLayout({style_class: 'todo-tab-bar'});
        this.bar.set_x_expand(true);
        this.bar.set_reactive(true); // receive scroll events

        this.tabsBox = new St.BoxLayout({style_class: 'todo-tab-strip'});
        this.scroller = new St.ScrollView({
            hscrollbar_policy: St.PolicyType.AUTOMATIC,
            vscrollbar_policy: St.PolicyType.AUTOMATIC,
            enable_mouse_scrolling: false,
        });
        this.scroller.add_child(this.tabsBox);
        this.scroller.set_x_expand(true);
        this.bar.connect('scroll-event', (_actor, event) => {
            const adj = this.scroller.hadjustment;
            if (!adj) {
                return Clutter.EVENT_PROPAGATE;
            }
            const direction = event.get_scroll_direction();
            if (direction === Clutter.ScrollDirection.SMOOTH) {
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
        this.newCategoryButton.connect('clicked', () => {
            onNewCategory();
        });

        this.bar.add_child(this.scroller);
        this.bar.add_child(this.newCategoryButton);

        // The whole strip is one drop target for a category drag: the slot is computed from the pointer in dragMotion,
        // so acceptDrop only confirms it. The Shell walks up from the picked actor looking for `_delegate.acceptDrop`.
        this._drag = null;
        this.bar._delegate = {
            acceptDrop: () => this._drag !== null && this._drag.onDrop() === true,
        };
    }

    // Put the strip on the menu as its FIRST row. Refill-only: the scroller and its adjustments survive, so the horizontal scroll position does too.
    attach(menuBox) {
        menuBox.add_child(this.bar);
    }

    // Take the strip off the menu without destroying it; re-attached by `attach`.
    detach(menuBox) {
        menuBox.remove_child(this.bar);
    }

    // Build the buttons for the current sections. `drag`, when given, carries `onBegin(name, index)` / `onEnd()` / `onDrop()`; only then does a category tab become draggable.
    refill(sections, colors, activeCategory, onSelect, onActions, drag) {
        this._drag = drag ?? null;
        this.tabsBox.remove_all_children();
        if (sections.length === 0) {
            // No categories at all: the menu shows its empty state and the strip
            // keeps only its '+'.
            return;
        }
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
        // Invariant: every category tab carries this identity.
        button._todoCategoryName = sections[0].name;
        button._todoCategoryIndex = 0;
        this._connectActions(button, sections[0].name, onActions);
        this.tabsBox.add_child(button);
    }

    // Ring the '+' while the file has no categories: it is then the strip's only control
    setEmptyState(on) {
        if (on) {
            this.newCategoryButton.add_style_class_name('todo-tab-add-hint');
        } else {
            this.newCategoryButton.remove_style_class_name('todo-tab-add-hint');
        }
    }

    // Right-click on a category tab opens the same action panel the header's ⋮ button opens.
    _connectActions(button, categoryName, onActions) {
        if (categoryName === null) {
            return;
        }
        button.connect('button-press-event', (_actor, event) => {
            if (event.get_button() !== 3) {
                return Clutter.EVENT_PROPAGATE;
            }
            onActions(categoryName);
            return Clutter.EVENT_STOP;
        });
    }

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