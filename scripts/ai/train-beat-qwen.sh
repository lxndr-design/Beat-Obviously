#!/usr/bin/env bash
set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TRAIN_DIR="$ROOT_DIR/training/beat-qwen"
DATASET="$TRAIN_DIR/beat-drum-finetune.jsonl"
CONFIG="$TRAIN_DIR/llamafactory-qwen3-lora.yaml"

if [[ ! -f "$DATASET" ]]; then
  echo "Missing dataset: $DATASET"
  echo "Export it from Beat Preferences -> Training Data -> Export JSONL."
  exit 1
fi

if ! command -v llamafactory-cli >/dev/null 2>&1; then
  echo "Missing llamafactory-cli."
  echo "Install LLaMA-Factory in a Python environment, then rerun this script."
  echo "Example:"
  echo "  python3 -m venv .venv-training"
  echo "  source .venv-training/bin/activate"
  echo "  pip install -U \"llamafactory[torch]\""
  exit 1
fi

DATA_INFO="$TRAIN_DIR/dataset_info.json"
cat > "$DATA_INFO" <<JSON
{
  "beat_drum_finetune": {
    "file_name": "beat-drum-finetune.jsonl",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  },
  "beat_instrument_finetune": {
    "file_name": "beat-instrument-finetune.jsonl",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  },
  "beat_midi_song_finetune": {
    "file_name": "beat-midi-song-finetune.jsonl",
    "columns": {
      "prompt": "instruction",
      "query": "input",
      "response": "output"
    }
  }
}
JSON

cd "$TRAIN_DIR"
llamafactory-cli train "$CONFIG"
