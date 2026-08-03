#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-transkun"
LOCK_FILE="${REPO_DIR}/scripts/requirements/piano-transcription-macos-py311.lock"

find_python() {
  for candidate in \
    "${BEAT_PIANO_TRANSCRIPTION_PYTHON:-}" \
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
  echo "Beat piano transcription requires Python 3.11 for its reproducible runtime lock."
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

"${VENV_DIR}/bin/python" -m pip install --upgrade "pip==26.2" "setuptools==80.10.2"
"${VENV_DIR}/bin/python" -m pip install --upgrade --requirement "${LOCK_FILE}"
"${VENV_DIR}/bin/python" -m pip check
"${VENV_DIR}/bin/transkun" --help >/dev/null
"${VENV_DIR}/bin/python" -c 'import pretty_midi, torch, transkun; assert torch.__version__.startswith("2.13.")'

echo "Beat piano transcription is ready at ${VENV_DIR}/bin/transkun"
echo "Transkun 2.0.1 runs locally; its V2 no-pedal-extension checkpoint is included in the installed wheel."
