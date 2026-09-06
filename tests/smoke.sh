#!/usr/bin/env bash
#
# Smoke test for the todo GNOME Shell extension.
#
# Purpose: after any UI change to extension.js / stylesheet.css, confirm the
# extension still loads and stays in the ACTIVE state (i.e. it did NOT throw
# during enable()). This catches the API-invention class of failures that
# unit tests cannot (storage.js tests never exercise the UI layer).
#
# This is intentionally a lightweight check against the running Shell; deep
# UI correctness comes from VERIFY-BEFORE-WRITE (see .goosehints), not from
# automated tests.
#
# Usage:  bash tests/smoke.sh
# Exit:   0 if the extension is ACTIVE (or the check cannot run), 1 if it is
#         reported ERROR.

set -u

UUID="todo@ertugrul.local"

# Looking Glass / journalctl-style errors live in the Shell process, but the
# reliable non-interactive signal here is the extension state from
# gnome-extensions. If the tool is unavailable (headless/CI), skip quietly.
if ! command -v gnome-extensions >/dev/null 2>&1; then
    echo "SKIP: gnome-extensions not available (headless/CI)"
    exit 0
fi

state="$(
    gnome-extensions info "$UUID" 2>/dev/null \
        | awk -F': ' '/State:/{print $2}' \
        | tr -d '[:space:]'
)"

if [ "$state" = "ACTIVE" ]; then
    echo "OK: $UUID is $state"
    exit 0
fi

echo "FAIL: $UUID state is '${state:-<unknown>}' (expected ACTIVE)" >&2
exit 1
