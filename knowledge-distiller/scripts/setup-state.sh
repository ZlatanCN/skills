#!/bin/bash
# Self-contained state for knowledge-distiller.
# Usage:
#   setup-state.sh       → check mode: exit 0 (exists) / exit 1 (not found)
#   setup-state.sh write → force-write state.json, exit 0

SKILL_DIR="$(cd "$(dirname "$0")/.." && pwd)"
STATE="${SKILL_DIR}/state.json"

if [ "$1" = "write" ]; then
    echo '{"setup_complete":true}' > "$STATE"
    exit 0
fi

[ -f "$STATE" ] && exit 0
exit 1
