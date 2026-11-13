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
# UI correctness comes from VERIFY-BEFORE-WRITE (see AGENTS.md), not from
# automated tests.
#
# Usage:  bash tests/smoke.sh
# Exit:   0 if the extension is ACTIVE (or the check cannot run), 1 if it is
#         reported ERROR.

set -u

UUID="todo-md@ertugrulsefal.github.com"

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

# The Shell runs user extensions in the "unlock-dialog" session mode, so a
# locked screen reports every extension INACTIVE. That is not a failure of
# this extension: check the lock before reporting one.
if [ "$state" = "INACTIVE" ] && command -v loginctl >/dev/null 2>&1; then
    session_id=$(loginctl show-user "$(id -un)" -p Display --value 2>/dev/null || true)
    if [ -n "$session_id" ] \
        && loginctl show-session "$session_id" -p LockedHint 2>/dev/null \
        | grep -q 'LockedHint=yes'; then
        echo "SKIP: session is locked; the Shell reports every extension INACTIVE (unlock and re-run)"
        exit 0
    fi
fi

echo "FAIL: $UUID state is '${state:-<unknown>}' (expected ACTIVE)" >&2
exit 1
