import Gio from 'gi://Gio';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

/**
 * Preferences for the Todo MD extension (GNOME Shell 46, GTK4 + Adwaita).
 *
 * Pattern verified against gjs.guide `development/preferences.md` (GNOME 45+):
 * `ExtensionPreferences.fillPreferencesWindow(window)` + `this.getSettings()`
 * (reads metadata.json settings-schema, loads schemas/ from the extension dir).
 * Adw.EntryRow is used through the Gtk.Editable API: its content is the
 * `text` property (String r/w), which GSettings.bind() targets directly.
 */
export default class TodoMDPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        const page = new Adw.PreferencesPage({
            title: 'General',
            icon_name: 'dialog-information-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Todo file',
            description: 'Where the extension reads and writes your markdown '
                + 'todo file. An empty value uses the default ~/todo.md.',
        });
        page.add(group);

        // EntryRow shows `title` as its placeholder; the content lives in
        // the Gtk.Editable `text` property (libadwaita docs: EntryRow has
        // "only minimal API and should be used with the Gtk.Editable API").
        const row = new Adw.EntryRow({
            title: 'Todo file path',
        });
        settings.bind('todo-file-path', row, 'text',
            Gio.SettingsBindFlags.DEFAULT);
        group.add(row);

        // Suffix button: reset the key to its schema default ('' = default
        // ~/todo.md); the bind syncs the new value back into the row.
        const resetButton = new Gtk.Button({
            icon_name: 'view-refresh-symbolic',
            valign: Gtk.Align.CENTER,
            tooltip_text: 'Reset to default (~/todo.md)',
        });
        resetButton.connect('clicked', () => {
            settings.reset('todo-file-path');
        });
        row.add_suffix(resetButton);
    }
}