#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
BUILD_DIR="${ROOT_DIR}/build-native"

cmake -S "${ROOT_DIR}" -B "${BUILD_DIR}" -DCMAKE_BUILD_TYPE=Release -DBEAT_BUILD_FRONTEND=ON
cmake --build "${BUILD_DIR}"

APP_PATH="${BUILD_DIR}/backend/Beat_artefacts/Release/Beat.app"
if [[ ! -d "${APP_PATH}" ]]; then
  APP_PATH="$(find "${BUILD_DIR}" -name 'Beat.app' -type d | head -n 1)"
fi

if [[ -z "${APP_PATH}" || ! -d "${APP_PATH}" ]]; then
  echo "Beat.app was not found after build." >&2
  exit 1
fi

ROOT_APP_PATH="${ROOT_DIR}/Beat.app"
rm -rf "${ROOT_APP_PATH}"
ditto "${APP_PATH}" "${ROOT_APP_PATH}"

# The frontend build runs on every package, while CMake's POST_BUILD resource
# copy only runs when the native Beat target relinks. Refresh the packaged copy
# explicitly so a frontend-only change can never leave a stale UI in Beat.app.
FRONTEND_DIST_PATH="${ROOT_DIR}/frontend/dist"
ROOT_FRONTEND_PATH="${ROOT_APP_PATH}/Contents/Resources/frontend"
if [[ ! -f "${FRONTEND_DIST_PATH}/index.html" ]]; then
  echo "Built frontend was not found: ${FRONTEND_DIST_PATH}" >&2
  exit 1
fi
cmake -E remove_directory "${ROOT_FRONTEND_PATH}"
cmake -E copy_directory "${FRONTEND_DIST_PATH}" "${ROOT_FRONTEND_PATH}"

# Keep a single user-facing launcher in the repo root. CMake/Xcode creates an
# intermediate app bundle under build-native; after packaging, the root copy is
# the one users should launch/register.
if [[ "${APP_PATH}" != "${ROOT_APP_PATH}" ]]; then
  rm -rf "${APP_PATH}"
fi
rm -rf "${BUILD_DIR}/backend/Beat_artefacts/JuceLibraryCode/Beat"

if ! "${ROOT_DIR}/scripts/register-current-beat-app.sh" "${ROOT_APP_PATH}"; then
  echo "warning: Beat.app was packaged, but LaunchServices did not accept the .beat default-handler registration." >&2
  echo "warning: The app bundle remains usable; rerun scripts/register-current-beat-app.sh after moving Beat.app if Finder double-click association is required." >&2
fi
echo "${ROOT_APP_PATH}"
