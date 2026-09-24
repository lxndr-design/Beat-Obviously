#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${BEAT_BUILD_DIR:-${TMPDIR:-/tmp}/beat-native-build-${UID}}"
FRONTEND_STAGE_DIR="${BUILD_DIR}/frontend"
FRONTEND_DIST_PATH="${FRONTEND_STAGE_DIR}/dist"
APP_OUTPUT_PATH="${BEAT_APP_OUTPUT_PATH:-${HOME}/Applications/Beat.app}"

mkdir -p "${BUILD_DIR}"
rsync -a --delete \
  --exclude node_modules \
  --exclude dist \
  "${ROOT_DIR}/frontend/" "${FRONTEND_STAGE_DIR}/"

(
  cd "${FRONTEND_STAGE_DIR}"
  npm_config_cache="${BEAT_NPM_CACHE_DIR:-${BUILD_DIR}/npm-cache}" npm ci
  npm run build
)

CMAKE_ARGS=(
  -S "${ROOT_DIR}"
  -B "${BUILD_DIR}"
  -DCMAKE_BUILD_TYPE=Release
  -DBEAT_BUILD_FRONTEND=OFF
)
if [[ -n "${BEAT_MACOS_DEPLOYMENT_TARGET:-}" ]]; then
  CMAKE_ARGS+=("-DCMAKE_OSX_DEPLOYMENT_TARGET=${BEAT_MACOS_DEPLOYMENT_TARGET}")
fi
cmake "${CMAKE_ARGS[@]}"
cmake --build "${BUILD_DIR}" --target Beat --parallel "${BEAT_BUILD_JOBS:-6}"

APP_PATH="${BUILD_DIR}/backend/Beat_artefacts/Release/Beat.app"
if [[ ! -d "${APP_PATH}" ]]; then
  APP_PATH="$(find "${BUILD_DIR}" -name 'Beat.app' -type d | head -n 1)"
fi

if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  echo "Beat.app was not found after build." >&2
  exit 1
fi

mkdir -p "$(dirname "${APP_OUTPUT_PATH}")"
rm -rf "${APP_OUTPUT_PATH}"
ditto "${APP_PATH}" "${APP_OUTPUT_PATH}"

# The frontend build runs on every package, while CMake's POST_BUILD resource
# copy only runs when the native Beat target relinks. Refresh the packaged copy
# explicitly so a frontend-only change can never leave a stale UI in Beat.app.
ROOT_FRONTEND_PATH="${APP_OUTPUT_PATH}/Contents/Resources/frontend"
if [[ ! -f "${FRONTEND_DIST_PATH}/index.html" ]]; then
  echo "Built frontend was not found: ${FRONTEND_DIST_PATH}" >&2
  exit 1
fi
cmake -E remove_directory "${ROOT_FRONTEND_PATH}"
cmake -E copy_directory "${FRONTEND_DIST_PATH}" "${ROOT_FRONTEND_PATH}"

if ! "${ROOT_DIR}/scripts/register-current-beat-app.sh" "${APP_OUTPUT_PATH}"; then
  echo "warning: Beat.app was packaged, but LaunchServices did not accept the .beat default-handler registration." >&2
  echo "warning: The app bundle remains usable; rerun scripts/register-current-beat-app.sh after moving Beat.app if Finder double-click association is required." >&2
fi
echo "${APP_OUTPUT_PATH}"
