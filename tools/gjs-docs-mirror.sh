#!/usr/bin/env bash
#
# gjs-docs-mirror.sh — refresh the offline gjs-docs mirror.
#
# gjs-docs.gnome.org serves a DevDocs-style static API per package:
#   https://gjs-docs.gnome.org/<slug>/index.json   { "entries": [ {name, path, type} ] }
#   https://gjs-docs.gnome.org/<slug>/db.json      { "<page.path>": "<html content>" }
# The mirror lives in ~/.local/share/gjs-docs-offline/<slug>/ and is read by the
# `gjsdoc` helper (~/.local/bin/gjsdoc).
#
# GNOME -> GI version:  46 -> 14, 47 -> 15, 48 -> 16, 49 -> 17, 50 -> 18
#
# ⚠️ FROZEN — checked 2026-10-11: gjs-docs.gnome.org no longer serves the
# docset JSON. /<slug>/index.json and /<slug>/db.json both return the SPA HTML
# shell (~5941 bytes) for EVERY slug, so this script currently fails for all of
# them. It is kept only in case upstream restores the endpoint. For the version
# actually installed the ground truth is the Shell itself —
# use tools/shell-api.sh (extract / probe).
#
# USAGE
#   tools/gjs-docs-mirror.sh                 # refresh the whole list below
#   tools/gjs-docs-mirror.sh st17~17         # only these slugs
#
# Exit: 0 if every slug downloaded, 1 if any is unavailable.
set -euo pipefail

BASE=https://gjs-docs.gnome.org
DEST=${GJS_DOCS_MIRROR:-$HOME/.local/share/gjs-docs-offline}

# Every GNOME version this project intends to support (46-50), plus the
# version-independent GLib/Gio/gjs packages.
DEFAULT_SLUGS=(
    st14~14 shell14~14 clutter14~14 meta14~14
    st15~15 shell15~15 clutter15~15 meta15~15
    st16~16 shell16~16 clutter16~16 meta16~16
    st17~17 shell17~17 clutter17~17 meta17~17
    gio20~2.0 glib20~2.0 gjs
)

slugs=("$@")
if [ ${#slugs[@]} -eq 0 ]; then
    slugs=("${DEFAULT_SLUGS[@]}")
fi

fail=0
for slug in "${slugs[@]}"; do
    dir="$DEST/$slug"
    mkdir -p "$dir"
    for f in index.json db.json; do
        tmp=$(mktemp)
        if curl -fsS --retry 3 --retry-delay 2 -m 180 -o "$tmp" "$BASE/$slug/$f" \
            && python3 -c 'import json,sys; json.load(open(sys.argv[1]))' "$tmp" 2>/dev/null
        then
            mv "$tmp" "$dir/$f"
            printf 'OK    %-14s %-11s %s\n' "$slug" "$f" "$(du -h "$dir/$f" | cut -f1)"
        else
            # A response starting with '<' is the SPA HTML shell, not a docset:
            # the static JSON is no longer deployed upstream (2026-10-11).
            if head -c 1 "$tmp" 2>/dev/null | grep -q '<'; then
                why='HTML returned - endpoint gone upstream'
            else
                why='not published'
            fi
            rm -f "$tmp"
            printf 'FAIL  %-14s %-11s (%s)\n' "$slug" "$f" "$why" >&2
            fail=1
        fi
    done
done
exit $fail
