#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")"
APP_PATH="${ROOT_DIR}/Beat.app"
RELEASE_DIR="${ROOT_DIR}/release"
ARCHIVE_PATH="${RELEASE_DIR}/Beat-${VERSION}-macOS-arm64.zip"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"

"${ROOT_DIR}/scripts/package-macos.sh"
node "${ROOT_DIR}/scripts/verify-beta-package.mjs" "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

mkdir -p "${RELEASE_DIR}"
rm -f "${ARCHIVE_PATH}" "${CHECKSUM_PATH}"
ditto -c -k --sequesterRsrc --keepParent "${APP_PATH}" "${ARCHIVE_PATH}"

VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/beat-beta-archive.XXXXXX")"
cleanup() {
  rm -rf "${VERIFY_DIR}"
}
trap cleanup EXIT

ditto -x -k "${ARCHIVE_PATH}" "${VERIFY_DIR}"
EXTRACTED_APP="${VERIFY_DIR}/Beat.app"
node "${ROOT_DIR}/scripts/verify-beta-package.mjs" "${EXTRACTED_APP}"
codesign --verify --deep --strict --verbose=2 "${EXTRACTED_APP}"

shasum -a 256 "${ARCHIVE_PATH}" > "${CHECKSUM_PATH}"
echo "${ARCHIVE_PATH}"
echo "${CHECKSUM_PATH}"
