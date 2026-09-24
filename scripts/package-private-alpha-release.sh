#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
VERSION="$(tr -d '[:space:]' < "${ROOT_DIR}/VERSION")"
RELEASE_DIR="${BEAT_ALPHA_RELEASE_DIR:-${ROOT_DIR}/release/private-alpha}"
APP_PATH="${RELEASE_DIR}/Beat.app"
ARCHIVE_PATH="${RELEASE_DIR}/Beat-${VERSION}-private-alpha-macOS-arm64.zip"
CHECKSUM_PATH="${ARCHIVE_PATH}.sha256"
BUILD_DIR="${BEAT_BUILD_DIR:-${TMPDIR:-/tmp}/beat-private-alpha-build}"

mkdir -p "${RELEASE_DIR}"

BEAT_BUILD_DIR="${BUILD_DIR}" \
BEAT_APP_OUTPUT_PATH="${APP_PATH}" \
BEAT_MACOS_DEPLOYMENT_TARGET="${BEAT_MACOS_DEPLOYMENT_TARGET:-13.0}" \
VITE_BEAT_INCLUDE_INTERNAL_TEST_BANKS=false \
  "${ROOT_DIR}/scripts/package-macos.sh"

xattr -cr "${APP_PATH}"
codesign --force --deep --sign - "${APP_PATH}"
node "${ROOT_DIR}/scripts/verify-private-alpha-package.mjs" "${APP_PATH}"
codesign --verify --deep --strict --verbose=2 "${APP_PATH}"

rm -f "${ARCHIVE_PATH}" "${CHECKSUM_PATH}"
COPYFILE_DISABLE=1 ditto --norsrc -c -k --keepParent "${APP_PATH}" "${ARCHIVE_PATH}"

VERIFY_DIR="$(mktemp -d "${TMPDIR:-/tmp}/beat-private-alpha-archive.XXXXXX")"
cleanup() {
  rm -rf "${VERIFY_DIR}"
}
trap cleanup EXIT

ditto -x -k "${ARCHIVE_PATH}" "${VERIFY_DIR}"
EXTRACTED_APP="${VERIFY_DIR}/Beat.app"
node "${ROOT_DIR}/scripts/verify-private-alpha-package.mjs" "${EXTRACTED_APP}"
codesign --verify --deep --strict --verbose=2 "${EXTRACTED_APP}"

(
  cd "${RELEASE_DIR}"
  shasum -a 256 "$(basename "${ARCHIVE_PATH}")" > "$(basename "${CHECKSUM_PATH}")"
)

echo "${APP_PATH}"
echo "${ARCHIVE_PATH}"
echo "${CHECKSUM_PATH}"
