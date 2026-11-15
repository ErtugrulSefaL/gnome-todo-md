#!/usr/bin/env bash
# EGO submission gate — the Shexli findings the review page shows.
#
# The 0.22.2 rejection was "Didn't review. Shexli issues need to be addressed
# first." The review page's "Shexli (experimental)" panel is the gate: a
# finding there stops the review, so the analyzer must be clean before an
# upload. This script runs the same analyzer on the built zip and fails on any
# finding outside the documented allowlist.
#
# Usage:  bash tools/ego-gate.sh [--install]
#   --install   create a throwaway venv in /tmp/shexli-gate and install the
#               pinned analyzer (tree-sitter 0.26 segfaults; 0.25.0 is the
#               pin).
# Needs:  python3 + pip (or --install), and zip for make-package.sh.
# Exit:   0 = no finding outside the allowlist; 1 = finding or analyzer missing.
set -euo pipefail
cd "$(dirname "$0")/.."

EXT_DIR="todo-md@ertugrulsefal.github.com"
read_meta() {
    sed -n "s/.*\"$1\"[[:space:]]*:[[:space:]]*\"\([^\"]*\)\".*/\1/p" "$EXT_DIR/metadata.json" | head -n1
}
UUID=$(read_meta uuid)
VERSION=$(read_meta version-name)

# Allowlist: EGO-M-004 is a false positive in shexli 0.2.1 — its metadata table
# stops at GNOME 50, so "51" reads as an implausible future release. The user
# accepted the justified allowlist (docs/roadmap.md, 2026-11-13). Keep this
# list empty unless a finding is proven to be a tool bug, not a code defect.
ALLOWLIST="EGO-M-004"

if [ "${1:-}" = "--install" ]; then
    # A half-created venv makes `venv --clear` fail on its own lib64 symlink.
    rm -rf /tmp/shexli-gate
    python3 -m venv /tmp/shexli-gate
    /tmp/shexli-gate/bin/pip install --quiet 'shexli' 'tree-sitter==0.25.0'
    SX=/tmp/shexli-gate/bin/shexli
else
    SX=$(command -v shexli || true)
    if [ -z "$SX" ]; then
        echo "ERROR: shexli not found. Re-run with --install, or install it:" >&2
        echo "  pip install shexli 'tree-sitter==0.25.0'" >&2
        exit 1
    fi
fi

bash tools/make-package.sh >/dev/null
ZIP="dist/$UUID-$VERSION.zip"
[ -f "$ZIP" ] || { echo "ERROR: missing $ZIP" >&2; exit 1; }

# shexli exits non-zero on findings; the text is the evidence.
OUT=$("$SX" --format text "$ZIP" 2>&1) || true
printf '%s\n' "$OUT"

FINDINGS=$(printf '%s\n' "$OUT" | grep -oE '^EGO-[A-Z]-[0-9]+' || true)
if [ -z "$FINDINGS" ]; then
    echo "OK: no Shexli findings"
    exit 0
fi

UNEXPECTED=$(printf '%s\n' "$FINDINGS" | grep -vE "^($ALLOWLIST)$" || true)
if [ -n "$UNEXPECTED" ]; then
    echo "ERROR: unexpected Shexli findings: $(printf '%s ' $UNEXPECTED)" >&2
    exit 1
fi

echo "OK: only the allowlisted finding(s) remain ($ALLOWLIST)"
