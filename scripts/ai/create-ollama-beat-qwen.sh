#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRAIN_DIR="$ROOT_DIR/training/beat-qwen"
MODELFILE="$TRAIN_DIR/Modelfile"

if ! command -v ollama >/dev/null 2>&1; then
  echo "Missing ollama. Install it with: brew install ollama"
  exit 1
fi

if [[ ! -d "$TRAIN_DIR/output" ]]; then
  echo "Missing trained adapter directory: $TRAIN_DIR/output"
  echo "Run ./scripts/ai/train-beat-qwen.sh first."
  exit 1
fi

cd "$TRAIN_DIR"
ollama create beat-qwen:latest -f "$MODELFILE"
echo "Created Ollama model: beat-qwen:latest"
echo "Open Beat Preferences and set Ollama model to beat-qwen:latest."
