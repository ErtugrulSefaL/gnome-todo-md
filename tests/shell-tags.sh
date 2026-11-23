#!/usr/bin/env bash
# Run a packaged build in a headless Wayland Shell with temporary data and settings.
# Usage: bash tests/shell-tags.sh dist/<package>.zip
set -euo pipefail

repo=$(cd "$(dirname "$0")/.." && pwd)
package=$(realpath "${1:?pass the extension ZIP as the first argument}")
profile=$(mktemp -d)
trap 'rm -rf "$profile"' EXIT
mkdir -m 700 "$profile/home" "$profile/runtime"
printf '%s\n' '- [ ] Initial fixture' > "$profile/home/todo.md"

if ! env HOME="$profile/home" XDG_RUNTIME_DIR="$profile/runtime" \
    WAYLAND_DISPLAY=gnome-shell-test-display \
    XDG_CURRENT_DESKTOP=GNOME GSETTINGS_BACKEND=keyfile LIBGL_ALWAYS_SOFTWARE=1 \
    TODO_MD_SMOKE="$repo/tests/smoke.sh" \
    timeout --kill-after=5s 45s dbus-run-session -- gnome-shell-test-tool \
    --headless --disable-animations --extension "$package" "$repo/tests/shell-tags.js" \
    > "$profile/shell.log" 2>&1; then
    cat "$profile/shell.log"
    exit 1
fi
if ! rg -q 'TODO_MD_SHELL_TAGS_OK' "$profile/shell.log"; then
    cat "$profile/shell.log"
    exit 1
fi
rg 'TODO_MD_SHELL_TAGS_OK|Todo MD test:|is ACTIVE' "$profile/shell.log"
