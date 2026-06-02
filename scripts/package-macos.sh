#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build"

cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" -G Xcode -DCMAKE_BUILD_TYPE=Release -DBEAT_BUILD_FRONTEND=ON
cmake --build "${BUILD_DIR}" --config Release

APP_PATH="${BUILD_DIR}/backend/Beat_artefacts/Release/Beat.app"
if [[ ! -d "${APP_PATH}" ]]; then
  APP_PATH="$(find "${BUILD_DIR}" -name 'Beat.app' -type d | head -n 1)"
fi

if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  echo "Beat.app was not found after build." >&2
  exit 1
fi

echo "${APP_PATH}"
