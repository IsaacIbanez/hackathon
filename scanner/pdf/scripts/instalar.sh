#!/usr/bin/env bash
# Instala el escáner en Linux (Debian/Ubuntu) o macOS: entorno Python, Tesseract y spa/cat/eng.
# Uso: bash scanner/pdf/scripts/instalar.sh
set -euo pipefail
cd "$(dirname "$0")/.."   # scanner/pdf

if ! command -v tesseract >/dev/null; then
  if command -v apt-get >/dev/null; then
    sudo apt-get update && sudo apt-get install -y tesseract-ocr tesseract-ocr-spa tesseract-ocr-cat python3-venv
  elif command -v brew >/dev/null; then
    brew install tesseract tesseract-lang
  else
    echo "Instala Tesseract con spa y cat con tu gestor de paquetes y vuelve a ejecutar." >&2; exit 1
  fi
fi
for l in spa cat; do
  tesseract --list-langs 2>/dev/null | grep -qx "$l" || echo "AVISO: falta el idioma $l (tesseract-ocr-$l)" >&2
done

[ -d .venv ] || python3 -m venv .venv
.venv/bin/python -m pip install -q --upgrade pip
.venv/bin/python -m pip install -q -e ".[dev]"
.venv/bin/python -m pytest -q
echo "Listo. Prueba: .venv/bin/python -m escaner_pdf captura.png -o salida"
