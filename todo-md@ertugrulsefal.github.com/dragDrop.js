import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import * as PopupMenu from 'resource:///org/gnome/shell/ui/popupMenu.js';
import * as DND from 'resource:///org/gnome/shell/ui/dnd.js';

import * as Storage from './storage.js';

// Drag and drop for tasks and category tabs, plus the keyboard task move.
export class DragDrop {
    constructor(ext) {
        this._ext = ext;
    }

    // The insertion line lives on Main.uiGroup, so it never joins the menu's
    // layout. The monitor registers only while a drag is in flight.
    setupDragAndDrop() {
        this._ext._dragMonitor = {
            dragMotion: event => this.onDragMotion(event),
            dragDrop: () => DND.DragDropResult.CONTINUE,
        };
        // Two lines: the row's takes its width from the row, the tab's its height.
        this._ext._dropLine = new St.Widget({style_class: 'todo-drop-line todo-drop-line-h'});
        this._ext._dropLine.visible = false;
        Main.uiGroup.add_child(this._ext._dropLine);
        this._ext._tabDropLine = new St.Widget({style_class: 'todo-drop-line todo-drop-line-v'});
        this._ext._tabDropLine.visible = false;
        Main.uiGroup.add_child(this._ext._tabDropLine);
        this._ext._dragHint = new St.Label({style_class: 'todo-drag-hint'});
        this._ext._dragHint.visible = false;
        Main.uiGroup.add_child(this._ext._dragHint);
    }

    // The menu is raised over its uiGroup siblings, so lift the drag actors above
    // it; done here, not in dragMotion, to keep the drag clone on top.
    raiseDragActors() {
        for (const actor of [this._ext._dropLine, this._ext._tabDropLine, this._ext._dragHint]) {
            if (actor) {
                Main.uiGroup.set_child_above_sibling(actor, null);
            }
        }
    }

    onDragBegin(index, categoryName) {
        this._ext._dragging = {kind: 'task', index, category: categoryName};
        DND.addDragMonitor(this._ext._dragMonitor);
        this.raiseDragActors();
    }

    // The file's heading order IS the tab order, so a drop rewrites the document.
    // blocked/anchor come from the same predicates storage refuses on, decided once.
    onCategoryDragBegin(name, index) {
        const content = this._ext._file.read().raw;
        this._ext._dragging = {
            kind: 'category',
            name,
            index,
            blocked: Storage.categoryMoveBlocker(content, name),
            anchor: Storage.firstCategoryMoveBlocker(content),
            toIndex: -1,
        };
        // Reset interactions now; the drag-end refresh re-renders them.
        this._ext._closeInteractions();
        DND.addDragMonitor(this._ext._dragMonitor);
        this.raiseDragActors();
        this.startAutoScroll();
    }

    // The drag is over, dropped or not — not inside acceptDrop, which still holds
    // the drag actor.
    onDragEnd() {
        this._ext._dragging = null;
        DND.removeDragMonitor(this._ext._dragMonitor);
        this.stopAutoScroll();
        this.hideDropLine();
        this.hideTabDrop();
        this.hideDragHint();
        this._ext._menu.refreshTodoMenu();
    }

    // Called by the Shell through acceptDrop; true finishes the drag. A task only
    // moves inside its own category, so another category's row returns false.
    onDrop(toIndex, toCategory) {
        if (this._ext._dragging?.kind === 'category') {
            return this.onCategoryDrop();
        }
        if (!this._ext._dragging
            || this._ext._dragging.category !== toCategory
            || this._ext._dragging.index === toIndex) {
            return false;
        }
        const parsed = this._ext._file.read();
        const updated = Storage.moveTaskTo(parsed.raw, this._ext._dragging.index, toIndex);
        if (updated === parsed.raw) {
            return false;
        }
        // The move shifts line indexes: an open editor would re-anchor to another task.
        this._ext._closeInteractions();
        this._ext._file.commit(updated);
        return true;
    }

    // Called by the Shell through the strip's acceptDrop; the target slot was
    // validated in dragMotion, so this only re-reads the file and writes.
    onCategoryDrop() {
        const drag = this._ext._dragging;
        if (!drag || drag.kind !== 'category'
            || drag.blocked !== null || drag.toIndex < 0) {
            return false;
        }
        const parsed = this._ext._file.read();
        const updated = Storage.moveCategoryTo(parsed.raw, drag.name, drag.toIndex);
        if (!parsed.ok || updated === parsed.raw) {
            return false;
        }
        this._ext._file.commit(updated);
        return true;
    }

    // Shows the insertion line above or below the row under the pointer; NO_DROP
    // gives the no-drop cursor.
    onDragMotion(event) {
        if (this._ext._dragging?.kind === 'category') {
            return this.onCategoryDragMotion(event);
        }
        if (!this._ext._dragging) {
            return DND.DragMotionResult.CONTINUE;
        }
        const row = this.findTaskRow(event.targetActor);
        if (!row
            || row._todoCategory !== this._ext._dragging.category
            || row._todoIndex === this._ext._dragging.index) {
            this.hideDropLine();
            return DND.DragMotionResult.NO_DROP;
        }
        const [x, y] = row.get_transformed_position();
        const height = row.get_height();
        const below = event.y >= y + height / 2;
        this._ext._dropLine.set_width(row.get_width());
        this._ext._dropLine.set_position(x, below ? y + height : y);
        this._ext._dropLine.visible = true;
        return DND.DragMotionResult.MOVE_DROP;
    }

    // The strip runs horizontally, so the line stands upright in the landing gap.
    // A refused spot answers NO_DROP and says why in the hint.
    onCategoryDragMotion(event) {
        const drag = this._ext._dragging;
        drag.toIndex = -1;
        this._ext._dragX = event.x;
        const slot = this.categorySlotAt(event.x, event.y);
        if (slot === null) {
            this.hideTabDrop();
            this.hideDragHint();
            return DND.DragMotionResult.NO_DROP;
        }
        if (drag.blocked !== null) {
            this.hideTabDrop();
            this.showDragHint(`"${drag.name}" can't be moved: `
                + this.blockerReason(drag.blocked));
            return DND.DragMotionResult.NO_DROP;
        }
        // Position 0 is a fixed anchor while the first category can't move.
        if (slot === 0 && drag.anchor !== null) {
            this.hideTabDrop();
            this.showDragHint(`Can't drop before "${this.firstCategoryName()}": `
                + this.blockerReason(drag.anchor));
            return DND.DragMotionResult.NO_DROP;
        }
        const toIndex = slot > drag.index ? slot - 1 : slot;
        if (toIndex === drag.index) {
            this.hideTabDrop();
            this.hideDragHint();
            return DND.DragMotionResult.NO_DROP;
        }
        drag.toIndex = toIndex;
        this.hideDragHint();
        this.positionTabDropLine(slot);
        return DND.DragMotionResult.MOVE_DROP;
    }

    // The drop slot at a stage point — how many tabs the pointer has passed; null
    // off the strip, which keeps the '+' button and the rest of the menu out.
    categorySlotAt(x, y) {
        const tabs = this.categoryTabs();
        if (tabs.length === 0) {
            return null;
        }
        const scroller = this._ext._tabBar.scroller;
        const [sx, sy] = scroller.get_transformed_position();
        if (x < sx || x > sx + scroller.get_width()
            || y < sy || y > sy + scroller.get_height()) {
            return null;
        }
        let slot = 0;
        for (const tab of tabs) {
            const [tx] = tab.get_transformed_position();
            if (x > tx + tab.get_width() / 2) {
                slot += 1;
            }
        }
        return slot;
    }

    // Tab buttons in strip order; 'All' carries no category name, so it is filtered out.
    categoryTabs() {
        return this._ext._tabBar
            ? this._ext._tabBar.tabsBox.get_children()
                .filter(actor => actor._todoCategoryName !== undefined)
            : [];
    }

    // The first category's name, for the refusal text.
    firstCategoryName() {
        const tabs = this.categoryTabs();
        return tabs.length > 0 ? tabs[0]._todoCategoryName : '';
    }

    positionTabDropLine(slot) {
        if (!this._ext._tabDropLine) {
            return;
        }
        const tabs = this.categoryTabs();
        const target = slot < tabs.length ? tabs[slot] : tabs[tabs.length - 1];
        const [tx, ty] = target.get_transformed_position();
        this._ext._tabDropLine.set_position(
            slot < tabs.length ? tx : tx + target.get_width(), ty);
        this._ext._tabDropLine.set_height(target.get_height());
        this._ext._tabDropLine.visible = true;
    }

    hideTabDrop() {
        if (this._ext._tabDropLine) {
            this._ext._tabDropLine.visible = false;
        }
    }

    // Say why a category drop is refused, right under the strip.
    showDragHint(text) {
        if (!this._ext._dragHint) {
            return;
        }
        this._ext._dragHint.set_text(text);
        const [bx, by] = this._ext._tabBar.bar.get_transformed_position();
        this._ext._dragHint.set_position(bx, by + this._ext._tabBar.bar.get_height() + 4);
        this._ext._dragHint.visible = true;
    }

    hideDragHint() {
        if (this._ext._dragHint) {
            this._ext._dragHint.visible = false;
        }
    }

    // The shared half of both refusal texts.
    blockerReason(reason) {
        return reason === 'implicit'
            ? 'it has no heading of its own.'
            : 'it holds content above the first heading.';
    }

    // The Shell's drag does not move a ScrollView's adjustment, so a strip wider
    // than the menu is scrolled from here while the pointer rests near an edge.
    startAutoScroll() {
        this._ext._dragX = null;
        this._ext._autoscrollId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this.autoScrollStep();
            return GLib.SOURCE_CONTINUE;
        });
    }

    stopAutoScroll() {
        if (this._ext._autoscrollId) {
            GLib.Source.remove(this._ext._autoscrollId);
            this._ext._autoscrollId = 0;
        }
        this._ext._dragX = null;
    }

    autoScrollStep() {
        if (this._ext._dragging?.kind !== 'category' || this._ext._dragX === null) {
            return;
        }
        const scroller = this._ext._tabBar.scroller;
        const adjustment = scroller.hadjustment;
        if (!adjustment) {
            return;
        }
        const [sx] = scroller.get_transformed_position();
        const width = scroller.get_width();
        const EDGE = 24;
        const STEP = 8;
        let delta = 0;
        if (this._ext._dragX < sx + EDGE) {
            delta = -STEP;
        } else if (this._ext._dragX > sx + width - EDGE) {
            delta = STEP;
        }
        if (delta !== 0) {
            adjustment.value = Math.max(adjustment.lower,
                Math.min(adjustment.upper - adjustment.page_size,
                    adjustment.value + delta));
        }
    }

    findTaskRow(actor) {
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

    hideDropLine() {
        if (this._ext._dropLine) {
            this._ext._dropLine.visible = false;
        }
    }

    // Alt+↑ / Alt+↓: the adjacent task is the target, so one press is one step.
    // The moved row keeps the key focus (handed back as _focusIndex).
    moveTask(index, categoryName, direction) {
        const parsed = this._ext._file.read();
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
        // Close interactions only once the move happens: without a refresh the menu
        // would show a row that is already gone.
        this._ext._closeInteractions();
        this._ext._file.commit(updated);
        // moveTaskTo lands the task at `other` in the new document; remember its
        // line index for the focus hand-back.
        const moved = Storage.renderSections(Storage.parseDocument(updated))
            .find(candidate => candidate.name === categoryName);
        this._ext._focusIndex = moved ? moved.tasks[other].index : -1;
        this._ext._menu.refreshTodoMenu();
    }
}
