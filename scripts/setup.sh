#!/usr/bin/env bash
# Leonida Intelligence — Linux/macOS setup (bare metal). For Docker, see README.
set -euo pipefail
cd "$(dirname "$0")/.."

command -v node >/dev/null || { echo "Node.js 24+ is required (https://nodejs.org or your package manager)"; exit 1; }
major=$(node -p 'process.versions.node.split(".")[0]')
[ "$major" -ge 24 ] || { echo "Node.js $(node --version) found; 24+ required"; exit 1; }
command -v git >/dev/null || { echo "git is required (apt install git)"; exit 1; }

npm install --no-audit --no-fund
npm run build
[ -f .env ] || cp .env.example .env
node --disable-warning=ExperimentalWarning scripts/fetch-data.ts "$@"

echo
echo "Setup complete. Start with:  npm start"
echo "Run as a service: see deploy/leonida-intelligence.service"
