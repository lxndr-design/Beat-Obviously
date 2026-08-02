#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-muscriptor"

find_python() {
  for candidate in \
    "${BEAT_MULTI_INSTRUMENT_TRANSCRIPTION_PYTHON:-}" \
    /opt/homebrew/bin/python3.11 \
    /usr/local/bin/python3.11 \
    python3.11 \
    /opt/homebrew/bin/python3.12 \
    /usr/local/bin/python3.12 \
    python3.12 \
    /opt/homebrew/bin/python3.10 \
    /usr/local/bin/python3.10 \
    python3.10
  do
    if [ -n "${candidate}" ] && command -v "${candidate}" >/dev/null 2>&1; then
      "${candidate}" -c 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 12) else 1)' \
        && printf '%s\n' "${candidate}" \
        && return 0
    fi
  done
  return 1
}

PYTHON=$(find_python || true)
if [ -z "${PYTHON}" ]; then
  echo "Beat multi-instrument transcription requires Python 3.10-3.12."
  echo "On macOS with Homebrew: brew install python@3.11"
  exit 1
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install \
  "torch==2.13.0" \
  "muscriptor==0.2.2"
"${VENV_DIR}/bin/muscriptor" list-instruments >/dev/null
"${VENV_DIR}/bin/python" -c 'import importlib.metadata as metadata, torch; assert metadata.version("muscriptor") == "0.2.2"; assert torch.__version__.startswith("2.13.")'

echo "Beat multi-instrument transcription is ready at ${VENV_DIR}/bin/muscriptor"
echo "MuScriptor weights are CC BY-NC 4.0 and require Hugging Face model-license acceptance."
echo "Authenticate locally with: ${VENV_DIR}/bin/hf auth login"
