#!/usr/bin/env bash
# Build the extensions.gnome.org package zip WITHOUT touching the repo layout.
#
# The zip root must contain only runtime files (EGO review rules):
#   extension.js metadata.json prefs.js storage.js tabBar.js rowFactory.js
#   stylesheet.css schemas/<id>.gschema.xml  LICENSE
# README.md / CHANGELOG.md / tests/ / docs/ / *.compiled are never packaged.
#
# Usage:  bash tools/make-package.sh
# Output: dist/<uuid>-<version-name>.zip
set -euo pipefail
cd "$(dirname "$0")/.."

EXT_DIR="todo-md@ertugrulsefal.github.com"
DIST_DIR="dist"
METADATA="$EXT_DIR/metadata.json"

# Read uuid + version from metadata.json (single source of truth).
UUID=$(jq -r '.uuid' "$METADATA")
VERSION=$(jq -r '."version-name"' "$METADATA")
SCHEMA_ID=$(jq -r '."settings-schema"' "$METADATA")
SCHEMA_FILE="$EXT_DIR/schemas/$SCHEMA_ID.gschema.xml"

# Fixed package list. LICENSE lives at the repo root (single copy, GitHub
# detection); the script copies it into the zip root at packaging time.
FILES=(
    "$EXT_DIR/extension.js"
    "$EXT_DIR/metadata.json"
    "$EXT_DIR/prefs.js"
    "$EXT_DIR/storage.js"
    "$EXT_DIR/tabBar.js"
    "$EXT_DIR/rowFactory.js"
    "$EXT_DIR/stylesheet.css"
    "$SCHEMA_FILE"
    "LICENSE"
)

# Fail fast if any expected file is missing (e.g. schema renamed again).
for f in "${FILES[@]}"; do
    [ -f "$f" ] || { echo "ERROR: missing package file: $f" >&2; exit 1; }
done

STAGING=$(mktemp -d)
trap 'rm -rf "$STAGING"' EXIT

# Assemble the staging tree: root-level files + schemas/ subdirectory.
for f in "${FILES[@]}"; do
    case "$f" in
        */*) mkdir -p "$STAGING/$(dirname "${f#"$EXT_DIR"/}")"
             cp "$f" "$STAGING/${f#"$EXT_DIR"/}" ;;
        *)   cp "$f" "$STAGING/" ;;
    esac
done

mkdir -p "$DIST_DIR"
OUT="$DIST_DIR/$UUID-$VERSION.zip"
rm -f "$OUT"
( cd "$STAGING" && zip -X -q -r "$OLDPWD/$OUT" . )

# --- Verification -----------------------------------------------------------
# 1) Exact content check: the zip must contain exactly the expected entries.
EXPECTED=$(printf '%s\n' \
    extension.js metadata.json prefs.js storage.js tabBar.js rowFactory.js \
    stylesheet.css "schemas/$(basename "$SCHEMA_FILE")" LICENSE | sort)
ACTUAL=$(unzip -Z1 "$OUT" | grep -v '/$' | sort)
if [ "$EXPECTED" != "$ACTUAL" ]; then
    echo "ERROR: zip contents differ from the expected package list" >&2
    diff <(echo "$EXPECTED") <(echo "$ACTUAL") >&2 || true
    exit 1
fi

# 2) No compiled schema may ever ship (GNOME 45+ compiles at install time).
if unzip -Z1 "$OUT" | grep -q '\.compiled'; then
    echo "ERROR: gschemas.compiled leaked into the package" >&2
    exit 1
fi

echo "OK: $OUT"
echo "version-name: $VERSION  uuid: $UUID"
unzip -Z1 "$OUT" | grep -v '/$' | sort | sed 's/^/  /'
