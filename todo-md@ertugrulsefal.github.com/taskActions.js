import * as Storage from './storage.js';

function draftWriteError(result) {
    switch (result) {
    case 'saved':
        return null;
    case 'conflict':
        return 'The file changed. Reopen the menu and try again.';
    case 'pending':
        return 'The file is loading. Try again.';
    default:
        return 'Could not save the todo file.';
    }
}

function dueDraftError(raw, request) {
    if (request.date !== null && !Storage.isDueDate(request.date)) {
        return 'Enter a valid date in YYYY-MM-DD format.';
    }
    if (Storage.getTaskDue(raw).status === 'duplicate' && !request.resolveDuplicates) {
        return 'Multiple due tags. Reopen the date controls to repair them.';
    }
    return null;
}

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

    startDueEditing(index, snapshot) {
        const current = this._ext._file.read();
        if (!current.ok || current.raw !== snapshot.raw || current.epoch !== snapshot.epoch) {
            return;
        }
        this._ext._closeInteractions();
        this._ext._editingIndex = index;
        this._ext._editingDueOnly = true;
        this._ext._menu.refreshTodoMenu();
    }

    cancelEditing() {
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
    }

    finishEditing(text, task, snapshot, request) {
        if (task.index !== this._ext._editingIndex) {
            return 'The editor is no longer open.';
        }
        const raw = text === task.raw ? task.raw : text.trim();
        if (!raw.trim() && !request) {
            this.cancelEditing();
            return null;
        }
        if (!raw.trim()) {
            return 'Enter a task title.';
        }
        let updated = snapshot.raw;
        if (request) {
            const error = dueDraftError(raw, request);
            if (error) {
                return error;
            }
            const next = Storage.updateTaskDueText(raw, request.date, request);
            if (next === null) {
                return 'This change would leave an empty title or alter other tags.';
            }
            updated = raw === task.raw
                ? Storage.updateTaskDue(snapshot.raw, task.index, task.raw, request.date, request)
                : Storage.editTask(snapshot.raw, task.index, next);
        } else if (raw !== task.raw) {
            updated = Storage.editTask(snapshot.raw, task.index, raw);
        }
        const error = draftWriteError(this._ext._file.commitDraft(updated, snapshot));
        if (error) {
            return error;
        }
        this._ext._focusIndex = task.index;
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
        return null;
    }

    addTask(text, category, snapshot, request) {
        if (category !== this._ext._addingCategory) {
            return 'The editor is no longer open.';
        }
        let raw = text.trim();
        if (!raw && !request) {
            this.cancelEditing();
            return null;
        }
        if (!raw) {
            return 'Enter a task title.';
        }
        if (request) {
            const error = dueDraftError(raw, request);
            if (error) {
                return error;
            }
            raw = Storage.updateTaskDueText(raw, request.date, request);
            if (raw === null) {
                return 'This date would alter other tags in the task.';
            }
        }
        const updated = Storage.addTask(snapshot.raw, raw, category);
        const error = draftWriteError(this._ext._file.commitDraft(updated, snapshot));
        if (error) {
            return error;
        }
        this._ext._closeInteractions();
        this._ext._menu.refreshTodoMenu();
        return null;
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
