#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
VENV_DIR="${REPO_DIR}/.venv-stems"
MODEL_CACHE="${BEAT_STEM_MODEL_CACHE:-${HOME}/Library/Application Support/Beat/Stem Models}"

find_python() {
  for candidate in \
    "${BEAT_STEM_PYTHON:-}" \
    /opt/homebrew/bin/python3.13 \
    /usr/local/bin/python3.13 \
    python3.13 \
    python3.12 \
    python3.11
  do
    if [ -n "${candidate}" ] && command -v "${candidate}" >/dev/null 2>&1; then
      "${candidate}" -c 'import sys; raise SystemExit(0 if (3, 11) <= sys.version_info[:2] <= (3, 13) else 1)' \
        && printf '%s\n' "${candidate}" \
        && return 0
    fi
  done
  return 1
}

PYTHON=$(find_python || true)
if [ -z "${PYTHON}" ]; then
  echo "Beat stem separation requires Python 3.11, 3.12, or 3.13."
  echo "On macOS with Homebrew: brew install python@3.13"
  exit 1
fi

if [ ! -x "${VENV_DIR}/bin/python" ]; then
  "${PYTHON}" -m venv "${VENV_DIR}"
fi

"${VENV_DIR}/bin/python" -m pip install --upgrade pip
"${VENV_DIR}/bin/python" -m pip install "demucs-onnx==0.3.4"
"${VENV_DIR}/bin/demucs-onnx" list-models >/dev/null
"${VENV_DIR}/bin/demucs-onnx" prewarm \
  --models htdemucs \
  --precision fp16weights \
  --providers cpu \
  --cache-dir "${MODEL_CACHE}"

echo "Beat stem separation runtime is ready at ${VENV_DIR}/bin/demucs-onnx"
echo "The 166 MB htdemucs model is cached at ${MODEL_CACHE}."
echo "Once setup completes, separation runs without network access."
echo "Beat uses the CPU execution provider for deterministic macOS compatibility."
