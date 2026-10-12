#!/usr/bin/env bash
#
# shell-api.sh — ground-truth API lookups for the RUNNING GNOME Shell.
#
# WHY THIS EXISTS (project rule: VERIFY-BEFORE-WRITE)
# An extension must never guess a Shell / St / Clutter / GTK API. Two sources
# beat the published documentation:
#
#   1) The Shell's own JS (popupMenu.js, panelMenu.js, main.js, ...). It is NOT
#      installed as loose files — it lives in a GResource embedded inside
#      /usr/lib/gnome-shell/libshell-<N>.so. `gresource` reads it directly.
#   2) The GObject-introspection typelibs: St-<N>, Shell-<N> (in
#      /usr/lib/gnome-shell/) and Clutter-<N> (in .../mutter-<N>/).
#
# Both are taken straight from the INSTALLED Shell, so they always match the
# version under test and never rot. (gjs-docs.gnome.org lags behind: as of
# 2026-10 it publishes up to st17~17 = GNOME 49; GNOME 50 = st18 does not
# exist there yet — see ~/.local/share/gjs-docs-offline/.)
#
# Version-agnostic on purpose: <N> is detected from the installed St typelib,
# so this script keeps working on GNOME 51+ without edits.
#
# USAGE
#   tools/shell-api.sh info                  # detected version + paths
#   tools/shell-api.sh list [<regex>]        # list the Shell's JS resources
#   tools/shell-api.sh extract <res-path>    # print one Shell JS file
#   tools/shell-api.sh probe                 # check every API this extension uses
#
# EXAMPLES
#   tools/shell-api.sh extract /org/gnome/shell/ui/popupMenu.js | less
#   tools/shell-api.sh list 'ui/(popupMenu|panelMenu)'
#   tools/shell-api.sh probe                 # exit 1 if anything is MISSING
#
set -euo pipefail

SHELL_DIR=/usr/lib/gnome-shell
MUTTER_BASE=/usr/lib/x86_64-linux-gnu

# --- detect the installed GI version ----------------------------------------
# St-<N>.typelib ships with gnome-shell; <N> is the introspection version
# (GNOME 46 -> 14, 50 -> 18). Clutter lives under mutter-<N>/.
detect() {
    local n
    n=$(ls "$SHELL_DIR"/St-*.typelib 2>/dev/null \
        | sed 's#.*/St-##; s#\.typelib$##' | sort -V | tail -1)
    if [ -z "$n" ]; then
        echo "ERROR: no St-*.typelib found in $SHELL_DIR" >&2
        exit 1
    fi
    GI_VER="$n"
    LIBSHELL="$SHELL_DIR/libshell-$n.so"
    MUTTER_DIR="$MUTTER_BASE/mutter-$n"
    if [ ! -f "$LIBSHELL" ]; then
        echo "ERROR: $LIBSHELL not found" >&2
        exit 1
    fi
}

# gjs needs both the shared objects and the typelibs on its search path.
gjs_env() {
    LD_LIBRARY_PATH="$SHELL_DIR:$MUTTER_DIR${LD_LIBRARY_PATH:+:$LD_LIBRARY_PATH}" \
    GI_TYPELIB_PATH="$SHELL_DIR:$MUTTER_DIR${GI_TYPELIB_PATH:+:$GI_TYPELIB_PATH}" \
        "$@"
}

cmd_info() {
    detect
    printf 'shell        : %s\n' "$(gnome-shell --version 2>/dev/null || echo '<unknown>')"
    printf 'GI version   : %s\n' "$GI_VER"
    printf 'shell JS     : %s\n' "$LIBSHELL"
    printf 'Clutter      : %s\n' "$MUTTER_DIR"
    printf 'resources    : %s JS files\n' "$(gresource list "$LIBSHELL" | grep -c '\.js$')"
}

cmd_list() {
    detect
    gresource list "$LIBSHELL" | grep -E "${1:-.}" || true
}

cmd_extract() {
    detect
    [ $# -ge 1 ] || { echo "usage: $0 extract <resource-path>" >&2; exit 2; }
    gresource extract "$LIBSHELL" "$1"
}

# --- probe: every API surface this extension relies on ----------------------
# Kept in sync with docs/verified-apis.md. A MISSING line means the API was
# renamed/removed in this Shell version — fix the code, not the probe.
cmd_probe() {
    detect
    local js
    js=$(cat <<'JS'
imports.gi.versions.Gtk = '4.0';
imports.gi.versions.Adw = '1';
const {St, Clutter, Atk, Pango, Gio, GLib, Gtk, Adw, Gdk} = imports.gi;

let missing = 0, checked = 0;
function chk(label, fn) {
    checked++;
    try {
        if (fn() === false)
            throw new Error('absent');
    } catch (e) {
        missing++;
        print(`MISSING  ${label}`);
    }
}
function has(proto, name) {
    return name in proto || typeof proto[name] !== 'undefined';
}

// St actors and the methods the extension calls on them
for (const c of ['BoxLayout', 'Widget', 'Label', 'Icon', 'Bin', 'Entry', 'Button', 'ScrollView'])
    chk(`St.${c}`, () => typeof St[c] === 'function');
for (const m of ['set_x_expand', 'set_x_align', 'set_style', 'set_reactive',
    'grab_key_focus', 'add_child', 'remove_all_children', 'set_child_below_sibling'])
    chk(`St.Widget.${m}()`, () => has(St.Widget.prototype, m));
chk('St.PolicyType.AUTOMATIC/NEVER', () => St.PolicyType.AUTOMATIC !== undefined && St.PolicyType.NEVER !== undefined);
chk('St.Side.TOP', () => St.Side.TOP !== undefined);
chk('St.Label.accessible_role', () => has(St.Label.prototype, 'accessible_role'));
chk('St.Label.label_actor', () => has(St.Label.prototype, 'label_actor'));
chk('St.Label.add_accessible_state()', () => has(St.Label.prototype, 'add_accessible_state'));
chk('St.ScrollView.enable_mouse_scrolling', () => has(St.ScrollView.prototype, 'enable_mouse_scrolling'));
chk('St.ScrollView.clip_to_allocation', () => has(St.ScrollView.prototype, 'clip_to_allocation'));
chk('St.ScrollView.hadjustment/vadjustment', () => has(St.ScrollView.prototype, 'hadjustment') && has(St.ScrollView.prototype, 'vadjustment'));
chk('St.Button.toggle_mode/set_checked/checked/button_mask', () =>
    has(St.Button.prototype, 'toggle_mode') && has(St.Button.prototype, 'set_checked')
    && has(St.Button.prototype, 'checked') && has(St.Button.prototype, 'button_mask'));
chk('St.Entry.clutter_text', () => has(St.Entry.prototype, 'clutter_text'));
chk('St.Bin.child', () => has(St.Bin.prototype, 'child'));
chk('St.Icon.icon_name', () => has(St.Icon.prototype, 'icon_name'));
// The shell's colour scheme drives every theme-dependent colour we set
// (stylesheet.css scopes them under .todo-dark / .todo-light).
chk('St.Settings.color_scheme', () => has(St.Settings.prototype, 'color_scheme'));
chk('St.SystemColorScheme.PREFER_DARK', () =>
    St.SystemColorScheme !== undefined
    && St.SystemColorScheme.PREFER_DARK !== undefined);

// Clutter: enums, keys, events, actor a11y + opacity
chk('Clutter.ActorAlign.START/END/CENTER', () =>
    Clutter.ActorAlign.START !== undefined && Clutter.ActorAlign.END !== undefined
    && Clutter.ActorAlign.CENTER !== undefined);
chk('Clutter.EVENT_STOP/PROPAGATE', () =>
    Clutter.EVENT_STOP !== undefined && Clutter.EVENT_PROPAGATE !== undefined);
chk('Clutter.ScrollDirection.SMOOTH/UP/DOWN', () =>
    Clutter.ScrollDirection.SMOOTH !== undefined && Clutter.ScrollDirection.UP !== undefined
    && Clutter.ScrollDirection.DOWN !== undefined);
chk('Clutter.KEY_Return/Escape/Left', () =>
    Clutter.KEY_Return !== undefined && Clutter.KEY_Escape !== undefined
    && Clutter.KEY_Left !== undefined);
chk('Clutter.Actor.accessible_role/add_accessible_state()', () =>
    has(Clutter.Actor.prototype, 'accessible_role') && has(Clutter.Actor.prototype, 'add_accessible_state'));
chk('Clutter.Text.set_ellipsize()', () => has(Clutter.Text.prototype, 'set_ellipsize'));
chk('Clutter.Actor.set_opacity()', () => has(Clutter.Actor.prototype, 'set_opacity'));

// Atk roles/states, Pango ellipsize, Gio/GLib file + main-loop API
chk('Atk.Role.MENU_ITEM/CHECK_MENU_ITEM', () =>
    Atk.Role.MENU_ITEM !== undefined && Atk.Role.CHECK_MENU_ITEM !== undefined);
chk('Atk.StateType.CHECKED', () => Atk.StateType.CHECKED !== undefined);
chk('Pango.EllipsizeMode.NONE/END', () =>
    Pango.EllipsizeMode.NONE !== undefined && Pango.EllipsizeMode.END !== undefined);
chk('Gio.File.new_for_path()', () => typeof Gio.File.new_for_path === 'function');
chk('Gio.FileMonitorFlags.NONE', () => Gio.FileMonitorFlags.NONE !== undefined);
chk('GLib.idle_add()', () => typeof GLib.idle_add === 'function');
chk('GLib.Source.remove()', () => typeof GLib.Source.remove === 'function');

// prefs.js: GTK4 + libadwaita
for (const c of ['ColorDialog', 'ColorDialogButton', 'Adjustment', 'Popover', 'MenuButton'])
    chk(`Gtk.${c}`, () => typeof Gtk[c] === 'function');
chk('Gtk.CssProvider.load_from_string()', () => has(Gtk.CssProvider.prototype, 'load_from_string'));
chk('Gtk.StyleContext.add_provider_for_display()', () =>
    typeof Gtk.StyleContext.add_provider_for_display === 'function');
chk('Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION', () => Gtk.STYLE_PROVIDER_PRIORITY_APPLICATION !== undefined);
for (const c of ['PreferencesPage', 'PreferencesGroup', 'EntryRow', 'SpinRow', 'ActionRow'])
    chk(`Adw.${c}`, () => typeof Adw[c] === 'function');
chk('Gdk.RGBA / Gdk.Display.get_default()', () =>
    typeof Gdk.RGBA === 'function' && typeof Gdk.Display.get_default === 'function');

print(`PROBE: ${checked - missing}/${checked} present, ${missing} missing`);
print(missing === 0 ? 'PROBE_OK=true' : 'PROBE_OK=false');
JS
)
    local out
    out=$(gjs_env gjs -c "$js" 2>&1) || true
    printf '%s\n' "$out"
    case "$out" in
        *PROBE_OK=true*) return 0 ;;
        *)
            echo "PROBE FAILED: at least one API this extension uses is missing" >&2
            return 1
            ;;
    esac
}

case "${1:-}" in
    info)    shift; cmd_info "$@" ;;
    list)    shift; cmd_list "$@" ;;
    extract) shift; cmd_extract "$@" ;;
    probe)   shift; cmd_probe "$@" ;;
    *)
        sed -n '2,30p' "$0" | sed 's/^# \{0,1\}//'
        exit 2
        ;;
esac
