#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-muscriptor"
LOCK_FILE="${REPO_DIR}/scripts/requirements/multi-instrument-transcription-macos-py311.lock"

find_python() {
  for candidate in \
    "${BEAT_MULTI_INSTRUMENT_TRANSCRIPTION_PYTHON:-}" \
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
  echo "Beat multi-instrument transcription requires Python 3.11 for its reproducible runtime lock."
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
"${VENV_DIR}/bin/muscriptor" list-instruments >/dev/null
"${VENV_DIR}/bin/python" -c 'import importlib.metadata as metadata, torch; assert metadata.version("muscriptor") == "0.2.2"; assert torch.__version__.startswith("2.13.")'

echo "Beat multi-instrument transcription is ready at ${VENV_DIR}/bin/muscriptor"
echo "MuScriptor weights are CC BY-NC 4.0 and require Hugging Face model-license acceptance."
echo "Authenticate locally with: ${VENV_DIR}/bin/hf auth login"
