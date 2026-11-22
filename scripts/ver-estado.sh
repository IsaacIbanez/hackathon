#!/usr/bin/env bash
# Summary of the status of all the agents (reads the Spanish status files: Estado, Tarea actual, Rama)
cd "$(dirname "$0")/.."
git pull -q 2>/dev/null || true
printf "%-7s %-12s %-10s %s\n" AGENT STATUS TASK BRANCH
for f in estado/P*.md; do
  a=$(basename "$f" .md)
  g() { grep -m1 "^- \*\*$1:\*\*" "$f" | sed "s/^- \*\*$1:\*\* *//"; }
  printf "%-7s %-12s %-10s %s\n" "$a" "$(g Estado)" "$(g 'Tarea actual')" "$(g Rama)"
done
