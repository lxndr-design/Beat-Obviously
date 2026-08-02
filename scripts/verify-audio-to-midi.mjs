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
const pianoFusion = read("frontend/src/audio/pianoTranscriptionFusion.ts");
const loopDetection = read("frontend/src/audio/midiLoopDetection.ts");
const segment = read("frontend/src/features/Tracks/Segment.solid.tsx");
const setup = read("scripts/setup-audio-to-midi.sh");
const pianoSetup = read("scripts/setup-piano-transcription.sh");
const multiInstrumentSetup = read("scripts/setup-multi-instrument-transcription.sh");
const muscriptorEvaluation = read("scripts/evaluate-muscriptor-private.sh");

for (const kind of ["audio.transcriptionStart", "audio.transcriptionStatus", "audio.transcriptionCancel"])
  assert(frontendSchema.includes(kind), `frontend IPC is missing ${kind}`);
for (const symbol of ["AUDIO_TRANSCRIPTION_START", "AUDIO_TRANSCRIPTION_STATUS", "AUDIO_TRANSCRIPTION_CANCEL"])
  assert(backendSchema.includes(symbol), `backend IPC is missing ${symbol}`);

assert(service.includes("Spotify Basic Pitch"), "service must identify the integrated transcription provider");
assert(service.includes("Transkun"), "service must identify the piano transcription provider");
assert(service.includes('profile == "piano"'), "service must route piano audio to its dedicated provider");
assert(service.includes("readMidiNoteEvents"), "Transkun MIDI must become structured Beat note events");
assert(service.includes("readMuScriptorNoteEvents"), "MuScriptor events must retain instrument assignments");
assert(service.includes("inferVelocitiesFromSource"), "MuScriptor notes must recover velocity from source audio");
assert(service.includes('arguments.add("json")'), "MuScriptor must emit structured multi-instrument events");
assert(service.includes('arguments.add("--save-note-events")'), "service must request structured Basic Pitch note events");
assert(service.includes('arguments.add("coreml")'), "macOS transcription must use the bundled CoreML serialization");
for (const option of ["--onset-threshold", "--frame-threshold", "--minimum-note-length"])
  assert(service.includes(`arguments.add("${option}")`), `transcription recovery must configure ${option}`);
assert(service.includes("juce::ChildProcess"), "transcription must run outside Beat's audio thread");
assert(service.includes("current->cancel.store"), "transcription job must be cancellable");
assert(bridge.includes('item->setProperty("pitchBends"'), "Basic Pitch bends must cross the native bridge");
assert(mapping.includes("secondsToBeats"), "note-event seconds must be converted using project tempo");
assert(action.includes("sourceStartBeat: source.sourceStartBeat"), "generated MIDI must preserve the stem trim offset");
assert(mapping.includes("pitchBendsToCurve"), "Basic Pitch bends must become Beat note curves");
assert(pianoFusion.includes("samePitchIsRinging"), "piano recovery must reject same-pitch resonance inside an active interval");
assert(pianoFusion.includes("chordAligned"), "piano recovery must prefer candidates aligned to primary chord attacks");
assert(action.includes('kind: "midi"'), "transcription must create a native Beat MIDI segment");
assert(action.includes('runTranscriptionJob(segmentId, audioFile.path, "piano")'), "piano conversion must run Transkun first");
assert(action.includes('runTranscriptionJob(segmentId, audioFile.path, "piano-recovery")'), "piano conversion must run a Basic Pitch recovery vote");
assert(action.includes("compactFullyRepeatedMidi"), "transcribed MIDI must compact verified full-segment repetition");
assert(loopDetection.includes("minimumConfidence ?? 0.9"), "loop compaction must require a strong default match");
assert(loopDetection.includes("refuses partial or merely similar sections"), "loop detector must document its safe whole-segment boundary");
assert(action.includes('candidate.name.toLowerCase() === "lead saw"'), "generated MIDI must bind Beat's audible default synth when available");
assert(segment.includes('label: "Convert to MIDI…"'), "audio context menu must expose transcription choices");
assert(segment.includes('label: "Piano performance · Transkun"'), "audio context menu must expose the piano-specific path");
assert(segment.includes('label: "General / multi-instrument · MuScriptor"'), "audio context menu must expose general multi-instrument transcription");
assert(setup.includes('basic-pitch==0.4.0'), "runtime setup must pin the reviewed Spotify release");
assert(setup.includes('"setuptools<81"'), "runtime setup must retain pkg_resources for Basic Pitch's resampy dependency");
for (const dependency of ['"coremltools==9.0"', '"numpy==2.4.6"', '"resampy==0.4.2"', '"scikit-learn==1.5.1"'])
  assert(setup.includes(dependency), `runtime setup must retain the smoke-tested dependency pin ${dependency}`);
assert((statSync(join(repoRoot, "scripts/setup-audio-to-midi.sh")).mode & 0o111) !== 0, "runtime setup script must be executable");
assert(pianoSetup.includes('"transkun==2.0.1"'), "piano setup must pin the reviewed Transkun release");
assert(pianoSetup.includes('"torch==2.13.0"'), "piano setup must pin the smoke-tested Torch runtime");
assert((statSync(join(repoRoot, "scripts/setup-piano-transcription.sh")).mode & 0o111) !== 0, "piano runtime setup script must be executable");
assert(multiInstrumentSetup.includes('"muscriptor==0.2.2"'), "multi-instrument setup must pin the reviewed MuScriptor release");
assert(multiInstrumentSetup.includes("CC BY-NC 4.0"), "multi-instrument setup must disclose the model-weight license");
assert((statSync(join(repoRoot, "scripts/setup-multi-instrument-transcription.sh")).mode & 0o111) !== 0, "multi-instrument runtime setup script must be executable");
assert(muscriptorEvaluation.includes("CC BY-NC 4.0"), "MuScriptor evaluation must disclose its non-commercial weights");
assert(muscriptorEvaluation.includes("Audio remains local"), "MuScriptor evaluation must preserve the local-only boundary");
assert(muscriptorEvaluation.includes("--prelude-forcing"), "MuScriptor evaluation must preserve sounding notes across chunks");
assert((statSync(join(repoRoot, "scripts/evaluate-muscriptor-private.sh")).mode & 0o111) !== 0, "private MuScriptor evaluation script must be executable");

const behavioralCheck = await build({
  stdin: {
    resolveDir: join(repoRoot, "frontend/src/audio"),
    sourcefile: "audio-to-midi-check.ts",
    loader: "ts",
    contents: `
      import assert from "node:assert/strict";
      import { basicPitchNotesToBeatNotes } from "./audioToMidiMapping.ts";
      import { compactFullyRepeatedMidi } from "./midiLoopDetection.ts";
      import { fusePianoTranscriptions } from "./pianoTranscriptionFusion.ts";
      const notes = basicPitchNotesToBeatNotes([
        { startSeconds: 1, endSeconds: 1.5, pitch: 60, velocity: 99, pitchBends: [0, 1, -1] },
      ], 120);
      assert.equal(notes.length, 1);
      assert.equal(notes[0].startBeat, 2);
      assert.equal(notes[0].lengthBeats, 1);
      assert.equal(notes[0].velocity, 99);
      assert.deepEqual(notes[0].curve?.map((point) => [point.beat, point.pitch]), [[2, 60], [2.5, 60 + 1 / 3], [3, 60 - 1 / 3]]);

      const repeated = Array.from({ length: 4 }, (_, cycle) => [
        { pitch: 60, velocity: 92 - cycle, startBeat: cycle * 2, lengthBeats: 0.48 },
        { pitch: 64, velocity: 84 + cycle, startBeat: cycle * 2 + 1, lengthBeats: 0.48 },
      ]).flat();
      const compacted = compactFullyRepeatedMidi(repeated, 8);
      assert.ok(compacted);
      assert.equal(compacted.lengthBeats, 2);
      assert.equal(compacted.repeats, 3);
      assert.equal(compacted.notes.length, 2);

      const changedEnding = repeated.map((note, index) => index === repeated.length - 1 ? { ...note, pitch: 67 } : note);
      assert.equal(compactFullyRepeatedMidi(changedEnding, 8), null);

      const pianoFusion = fusePianoTranscriptions(
        [{ startSeconds: 0, endSeconds: 2, pitch: 60, velocity: 88, pitchBends: [] }],
        [
          { startSeconds: 0.6, endSeconds: 1.2, pitch: 60, velocity: 96, pitchBends: [] },
          { startSeconds: 0.03, endSeconds: 0.8, pitch: 64, velocity: 62, pitchBends: [] },
          { startSeconds: 3, endSeconds: 3.3, pitch: 67, velocity: 60, pitchBends: [] },
          { startSeconds: 4, endSeconds: 4.3, pitch: 69, velocity: 100, pitchBends: [] },
        ],
      );
      assert.equal(pianoFusion.primaryCount, 1);
      assert.equal(pianoFusion.recoveredCount, 2);
      assert.deepEqual(pianoFusion.notes.map((note) => note.pitch), [60, 64, 69]);
    `,
  },
  bundle: true,
  platform: "node",
  format: "esm",
  write: false,
});
const encodedCheck = Buffer.from(behavioralCheck.outputFiles[0].text).toString("base64");
await import(`data:text/javascript;base64,${encodedCheck}`);

console.log("Audio-to-MIDI verification passed: Transkun piano primary, conservative Basic Pitch recovery, MuScriptor multi-instrument lanes with source dynamics, general stem fallback, timing, cancellation, and setup contracts are present.");
