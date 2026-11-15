import Gio from 'gi://Gio';

import * as Storage from './storage.js';

// The todo file: cached last read, monitor, and the async load. Only the disk
// read is async; the write is atomic (replace_contents).
export class TodoFile {
    constructor(path) {
        this._path = path;
        this._raw = '';
        this._readOk = true;
        this._readPending = false;
        this._lastWritten = null;
        this._gen = 0;
        this._monitor = null;
        this._monitorSignal = 0;
    }

    // `ok: false` means the last read failed.
    read() {
        return {raw: this._raw, ok: this._readOk};
    }

    get pending() {
        return this._readPending;
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

    commit(updated) {
        if (!Storage.writeTodo(this._resolved(), updated)) {
            return false;
        }
        this._raw = updated;
        this._readOk = true;
        this._gen++;
        return true;
    }

    // Snapshot the shown content so the monitor can drop our own writes.
    noteShown() {
        this._lastWritten =
            this._readOk && !this._readPending ? this._raw : null;
    }

    clear() {
        this._raw = '';
        this._readOk = true;
        this._lastWritten = null;
        this._gen++;
    }

    // Async read; identical content (our own write) is dropped, and so is a
    // result that a write or a path change made stale while the read was in flight.
    load(onLoaded) {
        const gen = this._gen;
        this._readPending = true;
        Storage.readTodoAsync(this._resolved(), result => {
            this._readPending = false;
            if (gen !== this._gen) {
                return;
            }
            if (result.ok && result.raw === this._lastWritten) {
                return;
            }
            this._raw = result.raw;
            this._readOk = result.ok;
            onLoaded();
        });
    }
}
