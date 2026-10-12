#!/usr/bin/env bash
#
# ego-screenshot.sh — capture the screen for an extensions.gnome.org upload
# WITHOUT stealing focus (the extension's menu closes on focus loss).
#
# WHY NOT gnome-screenshot: GNOME 50 narrowed the DBusSenderChecker allow-list
# of org.gnome.Shell.Screenshot and dropped org.gnome.Screenshot (lesson
# L-041). The X11 fallback is gone too (GNOME 50 has no X11), so the old
# `gnome-screenshot -f` procedure writes nothing.
#
# WHY THE PORTAL: org.freedesktop.portal.Screenshot reaches the Shell through
# the portal backend (org.freedesktop.impl.portal.desktop.gnome), which is
# STILL on the allow-list — and on GNOME 50 the portal's non-interactive
# Screenshot does NOT prompt (measured: Response code 0, no dialog, so an open
# menu survives the capture).
#
# USAGE
#   tools/ego-screenshot.sh [output.png] [WxH+X+Y]
#
# The optional second argument crops with ImageMagick. ALWAYS crop to the menu:
# a full-screen shot carries personal content into a public submission.
#
set -euo pipefail

OUT="${1:-$HOME/Pictures/ego-screenshot.png}"
CROP="${2:-}"
RAW="$(mktemp --suffix=.png)"
trap 'rm -f "$RAW"' EXIT

python3 - "$RAW" <<'PY'
import shutil, sys
import gi
gi.require_version('Gio', '2.0')
from gi.repository import Gio, GLib

dest = sys.argv[1]
bus = Gio.bus_get_sync(Gio.BusType.SESSION, None)
res = bus.call_sync(
    'org.freedesktop.portal.Desktop', '/org/freedesktop/portal/desktop',
    'org.freedesktop.portal.Screenshot', 'Screenshot',
    GLib.Variant('(sa{sv})', ('', {'interactive': GLib.Variant('b', False)})),
    GLib.VariantType('(o)'), Gio.DBusCallFlags.NONE, 5000, None)
handle = res.unpack()[0]

loop = GLib.MainLoop()

def on_signal(conn, sender, path, iface, signal, params):
    if path != handle:
        return
    code, results = params.unpack()
    if code != 0:
        print('portal refused: code %d (1=cancelled, 2=other)' % code, file=sys.stderr)
        loop.quit()
        return
    shutil.copyfile(Gio.File.new_for_uri(results['uri']).get_path(), dest)
    loop.quit()

bus.signal_subscribe('org.freedesktop.portal.Desktop',
                     'org.freedesktop.portal.Request', 'Response',
                     None, None, Gio.DBusSignalFlags.NONE, on_signal)
GLib.timeout_add_seconds(15, lambda: (print('TIMEOUT: no portal Response', file=sys.stderr),
                                      loop.quit(), False)[-1])
loop.run()
PY

if [ -n "$CROP" ]; then
    magick "$RAW" -crop "$CROP" +repage "$OUT"
else
    cp "$RAW" "$OUT"
fi
echo "saved: $OUT"
magick identify "$OUT"
