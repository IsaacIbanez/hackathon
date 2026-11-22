#!/usr/bin/env bash
# Crea la rama y la carpeta de trabajo (worktree) de un agente.
# Uso: scripts/nueva-tarea.sh <slot> <id-tarea> <nombre-corto>
# Ejemplo: scripts/nueva-tarea.sh P2-C T3 logica-principal
set -euo pipefail

if [ $# -ne 3 ]; then
  echo "Uso: $0 <slot> <id-tarea> <nombre-corto>" >&2
  exit 1
fi

SLOT="$1"
TAREA="$2"
NOMBRE="$3"
RAMA="feature/${TAREA}-${NOMBRE}"
RUTA="../hackathon-worktrees/${SLOT}-${TAREA}"

git fetch --all --quiet || true
git worktree add -b "$RAMA" "$RUTA" main
echo "Rama: $RAMA"
echo "Carpeta de trabajo: $RUTA"
echo "Siguiente paso: cd $RUTA y lanza tu agente (ver docs/historial/INSTRUCCIONES_ARRANQUE.md)."
