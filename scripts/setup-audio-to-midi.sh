#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-transcription"

find_python() {
  for candidate in \
    "${BEAT_TRANSCRIPTION_PYTHON:-}" \
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
  echo "Beat audio-to-MIDI requires Python 3.10 or 3.11."
  echo "On macOS with Homebrew: brew install python@3.11"
  exit 1
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install "setuptools<81"
"${VENV_DIR}/bin/python" -m pip install \
  "basic-pitch==0.4.0" \
  "coremltools==9.0" \
  "numpy==2.4.6" \
  "resampy==0.4.2" \
  "scikit-learn==1.5.1"
"${VENV_DIR}/bin/basic-pitch" --help >/dev/null
"${VENV_DIR}/bin/python" -c 'from basic_pitch import ICASSP_2022_MODEL_PATH; from basic_pitch.inference import Model; Model(ICASSP_2022_MODEL_PATH)'

echo "Beat audio-to-MIDI is ready at ${VENV_DIR}/bin/basic-pitch"
echo "Spotify Basic Pitch and its CoreML model now run locally without network access."
