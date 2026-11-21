#!/usr/bin/env bash
# Installs the scanner on Linux (Debian/Ubuntu) or macOS: Python environment, Tesseract and spa/cat/eng.
# Usage: bash scanner/pdf/scripts/install.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # scanner/pdf

if ! command -v tesseract >/dev/null; then
  if command -v apt-get >/dev/null; then
    sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-spa tesseract-ocr-cat python3-venv
  elif command -v brew >/dev/null; then
    brew install tesseract tesseract-lang
  else
    echo "Install Tesseract with spa and cat using your package manager and run this again." >&2; exit 1
  fi
fi
for l in spa cat; do
  tesseract --list-langs 2>/dev/null | grep -qx "$l" || echo "WARNING: language $l is missing (tesseract-ocr-$l)" >&2
done

[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -e ".[dev]"
.venv/bin/python -m pytest -q
echo "Done. Try: .venv/bin/python -m scanner_pdf capture.png -o output"
