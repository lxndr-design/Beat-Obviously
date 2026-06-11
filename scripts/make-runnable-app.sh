#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/Beat.app"

"${ROOT_DIR}/scripts/register-current-beat-app.sh" "${APP_DIR}"
echo "${APP_DIR}"
