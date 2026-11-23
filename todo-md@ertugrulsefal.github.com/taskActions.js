import * as Storage from './storage.js';
import {validateNotifyDraft} from './reminders.js';
import {toggleScheduledTask, validateRepeatDraft} from './repeat.js';

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

function applyTagDraft(raw, request) {
    const changes = Array.isArray(request) ? request : [request];
    for (const {key, value, resolveDuplicates} of changes) {
        if (value !== null && (key === 'start' || key === 'due') &&
            !Storage.parseTaskDate(value, {allowTime: key === 'due'})) {
            return {error: key === 'due'
                ? 'Enter YYYY-MM-DD or YYYY-MM-DD at HH:MM.'
                : 'Enter a valid start date in YYYY-MM-DD format.'};
        }
        const validate = {notify: validateNotifyDraft, repeat: validateRepeatDraft}[key];
        if (value !== null && validate) {
            const error = validate(raw, value);
            if (error) {
                return {error};
            }
        }
        if (!resolveDuplicates && Storage.getTaskTagValues(raw, key).length > 1) {
            return {error: `Multiple ${key} tags. Reopen the tag controls to repair them.`};
        }
        raw = Storage.updateTaskTagText(raw, key, value, {resolveDuplicates});
        if (raw === null) {
            return {error: 'This change would leave an empty title or alter other tags.'};
        }
    }
    return {raw};
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

    startTagEditing(index, snapshot, key) {
        const current = this._ext._file.read();
        if (!current.ok || current.raw !== snapshot.raw || current.epoch !== snapshot.epoch) {
            return;
        }
        this._ext._closeInteractions();
        this._ext._editingIndex = index;
        this._ext._editingTag = key;
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
        let raw = text;
        if (!raw.trim() && !request) {
            this.cancelEditing();
            return null;
        }
        if (!raw.trim()) {
            return 'Enter a task title.';
        }
        if (request) {
            const {raw: next, error} = applyTagDraft(raw, request);
            if (error) {
                return error;
            }
            raw = next;
        }
        const updated = Storage.replaceTaskText(snapshot.raw, task.index, task.raw, raw);
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
            const {raw: next, error} = applyTagDraft(raw, request);
            if (error) {
                return error;
            }
            raw = next;
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

    toggleTask(index, snapshot) {
        this._ext._closeInteractions();
        const updated = toggleScheduledTask(snapshot.raw, index);
        if (updated !== snapshot.raw) {
            this._ext._file.commitDraft(updated, snapshot);
        }
        this._ext._menu.refreshTodoMenu();
    }

    toggleTaskStar(task, snapshot) {
        const updated = Storage.toggleTaskStar(snapshot.raw, task.index, task.raw);
        if (updated !== snapshot.raw && this._ext._file.commitDraft(updated, snapshot) === 'saved') {
            this._ext._focusIndex = task.index;
        }
        this._ext._menu.refreshTodoMenu();
    }

    deleteTask(index, snapshot) {
        this._ext._closeInteractions();
        const updated = Storage.deleteTask(snapshot.raw, index);
        if (updated !== snapshot.raw) {
            this._ext._file.commitDraft(updated || '\n', snapshot);
        }
        this._ext._menu.refreshTodoMenu();
    }
}
