#!/usr/bin/env bash
# Instalacion para Debian (tambien como estrato de Bedrock Linux).
# Uso:  bash scripts/setup-linux.sh
# Todo va en tu carpeta de usuario (nvm + ~/.npm-global): no hace falta sudo salvo para git/curl.
set -euo pipefail

# En Bedrock, si tu shell no esta ya en el estrato Debian, relanza dentro de el:
#   strat debian bash scripts/setup-linux.sh
if command -v brl >/dev/null 2>&1; then
  echo "Bedrock detectado. Estrato actual: $(brl which $$ 2>/dev/null || echo desconocido)"
fi

if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  echo "Instalando git y curl (pide sudo)..."
  sudo apt-get update && sudo apt-get install -y git curl ca-certificates
fi

# Node LTS con nvm (el de apt suele ser demasiado antiguo para Gemini CLI)
export NVM_DIR="$HOME/.nvm"
if [ ! -s "$NVM_DIR/nvm.sh" ]; then
  curl -fsSL https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
fi
# shellcheck disable=SC1091
. "$NVM_DIR/nvm.sh"
nvm install --lts
nvm use --lts

npm install -g @anthropic-ai/claude-code @google/gemini-cli

echo
echo "Versiones instaladas:"
node -v; claude --version || true; gemini --version || true
echo
echo "Listo. Abre una terminal NUEVA (para cargar nvm) y, dentro del repositorio, ejecuta 'claude' y 'gemini' para iniciar sesion."
