import Gio from 'gi://Gio';
import GLib from 'gi://GLib';
import Gdk from 'gi://Gdk';
import Adw from 'gi://Adw';
import Gtk from 'gi://Gtk';

import {ExtensionPreferences}
    from 'resource:///org/gnome/Shell/Extensions/js/extensions/prefs.js';

import * as Storage from './storage.js';

// GNOME HIG palette (verified visually round swatches in the palette popover).
const PALETTE = [
    '#3584e4', // blue
    '#33d17a', // green
    '#e01b24', // red
    '#f6d32d', // yellow
    '#c061cb', // purple
    '#ff7800', // orange
    '#986a44', // brown
    '#9a9996', // gray
];

/**
 * Preferences for the Todo MD extension (GNOME Shell 46, GTK4 + Adwaita).
 *
 * Pattern verified against gjs.guide `development/preferences.md` (GNOME 45+):
 * `ExtensionPreferences.fillPreferencesWindow(window)` + `this.getSettings()`
 * (reads metadata.json settings-schema, loads schemas/ from the extension dir).
 */
export default class TodoMDPreferences extends ExtensionPreferences {
    fillPreferencesWindow(window) {
        const settings = this.getSettings();

        this._buildFilePage(window, settings);
        this._buildColorsPage(window, settings);
    }

    _buildFilePage(window, settings) {
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

    _buildColorsPage(window, settings) {
        const page = new Adw.PreferencesPage({
            title: 'Colors',
            icon_name: 'color-select-symbolic',
        });
        window.add(page);

        const group = new Adw.PreferencesGroup({
            title: 'Category colors',
            description: 'Pick a color for each category header; changes '
                + 'apply to the panel menu immediately. Categories come from '
                + 'your todo file.',
        });
        page.add(group);

        // Categories come from the configured todo file.
        const path = Storage.resolveTodoPath(
            settings.get_string('todo-file-path'));
        const doc = Storage.parseDocument(Storage.readTodo(path).raw);
        const categories = doc.categories.map(category => category.name);
        if (categories.length === 0) {
            categories.push(Storage.FALLBACK_CATEGORY);
        }

        // Swatch styling for the quick-palette buttons (load_from_string is
        // GTK 4.12+; GNOME 46 ships 4.14).
        const provider = new Gtk.CssProvider();
        provider.load_from_string(
            PALETTE.map((hex, i) => `.todo-swatch-${i} { background: ${hex}; }`)
                .join(' ')
            + ' .todo-swatch { min-width: 20px; min-height: 20px; '
            + 'border-radius: 10px; padding: 0; }');
        // GJS exposes this as a CLASS-STATIC method: Gtk.StyleContext.
        // add_provider_for_display — the bare C name
        // Gtk.style_context_add_provider_for_display is undefined at runtime.
        Gtk.StyleContext.add_provider_for_display(
            Gdk.Display.get_default(), provider,
            Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION);

        for (const name of categories) {
            const row = new Adw.ActionRow({title: name});
            group.add(row);
            this._addRowControls(settings, row, name);
        }
    }

    _addRowControls(settings, row, name) {
        // Free color picker (Gtk.ColorDialogButton, GTK 4.10+, officially
        // "suitable ... for selecting a color in a preference dialog").
        const dialogButton = new Gtk.ColorDialogButton({
            dialog: new Gtk.ColorDialog(),
        });
        const initial = this._readColors(settings)[name];
        if (initial) {
            const rgba = new Gdk.RGBA();
            rgba.parse(initial);
            dialogButton.set_rgba(rgba);
        }
        let syncingRgba = false;
        dialogButton.connect('notify::rgba', () => {
            // Programmatic set_rgba below also fires this handler; guard so
            // the palette write does not round-trip through the dialog's
            // handler and clobber itself.
            if (syncingRgba) {
                return;
            }
            const picked = dialogButton.get_rgba();
            this._writeColors(settings, {
                ...this._readColors(settings),
                [name]: Storage.rgbToHex(
                    Math.round(picked.red * 255),
                    Math.round(picked.green * 255),
                    Math.round(picked.blue * 255)),
            });
        });
        row.add_suffix(dialogButton);

        // Quick palette behind a menu button (Q2: dialog + palette together).
        // Both pickers drive the same settings key, so a palette click ALSO
        // updates the dialog button's rgba (keeps the two widgets in sync).
        const swatches = new Gtk.Box({
            orientation: Gtk.Orientation.HORIZONTAL,
            spacing: 4,
            valign: Gtk.Align.CENTER,
        });
        let popover = null;
        PALETTE.forEach((hex, i) => {
            const swatch = new Gtk.Button({
                css_classes: [`todo-swatch-${i}`, 'todo-swatch'],
                tooltip_text: hex,
            });
            swatch.connect('clicked', () => {
                const rgba = new Gdk.RGBA();
                rgba.parse(hex);
                syncingRgba = true;
                dialogButton.set_rgba(rgba);
                syncingRgba = false;
                this._writeColors(settings, {
                    ...this._readColors(settings),
                    [name]: hex,
                });
                popover.popdown();
            });
            swatches.append(swatch);
        });
        const clearButton = new Gtk.Button({label: 'None'});
        clearButton.connect('clicked', () => {
            const colors = this._readColors(settings);
            delete colors[name];
            syncingRgba = true;
            // No transparent-rgba setter needed: the dialog button keeps its
            // last color, which is harmless (None means "no map entry").
            syncingRgba = false;
            this._writeColors(settings, colors);
            popover.popdown();
        });
        swatches.append(clearButton);
        popover = new Gtk.Popover({child: swatches});
        row.add_suffix(new Gtk.MenuButton({
            popover,
            icon_name: 'color-select-symbolic',
        }));
    }

    _readColors(settings) {
        return settings.get_value('category-colors').recursiveUnpack();
    }

    _writeColors(settings, colors) {
        settings.set_value('category-colors',
            GLib.Variant.new('a{ss}', colors));
    }
}