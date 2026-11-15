import * as Storage from './storage.js';

// The inline task interactions (edit / add / toggle / delete). At most one is
// open at a time; the extension owns that state.
export class TaskActions {
    constructor(ext) {
        this._ext = ext;
    }

    startEditing(index) {
        this._ext._closeInteractions();
        this._ext._editingIndex = index;
        this._ext._menu.refreshTodoMenu();
    }

    cancelEditing() {
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
    }

    finishEditing(text) {
        const trimmed = text ? text.trim() : '';
        if (!trimmed) {
            this.cancelEditing();
            return;
        }
        const parsed = this._ext._file.read();
        const updated =
            Storage.editTask(parsed.raw, this._ext._editingIndex, trimmed);
        if (!this._ext._file.commit(updated)) {
            return;
        }
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
    }

    addTask(text, category) {
        const trimmed = text ? text.trim() : '';
        if (!trimmed) {
            this.cancelEditing();
            return;
        }
        const parsed = this._ext._file.read();
        const updated = Storage.addTask(parsed.raw, trimmed, category);
        if (!this._ext._file.commit(updated)) {
            return;
        }
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
    }

    toggleAdd(categoryName) {
        if (this._ext._addingCategory === categoryName) {
            this.cancelEditing();
            return;
        }
        this._ext._closeInteractions();
        this._ext._addingCategory = categoryName;
        this._ext._menu.refreshTodoMenu();
    }

    toggleTask(index) {
        this._ext._closeInteractions();
        const parsed = this._ext._file.read();
        const updated = Storage.toggleTask(parsed.raw, index);
        this._ext._file.commit(updated);
        this._ext._menu.refreshTodoMenu();
    }

    deleteTask(index) {
        this._ext._closeInteractions();
        const parsed = this._ext._file.read();
        const updated = Storage.deleteTask(parsed.raw, index);
        this._ext._file.commit(updated);
        this._ext._menu.refreshTodoMenu();
    }
}
