#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_DIR="${ROOT_DIR}/Beat.app"

chmod +x "${APP_DIR}/Contents/MacOS/Beat"
echo "${APP_DIR}"
