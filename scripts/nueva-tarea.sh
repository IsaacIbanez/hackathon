#!/usr/bin/env bash
# Creates an agent's branch and working folder (worktree).
# Usage: scripts/nueva-tarea.sh <slot> <task-id> <short-name>
# Example: scripts/nueva-tarea.sh P2-C T3 main-logic
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Usage: $0 <slot> <task-id> <short-name>" >&2
  exit 1
fi

SLOT="$1"
TAREA="$2"
NOMBRE="$3"
RAMA="feature/${TAREA}-${NOMBRE}"
RUTA="../hackathon-worktrees/${SLOT}-${TAREA}"

git fetch --all --quiet || true
git worktree add -b "$RAMA" "$RUTA" main
echo "Branch: $RAMA"
echo "Working folder: $RUTA"
echo "Next step: cd $RUTA and start your agent (see docs/historial/INSTRUCCIONES_ARRANQUE.md)."
