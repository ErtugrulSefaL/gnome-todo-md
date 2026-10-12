#!/usr/bin/env bash
#
# vm-setup.sh — run INSIDE a test VM, with the project shared in over virtiofs.
#
# WHY: the guest console has no clipboard sharing, so typing long commands (and
# pasting their output back) by hand is the worst part of VM testing. Mount the
# project instead and run this one file: it configures the extension and writes
# its whole report to <repo>/.vm/out.txt, which the HOST can read directly.
#
# USAGE (inside the VM; two short lines, no copying)
#   sudo mount -t virtiofs todomd /mnt        # 9p fallback below
#   bash /mnt/tools/vm-setup.sh
#
# 9p fallback if virtiofs is unavailable:
#   sudo mount -t 9p -o trans=virtio,version=9p2000.L todomd /mnt
#
# Then log out and back in (the shell only scans extension directories at
# startup) and run the RC checklist in the menu.
#
set -u

REPO=/mnt
EXT_SRC="$REPO/todo-md@ertugrulsefal.github.com"
EXT_DIR="$HOME/.local/share/gnome-shell/extensions/todo-md@ertugrulsefal.github.com"
OUT="$REPO/.vm/out.txt"

mkdir -p "$REPO/.vm"

{
    echo "=== vm-setup report — $(date -Is) ==="
    echo "--- os ---"
    . /etc/os-release 2>/dev/null && echo "$PRETTY_NAME"
    echo "gnome-shell: $(gnome-shell --version 2>&1)"
    echo "hostname: $(hostname)"

    echo "--- session ---"
    cat "/proc/$(pgrep -x gnome-shell | head -1)/environ" 2>/dev/null \
        | tr '\0' '\n' | grep -E '^XDG_SESSION_TYPE=|^DISPLAY=|^WAYLAND_DISPLAY='

    echo "--- version found in the shared repo ---"
    python3 -c "import json;print(json.load(open('$EXT_SRC/metadata.json'))['version-name'])" 2>/dev/null \
        || grep -o '"version-name": *"[^"]*"' "$EXT_SRC/metadata.json"

    echo "--- schema compile ---"
    if glib-compile-schemas "$EXT_SRC/schemas/"; then echo SCHEMA_OK; else echo SCHEMA_FAIL; fi

    echo "--- symlink into the extensions dir ---"
    mkdir -p "$(dirname "$EXT_DIR")"
    rm -rf "$EXT_DIR"
    if ln -s "$EXT_SRC" "$EXT_DIR"; then ls -l "$EXT_DIR"; else echo SYMLINK_FAIL; fi

    echo "--- test fixture (~/todo.md) ---"
    FIXTURE="$REPO/.vm/fixture.md"
    if [ -f "$FIXTURE" ]; then
        if [ -f "$HOME/todo.md" ]; then
            cp "$HOME/todo.md" "$HOME/todo.md.bak.$(date +%s)"
            echo "existing ~/todo.md backed up"
        fi
        cp "$FIXTURE" "$HOME/todo.md"
        echo "fixture installed: $(grep -c '^## ' "$HOME/todo.md") categories / $(grep -c '^- \[' "$HOME/todo.md") tasks"
    else
        echo "(no fixture at $FIXTURE — skipping)"
    fi

    echo "--- version-validation bypass (test-only setting) ---"
    export XDG_RUNTIME_DIR="/run/user/$(id -u)"
    export DBUS_SESSION_BUS_ADDRESS="unix:path=$XDG_RUNTIME_DIR/bus"
    if gsettings set org.gnome.shell disable-extension-version-validation true; then
        echo BYPASS_OK
    else
        echo BYPASS_FAIL
    fi
    echo "value: $(gsettings get org.gnome.shell disable-extension-version-validation 2>&1)"

    echo "--- extension state (before the session restart) ---"
    gnome-extensions info todo-md@ertugrulsefal.github.com 2>&1 | grep -E "Version|State|Enabled" \
        || echo "(shell has not scanned it yet — log out and back in)"

    echo "--- LAYER 1: API probe ---"
    bash "$REPO/tools/shell-api.sh" probe
} > "$OUT" 2>&1

echo
echo "TAMAM — rapor host'ta: <repo>/.vm/out.txt"
echo "Ozet:"
grep -E "SCHEMA_|SYMLINK_|BYPASS_|PROBE|State:|Version:" "$OUT" | tail -8
