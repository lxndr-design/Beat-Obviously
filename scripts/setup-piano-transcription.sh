#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-transkun"

find_python() {
  for candidate in \
    "${BEAT_PIANO_TRANSCRIPTION_PYTHON:-}" \
    /opt/homebrew/bin/python3.11 \
    /usr/local/bin/python3.11 \
    python3.11 \
    /opt/homebrew/bin/python3.10 \
    /usr/local/bin/python3.10 \
    python3.10
  do
    if [ -n "${candidate}" ] && command -v "${candidate}" >/dev/null 2>&1; then
      "${candidate}" -c 'import sys; raise SystemExit(0 if (3, 10) <= sys.version_info[:2] <= (3, 11) else 1)' \
        && printf '%s\n' "${candidate}" \
        && return 0
    fi
  done
  return 1
}

PYTHON=$(find_python || true)
if [ -z "${PYTHON}" ]; then
  echo "Beat piano transcription requires Python 3.10 or 3.11."
  echo "On macOS with Homebrew: brew install python@3.11"
  exit 1
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install "setuptools<81"
"${VENV_DIR}/bin/python" -m pip install \
  "torch==2.13.0" \
  "torchaudio==2.11.0" \
  "transkun==2.0.1"
"${VENV_DIR}/bin/transkun" --help >/dev/null
"${VENV_DIR}/bin/python" -c 'import pretty_midi, torch, transkun; assert torch.__version__.startswith("2.13.")'

echo "Beat piano transcription is ready at ${VENV_DIR}/bin/transkun"
echo "Transkun 2.0.1 runs locally; its V2 no-pedal-extension checkpoint is included in the installed wheel."
