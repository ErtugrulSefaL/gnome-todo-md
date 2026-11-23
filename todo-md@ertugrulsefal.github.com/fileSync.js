import Gio from 'gi://Gio';

import * as Storage from './storage.js';

// The todo file: cached last read, monitor, and the async load. Only the disk
// read is async; the write is atomic (replace_contents).
export class TodoFile {
    constructor(path, onCommitted = null) {
        this._path = path;
        this._onCommitted = onCommitted;
        this._raw = '';
        this._readOk = true;
        this._readCancellable = null;
        this._missing = false;
        this._etag = null;
        this._epoch = 0;
        this._lastWritten = null;
        this._monitor = null;
        this._monitorSignal = 0;
    }

    // `ok: false` means the last read failed.
    read() {
        return {raw: this._raw, ok: this._readOk, epoch: this._epoch};
    }

    get pending() {
        return this._readCancellable !== null;
    }

    _resolved() {
        return Storage.resolveTodoPath(this._path());
    }

    watch(onChanged) {
        this._monitor = Gio.File.new_for_path(this._resolved())
            .monitor(Gio.FileMonitorFlags.NONE, null);
        this._monitorSignal = this._monitor.connect('changed', onChanged);
    }

    unwatch() {
        if (this._monitor) {
            this._monitor.disconnect(this._monitorSignal);
            this._monitor.cancel();
            this._monitor = null;
        }
    }

    destroy() {
        this.unwatch();
        this._cancelRead();
        this._onCommitted = null;
    }

    commit(updated) {
        return this._replace(updated, null) === 'saved';
    }

    commitDraft(updated, snapshot) {
        if (snapshot.epoch !== this._epoch || snapshot.raw !== this._raw ||
            snapshot.ok !== this._readOk) {
            return 'conflict';
        }
        if (this.pending) {
            return 'pending';
        }
        if (!this._etag && !this._missing) {
            return 'failed';
        }
        if (updated === this._raw) {
            return 'saved';
        }
        // Local Gio replacement creates a missing file and checks the ETag if it exists.
        const etag = this._missing ? 'todo-md-missing-file' : this._etag;
        return this._replace(updated, etag);
    }

    _replace(updated, etag) {
        const path = this._resolved();
        const result = Storage.replaceTodo(path, updated, etag);
        if (!result.ok) {
            return result.conflict ? 'conflict' : 'failed';
        }
        this._raw = updated;
        this._readOk = true;
        this._cancelRead();
        this._missing = false;
        this._etag = result.etag;
        this._onCommitted?.(this.read(), path);
        return 'saved';
    }

    // Snapshot the shown content so the monitor can drop our own writes.
    noteShown() {
        this._lastWritten =
            this._readOk && !this.pending ? this._raw : null;
    }

    clear() {
        this._raw = '';
        this._readOk = true;
        this._cancelRead();
        this._missing = false;
        this._etag = null;
        this._epoch++;
        this._lastWritten = null;
    }

    _cancelRead() {
        const cancellable = this._readCancellable;
        this._readCancellable = null;
        cancellable?.cancel();
    }

    load(onLoaded) {
        this._cancelRead();
        const cancellable = new Gio.Cancellable();
        this._readCancellable = cancellable;
        const path = this._resolved();
        Storage.readTodoAsync(path, result => {
            // Cancellation can still deliver a callback after another load starts.
            if (cancellable !== this._readCancellable) {
                return;
            }
            this._readCancellable = null;
            this._missing = result.missing ?? false;
            this._etag = result.etag ?? null;
            if (result.ok && result.raw === this._lastWritten) {
                return;
            }
            this._raw = result.raw;
            this._readOk = result.ok;
            onLoaded(this.read(), path);
        }, cancellable);
    }
}
