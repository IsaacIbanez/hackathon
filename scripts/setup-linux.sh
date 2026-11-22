#!/usr/bin/env bash
# Install for Debian (also as a Bedrock Linux stratum).
# Usage:  bash scripts/setup-linux.sh
# Everything goes in your user folder (nvm + ~/.npm-global): no sudo needed except for git/curl.
set -euo pipefail

# On Bedrock, if your shell is not already in the Debian stratum, relaunch inside it:
#   strat debian bash scripts/setup-linux.sh
if command -v brl >/dev/null 2>&1; then
  echo "Bedrock detected. Current stratum: $(brl which $$ 2>/dev/null || echo unknown)"
fi

if ! command -v git >/dev/null || ! command -v curl >/dev/null; then
  echo "Installing git and curl (asks for sudo)..."
  sudo apt-get update && sudo apt-get install -y git curl ca-certificates
fi

# Node LTS with nvm (apt's is usually too old for Gemini CLI)
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
echo "Installed versions:"
node -v; claude --version || true; gemini --version || true
echo
echo "Done. Open a NEW terminal (to load nvm) and, inside the repository, run 'claude' and 'gemini' to log in."
