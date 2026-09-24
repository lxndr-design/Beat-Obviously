#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${BEAT_APP_OUTPUT_PATH:-${HOME}/Applications/Beat.app}"

"${ROOT_DIR}/scripts/register-current-beat-app.sh" "${APP_DIR}"
echo "${APP_DIR}"
