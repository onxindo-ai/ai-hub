#!/usr/bin/env bash
set -euo pipefail
export PATH="${HOME}/.local/bin:${HOME}/.antigravity/bin:/opt/homebrew/bin:/usr/local/bin:${PATH:-/usr/bin:/bin}"
DIR="$(cd "$(dirname "$0")" && pwd)"
exec node "${DIR}/ask-main.mjs" "$@"
