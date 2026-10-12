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

    echo "--- install into the extensions dir (COPY, not a symlink) ---"
    # A symlink into the share breaks on the next boot: /mnt is gone, the shell
    # cannot read metadata.json and does not list the extension at all. Copy
    # instead, so the installed extension is self-contained.
    mkdir -p "$(dirname "$EXT_DIR")"
    rm -rf "$EXT_DIR"
    mkdir -p "$EXT_DIR"
    if cp -r "$EXT_SRC/." "$EXT_DIR/"; then
        echo "copied $(du -sh "$EXT_DIR" | cut -f1) -> $EXT_DIR"
    else
        echo COPY_FAIL
    fi

    echo "--- schema compile (in the installed copy) ---"
    if glib-compile-schemas "$EXT_DIR/schemas/"; then echo SCHEMA_OK; else echo SCHEMA_FAIL; fi

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

    echo "--- diagnostics: why would the extension not be listed? ---"
    if mountpoint -q /mnt; then
        echo "/mnt: MOUNTED ($(findmnt -no FSTYPE,SOURCE /mnt 2>/dev/null))"
    else
        echo "/mnt: NOT MOUNTED -> the symlink below is DANGLING and the shell"
        echo "     cannot read metadata.json, so it will not list the extension."
        echo "     Fix: sudo mount -t virtiofs todomd /mnt, then log out and back in."
    fi
    echo "extensions dir:"; ls -l "$HOME/.local/share/gnome-shell/extensions/" 2>&1
    echo "installed copy readable? $([ -r "$EXT_DIR/metadata.json" ] && echo yes || echo NO)"
    echo "installed version: $(grep -o '\"version-name\": *\"[^\"]*\"' "$EXT_DIR/metadata.json" 2>/dev/null)"
    echo "shell's own list:"; gnome-extensions list 2>&1 | head -10
    echo "is our uuid listed by gnome-extensions? $(gnome-extensions list 2>/dev/null | grep -c '^todo-md@')"

    echo "--- LAYER 1: API probe ---"
    bash "$REPO/tools/shell-api.sh" probe
} > "$OUT" 2>&1

echo
echo "TAMAM — rapor host'ta: <repo>/.vm/out.txt"
echo "Ozet:"
grep -E "SCHEMA_|SYMLINK_|BYPASS_|PROBE|State:|Version:" "$OUT" | tail -8
