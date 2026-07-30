import assert from "node:assert/strict";
import { readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { build } from "../frontend/node_modules/esbuild/lib/main.js";

const repoRoot = join(import.meta.dirname, "..");
const read = (path) => readFileSync(join(repoRoot, path), "utf8");

const service = read("backend/Source/Audio/Analysis/AudioToMidiService.h");
const backendSchema = read("backend/Source/Ipc/Schema.h");
const frontendSchema = read("frontend/src/ipc/schema.ts");
const bridge = read("backend/Source/Ipc/MessageBridge.cpp");
const action = read("frontend/src/audio/audioToMidi.ts");
const mapping = read("frontend/src/audio/audioToMidiMapping.ts");
const segment = read("frontend/src/features/Tracks/Segment.solid.tsx");
const setup = read("scripts/setup-audio-to-midi.sh");

for (const kind of ["audio.transcriptionStart", "audio.transcriptionStatus", "audio.transcriptionCancel"])
  assert(frontendSchema.includes(kind), `frontend IPC is missing ${kind}`);
for (const symbol of ["AUDIO_TRANSCRIPTION_START", "AUDIO_TRANSCRIPTION_STATUS", "AUDIO_TRANSCRIPTION_CANCEL"])
  assert(backendSchema.includes(symbol), `backend IPC is missing ${symbol}`);

assert(service.includes("Spotify Basic Pitch"), "service must identify the integrated transcription provider");
assert(service.includes('arguments.add("--save-note-events")'), "service must request structured Basic Pitch note events");
assert(service.includes('arguments.add("coreml")'), "macOS transcription must use the bundled CoreML serialization");
assert(service.includes("juce::ChildProcess"), "transcription must run outside Beat's audio thread");
assert(service.includes("current->cancel.store"), "transcription job must be cancellable");
assert(bridge.includes('item->setProperty("pitchBends"'), "Basic Pitch bends must cross the native bridge");
assert(mapping.includes("secondsToBeats"), "note-event seconds must be converted using project tempo");
assert(action.includes("sourceStartBeat: source.sourceStartBeat"), "generated MIDI must preserve the stem trim offset");
assert(mapping.includes("pitchBendsToCurve"), "Basic Pitch bends must become Beat note curves");
assert(action.includes('kind: "midi"'), "transcription must create a native Beat MIDI segment");
assert(action.includes('candidate.name.toLowerCase() === "lead saw"'), "generated MIDI must bind Beat's audible default synth when available");
assert(segment.includes('label: "Convert Stem to MIDI…"'), "pitched stem context menu must expose transcription");
assert(setup.includes('basic-pitch==0.4.0'), "runtime setup must pin the reviewed Spotify release");
assert(setup.includes('"setuptools<81"'), "runtime setup must retain pkg_resources for Basic Pitch's resampy dependency");
for (const dependency of ['"coremltools==9.0"', '"numpy==2.4.6"', '"resampy==0.4.2"', '"scikit-learn==1.5.1"'])
  assert(setup.includes(dependency), `runtime setup must retain the smoke-tested dependency pin ${dependency}`);
assert((statSync(join(repoRoot, "scripts/setup-audio-to-midi.sh")).mode & 0o111) !== 0, "runtime setup script must be executable");

const behavioralCheck = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/audio"),
    sourcefile: "audio-to-midi-check.ts",
    loader: "ts",
    contents: `
      import assert from "node:assert/strict";
      import { basicPitchNotesToBeatNotes } from "./audioToMidiMapping.ts";
      const notes = basicPitchNotesToBeatNotes([
        { startSeconds: 1, endSeconds: 1.5, pitch: 60, velocity: 99, pitchBends: [0, 1, -1] },
      ], 120);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].startBeat, 2);
      assert.equal(notes[0].lengthBeats, 1);
      assert.equal(notes[0].velocity, 99);
      assert.deepEqual(notes[0].curve?.map((point) => [point.beat, point.pitch]), [[2, 60], [2.5, 60 + 1 / 3], [3, 60 - 1 / 3]]);
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const encodedCheck = Buffer.from(behavioralCheck.outputFiles[0].text).toString("base64");
await import(`data:text/javascript;base64,${encodedCheck}`);

console.log("Audio-to-MIDI verification passed: Basic Pitch runtime, IPC, timing, pitch bends, track creation, cancellation, and setup contracts are present.");
