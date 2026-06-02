# Beat Qwen Fine-Tuning

This folder is the local training workspace for turning Beat's collected generation feedback and saved musical material into small Qwen adapters.

For drums, the app collects:

- the generation prompt/context
- the base model output
- thumbs up/down
- the final edited beat when you save the editor
- a stronger positive signal when you save a generated drum segment as a Component

Beat now writes the matching JSONL file and starts the native training script automatically every 20 new rated/accepted signals when running as the standalone app. You can also force a run from **Preferences -> Training Checkpoints -> Run now**.

If you want to run training manually, export the dataset from **Preferences -> Training Data -> Export JSONL** or let the app write it, then use:

```bash
training/beat-qwen/beat-drum-finetune.jsonl
```

For instruments, export **Export instruments** and save it as:

```bash
training/beat-qwen/beat-instrument-finetune.jsonl
```

For MIDI/song generation, export **Export MIDI** and save it as:

```bash
training/beat-qwen/beat-midi-song-finetune.jsonl
```

The MIDI dataset is useful before a full song-generator UI exists: it is built from saved MIDI components, saved projects, and future MIDI feedback records. Parts are labeled as melody, bass, chords, countermelody, arp, or fx from track/instrument context and pitch structure.

## Recommended Path

Use LoRA/QLoRA rather than full fine-tuning. You are training a small adapter on top of Qwen, not retraining the whole model.

The included config targets LLaMA-Factory because it is a common local fine-tuning tool for Qwen-style models.

Basic flow:

```bash
cd /Users/alexcheng/beat
./scripts/ai/train-beat-qwen.sh
```

Train MIDI/song generation:

```bash
./scripts/ai/train-beat-midi-qwen.sh
```

Train instrument generation:

```bash
./scripts/ai/train-beat-instrument-qwen.sh
```

After training, export/register the tuned model with Ollama as something like:

```bash
./scripts/ai/create-ollama-beat-qwen.sh
```

For MIDI/song generation:

```bash
./scripts/ai/create-ollama-beat-midi-qwen.sh
```

Then open Beat Preferences and set **Ollama model** to:

```txt
beat-qwen:latest
```

## Notes

The app only starts the local runner at checkpoints. The heavy work still happens in the external LLaMA-Factory process so logs, dependencies, and failures remain inspectable.

Ollama's `Modelfile` supports attaching an adapter with `ADAPTER ./output`; keep the base `FROM` aligned with the base model used by the training config.
