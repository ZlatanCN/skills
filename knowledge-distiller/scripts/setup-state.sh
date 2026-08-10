#!/usr/bin/env bash
set -euo pipefail
# Self-contained state for knowledge-distiller.
# Usage:
#   setup-state.sh       → check mode: exit 0 (exists) / exit 1 (not found)
#   setup-state.sh write → force-write state.json, exit 0

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${SKILL_DIR}/state.json"

if [ "${1:-}" = "write" ]; then
    umask 077
    TEMP_STATE="${STATE}.tmp.$$"
    trap 'rm -f "$TEMP_STATE"' EXIT
    printf '%s\n' '{"setup_complete":true}' > "$TEMP_STATE"
    mv -f "$TEMP_STATE" "$STATE"
    exit 0
fi

[ -f "$STATE" ] && exit 0
exit 1
