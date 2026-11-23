import Clutter from 'gi://Clutter';
import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import St from 'gi://St';

import * as Main from 'resource:///org/gnome/shell/ui/main.js';
import {sleep} from 'resource:///org/gnome/shell/ui/scripting.js';

const UUID = 'todo-md@ertugrulsefal.github.com';
const PATH = GLib.build_filenamev([GLib.get_home_dir(), 'todo.md']);
let testRun;

function assert(condition, message) {
    if (!condition)
        throw new Error(message);
}

async function until(condition, message) {
    const deadline = GLib.get_monotonic_time() + 5_000_000;
    do {
        if (condition())
            return;
        await sleep(30);
    } while (GLib.get_monotonic_time() < deadline);
    throw new Error(message);
}

function check(message) {
    console.log(`Todo MD test: ${message}`);
}

function read() {
    const [, bytes] = Gio.File.new_for_path(PATH).load_contents(null);
    return new TextDecoder().decode(bytes);
}

function write(text) {
    Gio.File.new_for_path(PATH).replace_contents(
        new TextEncoder().encode(text), null, false, Gio.FileCreateFlags.NONE, null);
}

function reminderIds(raw) {
    return raw.match(/ @notifyid\([0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}\)/g) ?? [];
}

function actors(root) {
    return [root, ...root.get_children().flatMap(actors)];
}

function row(ext, index) {
    return actors(ext._contentSection.actor).find(actor => actor._todoIndex === index);
}

function labels(item) {
    return actors(item).map(actor => actor.text).filter(Boolean).join('\n');
}

function button(item, name) {
    return actors(item).find(actor => typeof name === 'string'
        ? actor.accessible_name === name : name.test(actor.accessible_name ?? ''));
}

function entry(item, name) {
    return actors(item).find(actor => actor instanceof St.Entry && actor.accessible_name === name);
}

function sendKey(device, key, state) {
    device.notify_keyval(GLib.get_monotonic_time(), key, state);
}

async function press(device, key, modifier = null) {
    if (modifier !== null)
        sendKey(device, modifier, Clutter.KeyState.PRESSED);
    sendKey(device, key, Clutter.KeyState.PRESSED);
    sendKey(device, key, Clutter.KeyState.RELEASED);
    if (modifier !== null)
        sendKey(device, modifier, Clutter.KeyState.RELEASED);
    await sleep(90);
}

function smoke() {
    const process = Gio.Subprocess.new(
        ['bash', GLib.getenv('TODO_MD_SMOKE')], Gio.SubprocessFlags.STDOUT_PIPE);
    return new Promise((resolve, reject) => {
        process.communicate_utf8_async(null, null, (subprocess, result) => {
            try {
                const [, output] = subprocess.communicate_utf8_finish(result);
                assert(subprocess.get_successful() && output.includes('is ACTIVE'),
                    `Isolated smoke check did not report ACTIVE: ${output}`);
                console.log(output.trim());
                resolve();
            } catch (error) {
                reject(error);
            }
        });
    });
}

async function testTags() {
    const manager = Main.extensionManager;
    await until(() => manager.lookup(UUID)?.stateObj?._indicator,
        'Todo MD failed to load in the isolated session');
    const ext = manager.lookup(UUID).stateObj;
    await until(() => ext._file.read().raw.includes('Initial fixture'),
        'The packaged extension did not read the isolated file');
    await smoke();

    const future = '  -  [ ]  Future @start(2090-12-03) @due(2090-12-01 at 10:00) @unrelated(keep)\r\n';
    const dateOnly = '- [ ] Date only @due(2090-12-01)\r\n';
    const initial = '# Tasks\r\n## Test\r\n' + future + dateOnly +
        '- [ ] Warnings @start(bad) @due(2090-12-01) @due(x)\r\n';
    write(initial);
    ext._indicator.menu.open(false);
    await until(() => row(ext, 2) && labels(row(ext, 2)).includes('10:00'),
        'Timed due date did not appear after an external write');
    assert(!labels(row(ext, 3)).includes('00:00'), 'All-day due showed a time');
    assert(labels(row(ext, 2)).includes('2090-12-03'), 'The start date was hidden');
    assert(/after.+due/i.test(labels(row(ext, 2))), 'The reversed dates had no warning');
    assert(/invalid.+start/i.test(labels(row(ext, 4))) &&
        /multiple.+due/i.test(labels(row(ext, 4))), 'Invalid or duplicate dates had no warning');
    check('start, timed due, all-day due and date warnings after an external write');

    const seat = global.stage.context.get_backend().get_default_seat();
    const keyboard = seat.create_virtual_device(Clutter.InputDeviceType.KEYBOARD_DEVICE);
    row(ext, 2).grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    assert(read() === initial, 'Keyboard completion modified a future task');
    row(ext, 2).grab_key_focus();
    await press(keyboard, Clutter.KEY_Down, Clutter.KEY_Alt_L);
    await until(() => read().indexOf('Future') > read().indexOf('Date only'),
        'Alt+Down did not move the future task');
    assert(read() === initial.replace(future + dateOnly, dateOnly + future),
        'Keyboard move altered authored Markdown or a task tag');
    check('keyboard completion gate and future-task reorder');

    await testEditors(ext, keyboard);
    await testNotifications(ext, manager);
}

async function testEditors(ext, keyboard) {
    row(ext, 3).grab_key_focus();
    await press(keyboard, Clutter.KEY_Tab);
    const startButton = button(row(ext, 3), /^Edit start date:/);
    assert(startButton?.has_key_focus(), 'Tab did not focus the task start control');
    await press(keyboard, Clutter.KEY_Return);
    const content = ext._contentSection.actor;
    const start = button(content, 'Start date');
    assert(start && start.get_text() === '2090-12-03', 'Start editor did not prefill');
    start.set_text('2090-12-01');
    const beforeStartEdit = read();
    await press(keyboard, Clutter.KEY_Return);
    await until(() => read() === beforeStartEdit.replace('@start(2090-12-03)', '@start(2090-12-01)'),
        'Keyboard date save changed bytes outside the start tag');
    assert(!/after.+due/i.test(labels(row(ext, 3))), 'Old warning survived date repair');

    button(row(ext, 4), /^Edit due date:/).emit('clicked', 1);
    const due = button(content, 'Due date');
    due.set_text('2090-12-02 at 23:59');
    await press(keyboard, Clutter.KEY_Return);
    assert(read().includes('@due(2090-12-01) @due(x)'), 'Enter silently repaired duplicate tags');
    const beforeDueEdit = read();
    button(content, 'Replace all due tags').emit('clicked', 1);
    assert(read() === beforeDueEdit.replace('@due(2090-12-01) @due(x)', '@due(2090-12-02 at 23:59)'),
        'Explicit duplicate repair altered unrelated content');

    const fixture = '# Tasks\n## Test\n' +
        '- [ ] Reminders @due(2090-12-03 at 10:00) ' +
        '@notify(before=due,offset=3d,every=12h & before=due,offset=5h) @else(keep)\n' +
        '- [ ] Repeater @due(2000-01-31 at 10:00) ' +
        '@repeat(every=1mo,by=due,anchor=2000-01-31) @else(keep)\n' +
        '- [ ] Starred @starred(1)\n';
    write(fixture);
    await until(() => row(ext, 2) && labels(row(ext, 2)).includes('Reminders'),
        'The monitor did not rebuild the list after replacing the fixture');
    const reminderDraft = read();
    const [identity] = reminderIds(reminderDraft);
    assert(identity && reminderDraft.replace(identity, '') === fixture,
        'Assigning the reminder identity changed authored Markdown');
    button(row(ext, 2), /^Edit reminder/).emit('clicked', 1);
    const entries = actors(content).filter(actor => actor.accessible_name === 'Reminder rule');
    assert(entries.length === 2, 'The two notification rules did not get separate controls');
    assert(labels(content).includes('2090-11-30 at 10:00') &&
        labels(content).includes('2090-12-03 at 05:00'), 'Notification previews lack date or time');
    entries[1].set_text('before=due,offset=5h & before=due,offset=6h');
    entries[1].grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    assert(read() === reminderDraft && labels(content).includes('Use Add reminder rule'),
        'One rule field silently accepted two pasted rules');
    entries[1].set_text('before=due,offset=6h');
    entries[1].grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    assert(read() === reminderDraft.replace('offset=5h', 'offset=6h'),
        'Editing one notification rule altered other rules or tags');
    button(row(ext, 2), 'Edit task').emit('clicked', 1);
    const rawEntry = button(content, 'Task text');
    button(content, 'Reminders').emit('clicked', 1);
    rawEntry.grab_key_focus();
    rawEntry.set_text(rawEntry.get_text().replace('2090-12-03 at 10:00', '2090-12-04 at 11:00'));
    assert(labels(content).includes('2090-12-04 at 05:00'),
        'Reminder preview did not recalculate after a raw due date edit');
    button(content, 'Cancel reminders edit').emit('clicked', 1);
    await press(keyboard, Clutter.KEY_Escape);
    ext._indicator.menu.open(false);
    await until(() => row(ext, 3) && !ext._file.pending,
        'Menu did not reload the task list on reopen');
    check('keyboard date edit, explicit duplicate repair, independent reminder controls and previews');

    row(ext, 3).grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    const repeated = read().split('\n')[3];
    assert(/^- \[ \] Repeater @due\(20\d{2}-\d{2}-\d{2} at 10:00\)/.test(repeated) &&
        !repeated.includes('@due(2000-01-31') &&
        repeated.endsWith('@repeat(every=1mo,by=due,anchor=2000-01-31) @else(keep)'),
    'Recurring task did not reopen the same line with its anchored rule and due time');

    const marked = button(row(ext, 4), /unstar|remove star/i);
    assert(marked, 'The external starred tag did not appear in the row');
    marked.grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    assert(read().split('\n')[4] === '- [ ] Starred', 'The star control did not clear the tag');
    button(row(ext, 4), 'Add star').emit('clicked', 1);
    assert(read().split('\n')[4] === '- [ ] Starred @starred(1)', 'The star control did not add the tag');
    check('recurring completion and the file-backed star control');

    write('- [ ] Only task');
    await until(() => row(ext, 0) && labels(row(ext, 0)).includes('Only task'),
        'The singleton task fixture was not read');
    button(row(ext, 0), 'Edit task').emit('clicked', 1);
    button(content, 'Repeat').emit('clicked', 1);
    const repeatStart = entry(content, 'Start date');
    assert(repeatStart, 'The repeat editor did not ask for a start date');
    repeatStart.set_text('2090-12-01');
    const interval = entry(content, 'Repeat interval');
    interval.set_text('3d');
    interval.grab_key_focus();
    await press(keyboard, Clutter.KEY_Return);
    assert(read() === '- [ ] Only task @start(2090-12-01) @repeat(every=3d,by=start,anchor=2090-12-01)',
        'The repeat rule and companion start date were not saved together');
    button(row(ext, 0), 'Delete task').emit('clicked', 1);
    assert(read() === '\n', 'Deleting the last future task failed');
    check('repeat setup with a companion start date and deletion without a final newline');
}

async function testNotifications(ext, manager) {
    const fixture = '# Tasks\n## Test\n' +
        '- [ ] Missed @due(2000-01-04 at 16:00) ' +
        '@notify(on=2000-01-03 at 16:00 & before=due,offset=1d,every=12h)\n' +
        '- [x] Done @notify(on=2000-01-03 at 16:00)\n' +
        '- [ ] Future @start(2090-12-01) @notify(on=2000-01-03 at 16:00 & from=start,time=09:00,every=1d)\n';
    write(fixture);
    await until(() => ext._notifications?._source?.count > 0,
        'No real Shell notification was delivered');
    const scheduler = ext._notifications;
    const source = scheduler._source;
    assert(source.count === 1 && source.notifications[0].body === 'Missed',
        'Past rules did not coalesce or completed/future tasks notified');
    assert(scheduler._timer > 0, 'No timer for a future reminder');
    check('real Shell catch-up notification, coalescing, completed and future task suppression');

    const identified = read();
    const taskIds = reminderIds(identified);
    assert(taskIds.length === 3 && new Set(taskIds).size === 3 &&
        taskIds.reduce((raw, id) => raw.replace(id, ''), identified) === fixture,
    'Identities were missing, shared, or altered authored Markdown');
    const renamed = identified.replace('Missed @due(', 'Renamed @due(');
    write(renamed);
    await until(() => ext._file.read().raw === renamed && !ext._file.pending,
        'The monitor did not read the title-only edit');
    assert(source.count === 1 && source.notifications[0].body === 'Missed',
        'A title-only edit replayed a delivered reminder');
    check('title-only Markdown edit preserves the delivery identity');

    for (let index = 0; index < 2; index++) {
        const oldFile = ext._file;
        const oldScheduler = ext._notifications;
        ext._loadTodo();
        const pending = oldFile._readCancellable;
        assert(pending && oldFile.pending, 'No pending read was staged for shutdown');
        assert(manager.disableExtension(UUID), 'The isolated extension failed to disable');
        await until(() => !ext._indicator, 'The isolated extension failed to tear down');
        assert(pending.is_cancelled() && !oldFile.pending && !oldFile._monitor,
            'Disable left a read or file monitor active');
        assert(!oldScheduler._timer && !oldScheduler._source && !Main.messageTray.getSources().includes(source),
            'Disable retained a timer or Shell notification source');
        assert(manager.enableExtension(UUID), 'The isolated extension failed to re-enable');
        await until(() => ext._indicator && ext._file.read().raw === renamed,
            'The re-enabled extension failed to read its fixture');
        assert(!ext._notifications._source, 'Re-enable replayed an already delivered reminder');
    }
    await smoke();
    check('two disable/enable cycles, cancellation, source cleanup and persisted deduplication');

    const now = Date.now;
    const boundary = new Date('2091-03-04T09:00:00').getTime();
    const clockStart = GLib.get_monotonic_time();
    Date.now = () => boundary - 1200 + Math.floor((GLib.get_monotonic_time() - clockStart) / 1000);
    try {
        write('- [ ] Simultaneous @start(2091-03-04) @due(2091-03-04 at 10:00) ' +
            '@notify(from=start,time=09:00,every=1d & before=due,offset=1h)\n' +
            '- [ ] Missing due @notify(before=due,offset=1h & on=2091-03-04 at 09:00)\n');
        await until(() => ext._file.read().raw.includes('Simultaneous'),
            'The timed reminder fixture was not read');
        assert(!ext._notifications._source && ext._notifications._timer > 0,
            'The fixture notified before reaching the simulated minute');
        assert(/valid due date/i.test(labels(row(ext, 1))), 'Missing due did not warn in the menu');
        await until(() => ext._notifications._source?.count === 2,
            'The timer did not deliver one notification per task with a valid rule');
        const delivered = ext._notifications._source.notifications.map(notification => notification.body);
        assert(delivered.includes('Simultaneous') && delivered.includes('Missing due'),
            'Simultaneous rules duplicated a notification or a valid sibling did not run');
        check('timer delivery, simultaneous-rule deduplication and valid sibling of a missing-basis rule');
    } finally {
        Date.now = now;
    }
}

export function init() {
    // Run before the optional Shell performance helper, which requires a display.
    testRun = testTags().then(() => {
        console.log('TODO_MD_SHELL_TAGS_OK');
        global.context.terminate();
    }).catch(error => {
        logError(error, 'Todo MD isolated test failed');
        global.context.terminate();
    });
}

export async function run() {
    await testRun;
}
