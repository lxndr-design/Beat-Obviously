#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-homr"
LOCK_FILE="${REPO_DIR}/scripts/requirements/score-recognition-macos-py311.lock"

find_python() {
  for candidate in \
    "${BEAT_SCORE_RECOGNITION_PYTHON:-}" \
    /opt/homebrew/bin/python3.11 \
    /usr/local/bin/python3.11 \
    python3.11
  do
    if [ -n "${candidate}" ] && command -v "${candidate}" >/dev/null 2>&1; then
      "${candidate}" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)' \
        && printf '%s\n' "${candidate}" \
        && return 0
    fi
  done
  return 1
}

PYTHON=$(find_python || true)
if [ -z "${PYTHON}" ]; then
  echo "Beat score recognition requires Python 3.11 for its reproducible runtime lock."
  echo "On macOS with Homebrew: brew install python@3.11"
  exit 1
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON}" -m venv "${VENV_DIR}"
fi
if ! "${VENV_DIR}/bin/python" -c 'import sys; raise SystemExit(0 if sys.version_info[:2] == (3, 11) else 1)'; then
  echo "Existing ${VENV_DIR} does not use Python 3.11; move it aside and run setup again."
  exit 1
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade "pip==26.2"
"${VENV_DIR}/bin/python" -m pip install --upgrade --requirement "${LOCK_FILE}"
"${VENV_DIR}/bin/python" -m pip check
"${VENV_DIR}/bin/python" -c 'import cv2, importlib.metadata as metadata; assert cv2.__version__ == "4.14.0"; assert metadata.version("homr") == "0.7.0"'
"${VENV_DIR}/bin/homr" --help >/dev/null

echo "Beat homr score recognition is ready at ${VENV_DIR}/bin/homr"
echo "OpenCV full and headless distributions are aligned on the supported 4.14 build."
