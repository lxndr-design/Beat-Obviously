#!/bin/sh

set -eu

SCRIPT_DIR=$(CDPATH= cd -- "$(dirname -- "$0")" && pwd)
REPO_DIR=$(CDPATH= cd -- "${SCRIPT_DIR}/.." && pwd)
RUNNER="${REPO_DIR}/.venv-muscriptor/bin/muscriptor"

usage() {
  echo "Usage: scripts/evaluate-muscriptor-private.sh AUDIO [OUTPUT.mid] [small|medium|large] [INSTRUMENTS]"
  echo "Example: scripts/evaluate-muscriptor-private.sh song.mp3 out.mid small acoustic_piano"
}

if [ "$#" -lt 1 ] || [ "$#" -gt 4 ]; then
  usage
  exit 1
fi

AUDIO=$1
MODEL=${3:-small}
INSTRUMENTS=${4:-}

if [ ! -f "${AUDIO}" ]; then
  echo "Audio file not found: ${AUDIO}"
  exit 1
fi

if [ ! -x "${RUNNER}" ]; then
  echo "MuScriptor is not installed in Beat's private evaluation environment."
  echo "Create .venv-muscriptor with Python 3.10-3.12, then install muscriptor==0.2.2."
  exit 1
fi

case "${MODEL}" in
  small|medium|large)
    TOKEN_AVAILABLE=false
    if [ -n "${HF_TOKEN:-}" ]; then
      TOKEN_AVAILABLE=true
    fi
    if [ -n "${HF_HOME:-}" ] && [ -f "${HF_HOME}/token" ]; then
      TOKEN_AVAILABLE=true
    fi
    if [ -n "${XDG_CACHE_HOME:-}" ] && [ -f "${XDG_CACHE_HOME}/huggingface/token" ]; then
      TOKEN_AVAILABLE=true
    fi
    if [ -n "${HOME:-}" ] && [ -f "${HOME}/.cache/huggingface/token" ]; then
      TOKEN_AVAILABLE=true
    fi
    if [ "${TOKEN_AVAILABLE}" != true ]; then
      echo "MuScriptor's ${MODEL} weights require Hugging Face license acceptance and local authentication."
      echo "1. Accept the CC BY-NC 4.0 model license: https://huggingface.co/muscriptor/muscriptor-${MODEL}"
      echo "2. Run: ${REPO_DIR}/.venv-muscriptor/bin/hf auth login"
      echo "3. Re-run this command. Audio remains local; only model weights are downloaded."
      exit 2
    fi
    ;;
  *)
    if [ ! -f "${MODEL}" ]; then
      echo "Model must be small, medium, large, or a local weights file."
      exit 1
    fi
    ;;
esac

if [ "$#" -ge 2 ]; then
  OUTPUT=$2
else
  SOURCE_NAME=$(basename -- "${AUDIO}")
  SOURCE_STEM=${SOURCE_NAME%.*}
  OUTPUT="${REPO_DIR}/generated-tests/mp3-translations/work/muscriptor-private/${SOURCE_STEM}-${MODEL}.mid"
fi

mkdir -p "$(dirname -- "${OUTPUT}")"

set -- "${RUNNER}" transcribe "${AUDIO}" \
  --output "${OUTPUT}" \
  --format midi \
  --model "${MODEL}" \
  --device auto \
  --beam-size 1 \
  --prelude-forcing

if [ -n "${INSTRUMENTS}" ]; then
  set -- "$@" --instruments "${INSTRUMENTS}"
fi

echo "Running a local-only MuScriptor ${MODEL} evaluation..."
"$@"
echo "Private MuScriptor result: ${OUTPUT}"
