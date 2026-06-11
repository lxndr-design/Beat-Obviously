#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
APP_PATH="${1:-${ROOT_DIR}/Beat.app}"
INFO_PLIST="${APP_PATH}/Contents/Info.plist"
EXECUTABLE="${APP_PATH}/Contents/MacOS/Beat"
LSREGISTER="/System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister"

if [[ ! -d "${APP_PATH}" ]]; then
  echo "usage: $0 /path/to/Beat.app" >&2
  echo "Beat.app not found: ${APP_PATH}" >&2
  exit 2
fi

if [[ ! -f "${INFO_PLIST}" ]]; then
  echo "Info.plist not found: ${INFO_PLIST}" >&2
  exit 2
fi

"${ROOT_DIR}/scripts/register-beat-document-type.sh" "${INFO_PLIST}"

if [[ -f "${EXECUTABLE}" ]]; then
  chmod +x "${EXECUTABLE}"
fi

if command -v codesign >/dev/null 2>&1; then
  codesign --force --deep --sign - "${APP_PATH}" >/dev/null
fi

if [[ -x "${LSREGISTER}" ]]; then
  "${LSREGISTER}" -f -R "${APP_PATH}"
else
  echo "LaunchServices registration tool not found: ${LSREGISTER}" >&2
  exit 2
fi

/usr/bin/env python3 "${ROOT_DIR}/scripts/set-beat-default-project-handler.py" "com.beat.app"

echo "${APP_PATH}"
