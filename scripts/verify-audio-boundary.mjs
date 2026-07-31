#!/usr/bin/env node
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const repoRoot = new URL("..", import.meta.url).pathname;
const frontendSrc = join(repoRoot, "frontend", "src");
const failures = [];

function fail(message) {
  failures.push(message);
}

function rel(path) {
  return relative(repoRoot, path);
}

function read(path) {
  return readFileSync(path, "utf8");
}

function walk(dir, predicate = () => true) {
  const out = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      out.push(...walk(full, predicate));
    } else if (predicate(full)) {
      out.push(full);
    }
  }
  return out;
}

function lineEntries(source) {
  return source.split(/\r?\n/).map((line, index) => ({ line, lineNumber: index + 1 }));
}

const appPath = join(frontendSrc, "App.solid.tsx");
const timelinePath = join(frontendSrc, "audio", "TimelineMidiPlayback.solid.tsx");
const liveMidiExpressionInputPath = join(frontendSrc, "audio", "LiveMidiExpressionInput.solid.tsx");
const liveMidiExpressionPath = join(frontendSrc, "audio", "liveMidiExpression.ts");
const transportActionsPath = join(frontendSrc, "audio", "transportActions.ts");
const globalAudioSafetyPath = join(frontendSrc, "audio", "globalAudioSafety.ts");
const wavemapResynthesisPath = join(frontendSrc, "audio", "wavemapResynthesis.ts");
const audioRecordingModalPath = join(frontendSrc, "features", "Tracks", "AudioRecordingModal.solid.tsx");
const audioFilesPagePath = join(frontendSrc, "features", "HomeHub", "AudioFilesPage.solid.tsx");
const audioSegmentTransportPath = join(frontendSrc, "features", "SegmentEditor", "AudioSegmentTransport.solid.tsx");
const schemaPath = join(frontendSrc, "ipc", "schema.ts");
const bridgePath = join(frontendSrc, "ipc", "bridge.ts");
const backendSchemaPath = join(repoRoot, "backend", "Source", "Ipc", "Schema.h");
const messageBridgePath = join(repoRoot, "backend", "Source", "Ipc", "MessageBridge.cpp");
const backendCmakePath = join(repoRoot, "backend", "CMakeLists.txt");
const audioEngineHeaderPath = join(repoRoot, "backend", "Source", "Audio", "AudioEngine.h");
const audioEnginePath = join(repoRoot, "backend", "Source", "Audio", "AudioEngine.cpp");

for (const requiredPath of [
  appPath,
  timelinePath,
  liveMidiExpressionInputPath,
  liveMidiExpressionPath,
  transportActionsPath,
  globalAudioSafetyPath,
  wavemapResynthesisPath,
  audioRecordingModalPath,
  audioFilesPagePath,
  audioSegmentTransportPath,
  schemaPath,
  bridgePath,
  backendSchemaPath,
  messageBridgePath,
  backendCmakePath,
  audioEngineHeaderPath,
  audioEnginePath,
]) {
  if (!existsSync(requiredPath)) fail(`Missing audio boundary file: ${rel(requiredPath)}`);
}

if (existsSync(globalAudioSafetyPath) && existsSync(transportActionsPath)) {
  const safetySource = read(globalAudioSafetyPath);
  const transportSource = read(transportActionsPath);
  if (!safetySource.includes("registerGlobalAudioStop") || !safetySource.includes("stopAllBrowserAudio")) {
    fail("Browser preview owners must have a shared global audio-stop registry.");
  }
  const stopCallCount = (transportSource.match(/stopAllBrowserAudio\(\)/g) ?? []).length;
  if (stopCallCount < 2) {
    fail("Pause and Stop must both cancel every registered browser playback owner.");
  }
}

if (existsSync(audioEngineHeaderPath)) {
  const source = read(audioEngineHeaderPath);
  if (!source.includes("private juce::MidiInputCallback")
      || !source.includes("SynthExpressionActivity")
      || !source.includes("injectMidiInputForTesting")) {
    fail("AudioEngine must expose native MIDI expression activity and a test injection hook.");
  }
}

if (existsSync(audioEnginePath)) {
  const source = read(audioEnginePath);
  if (!source.includes("addMidiInputDeviceCallback")
      || !source.includes("handleIncomingMidiMessage")
      || !source.includes("handleMidiExpressionMessage")
      || !source.includes("onSynthExpressionActivity")) {
    fail("AudioEngine must register native MIDI input callbacks and publish synth expression activity.");
  }
}

if (existsSync(appPath)) {
  const source = read(appPath);
  if (!source.includes('import { LiveMidiExpressionInput } from "./audio/LiveMidiExpressionInput.solid";')) {
    fail("App must import the live MIDI expression input bridge.");
  }
  if (!source.includes("<LiveMidiExpressionInput />")) {
    fail("App must mount the live MIDI expression input bridge next to timeline playback.");
  }
  if (!source.includes('case "synth.expressionActivity"')
      || !source.includes("setInstrumentExpressionActivity(event.instrumentId")
      || !source.includes("clearInstrumentExpressionActivity(event.instrumentId")) {
    fail("App must route native synth.expressionActivity events into the synth expression store.");
  }
}

if (existsSync(timelinePath)) {
  const source = read(timelinePath);
  if (!source.includes('import { isNative } from "../ipc/bridge";')) {
    fail("Timeline MIDI browser fallback must import isNative.");
  }
  if (!/export function TimelineMidiPlayback\(\)\s*\{\s*if \(isNative\(\)\) return null;/.test(source)) {
    fail("Timeline MIDI browser fallback must be disabled immediately in native mode.");
  }
}

if (existsSync(liveMidiExpressionInputPath)) {
  const source = read(liveMidiExpressionInputPath);
  if (!source.includes('import { isNative } from "../ipc/bridge";')) {
    fail("Live MIDI expression input must import isNative.");
  }
  if (!/export function LiveMidiExpressionInput\(\)\s*\{\s*if \(isNative\(\)\) return null;/.test(source)) {
    fail("Live MIDI expression input must be disabled immediately in native mode.");
  }
  if (!source.includes("requestMIDIAccess")) {
    fail("Live MIDI expression input must use the browser Web MIDI bridge.");
  }
  if (!source.includes('source: "midi"')) {
    fail("Live MIDI expression input must publish synth expression activity as MIDI source.");
  }
}

if (existsSync(liveMidiExpressionPath)) {
  const source = read(liveMidiExpressionPath);
  if (!source.includes("parseLiveMidiExpressionMessage")) {
    fail("Live MIDI expression parser must stay testable outside the Solid component.");
  }
  if (!source.includes("createLiveMidiExpressionTracker")) {
    fail("Live MIDI expression tracker must stay testable outside the Solid component.");
  }
}

if (existsSync(transportActionsPath)) {
  const source = read(transportActionsPath);
  if (!source.includes("isNative")) {
    fail("Transport actions must guard browser audio priming with isNative.");
  }
  if (!/if \(!isNative\(\)\) primeTimelineAudio\(\);/.test(source)) {
    fail("Transport play/restart must not prime WebAudio when native transport is active.");
  }
}

if (existsSync(wavemapResynthesisPath)) {
  const source = read(wavemapResynthesisPath);
  if (!source.includes('import { isNative, send } from "../ipc/bridge";')) {
    fail("Wavemap resynthesis must import native IPC helpers.");
  }
  if (!source.includes('kind: "instrument.resynthesizeWavemap"')) {
    fail("Wavemap resynthesis must prefer native instrument.resynthesizeWavemap when available.");
  }
  if (!/if \(isNative\(\) && audioFile\.path && !audioFile\.path\.startsWith\("data:"\)\)/.test(source)) {
    fail("Wavemap resynthesis WebAudio decode must remain behind the native-file IPC guard.");
  }
}

if (existsSync(audioRecordingModalPath)) {
  const source = read(audioRecordingModalPath);
  const backendSource = read(messageBridgePath);
  if (!source.includes('import { isNative, send } from "../../ipc/bridge";')) {
    fail("Track audio recorder must import the native bridge and retain browser capability detection.");
  }
  if (!["recording.plan", "recording.prepare", "recording.start", "recording.stop", "recording.commitTake"]
    .every((kind) => source.includes(`kind: "${kind}"`))
      || !source.includes("navigator.mediaDevices.getUserMedia")) {
    fail("Track audio recorder must use native capture in the app while retaining the browser MediaRecorder fallback.");
  }
  if (!backendSource.includes("uniqueAudioLibraryFile")
      || !backendSource.includes("commitRecordedCapture(project, engine.inputRecordingCapture(), outputFile")
      || !backendSource.includes('response->setProperty("path", outputFile.getFullPathName())')) {
    fail("Native recorded takes without an explicit path must commit into Beat's managed audio library.");
  }
  if (!source.includes("No input audio was captured.")
      || !source.includes('role="alert"')
      || !backendSource.includes('diagnostics::log("recording", "stop samples="')
      || !backendSource.includes('diagnostics::log("recording", "commit ready samples="')) {
    fail("Native Live Record must expose zero-sample failures and log capture/commit diagnostics.");
  }
}

if (existsSync(backendCmakePath)) {
  const source = read(backendCmakePath);
  if (!source.includes("MICROPHONE_PERMISSION_ENABLED TRUE")
      || !source.includes("MICROPHONE_PERMISSION_TEXT")) {
    fail("The native app bundle must declare macOS microphone permission for Live Record.");
  }
}

if (existsSync(audioFilesPagePath)) {
  const source = read(audioFilesPagePath);
  if (!source.includes('kind: "audio.previewData"')
      || !source.includes("nativeAudioFilePath(file.path)")
      || !source.includes("nativeResponse.audioDataUrl")) {
    fail("Audio Files native preview must request trusted preview data instead of fetching local file URLs in the web view.");
  }
}

if (existsSync(audioSegmentTransportPath)) {
  const source = read(audioSegmentTransportPath);
  if (!source.includes('kind: "engine.previewAudioSegment"')
      || !source.includes('kind: "engine.stopAudioPreview"')
      || !/if \(isNative\(\)\) \{[\s\S]*?return;\s*\}\s*\n\s*try \{\s*await startBrowserPreview/.test(source)) {
    fail("Audio segment preview must use the project engine in native mode and isolate WebAudio to the browser fallback.");
  }
}

if (existsSync(appPath)) {
  const source = read(appPath);
  if (!/if \(!isNative\(\)\)\s*\{\s*const ctx = getTimelineAudioContext\(\);/.test(source)) {
    fail("App startup sample preloading must not create a WebAudio timeline context in native mode.");
  }
}

if (existsSync(schemaPath)) {
  const source = read(schemaPath);
  if (!source.includes('kind: "instrument.renderPreview"') || !source.includes("includeAudio?: boolean")) {
    fail("Frontend IPC schema must keep native instrument.renderPreview with includeAudio support.");
  }
  if (!source.includes('kind: "synth.expressionActivity"')
      || !source.includes('source: "midi"')
      || !source.includes("pitchBendSemitones")) {
    fail("Frontend IPC schema must expose native MIDI synth expression activity events.");
  }
  if (!source.includes('kind: "audio.previewData"') || !source.includes("audioDataUrl?: string")) {
    fail("Frontend IPC schema must expose native audio preview data.");
  }
}

if (existsSync(bridgePath)) {
  const source = read(bridgePath);
  if (!source.includes('case "instrument.renderPreview"')) {
    fail("Dev bridge must keep an instrument.renderPreview mock response.");
  }
  if (!source.includes('case "audio.previewData"')) {
    fail("Dev bridge must keep an audio.previewData mock response.");
  }
}

if (existsSync(backendSchemaPath)) {
  const source = read(backendSchemaPath);
  if (!source.includes("INSTRUMENT_RENDER_PREVIEW")) {
    fail("Backend IPC schema must expose INSTRUMENT_RENDER_PREVIEW.");
  }
  if (!source.includes("EV_SYNTH_EXPRESSION_ACTIVITY")) {
    fail("Backend IPC schema must expose EV_SYNTH_EXPRESSION_ACTIVITY.");
  }
  if (!source.includes("AUDIO_PREVIEW_DATA")) {
    fail("Backend IPC schema must expose AUDIO_PREVIEW_DATA.");
  }
}

if (existsSync(messageBridgePath)) {
  const source = read(messageBridgePath);
  if (!source.includes("kind == INSTRUMENT_RENDER_PREVIEW")) {
    fail("Backend bridge must handle instrument render preview.");
  }
  if (!source.includes("AudioEngine::renderProjectToWav")) {
    fail("Backend instrument preview must render through the C++ AudioEngine.");
  }
  if (!source.includes("makeWavDataUrl")) {
    fail("Backend instrument preview must keep the optional rendered WAV data URL path.");
  }
  if (!source.includes("kind == AUDIO_PREVIEW_DATA")
      || !source.includes("makeAudioDataUrl")
      || !source.includes("maxInlineAudioPreviewBytes")) {
    fail("Backend audio preview must validate and inline supported local audio through IPC.");
  }
  if (!source.includes('trackVar.getProperty("automation", {})')
      || !source.includes("lane.trackId = t.id;")
      || !source.includes("lane.instrumentId = t.instrumentId;")) {
    fail("Backend bridge must map frontend track.automation lanes into native project automation with track and instrument ids.");
  }
  if (!source.includes("engine.onSynthExpressionActivity")
      || !source.includes("EV_SYNTH_EXPRESSION_ACTIVITY")
      || !source.includes('o->setProperty("source", "midi")')) {
    fail("Backend bridge must emit native MIDI synth expression activity events.");
  }
}

const webAudioAllowlist = new Set([
  "frontend/src/audio/audioImport.ts",
  "frontend/src/audio/synthPreview.ts",
  "frontend/src/audio/synthWorkletPreview.ts",
  "frontend/src/audio/timelineAudio.ts",
  "frontend/src/audio/TimelineMidiPlayback.solid.tsx",
  "frontend/src/audio/wavemapResynthesis.ts",
  "frontend/src/features/ComponentLibrary/ComponentEditorModal.solid.tsx",
  "frontend/src/features/ComponentLibrary/ComponentLibraryPanel.solid.tsx",
  "frontend/src/features/DrumEditor/DrumSequencer.solid.tsx",
  "frontend/src/features/HomeHub/AudioFilesPage.solid.tsx",
  "frontend/src/features/HomeHub/InstrumentsPage.solid.tsx",
  "frontend/src/features/ImportInstrumentModal/ImportInstrumentModal.solid.tsx",
  "frontend/src/features/InstrumentEditor/InstrumentWaveformPreview.solid.tsx",
  "frontend/src/features/InstrumentLibrary/ImportInstrumentModal.solid.tsx",
  "frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx",
  "frontend/src/features/MidiEditor/MidiTransport.solid.tsx",
  "frontend/src/features/SegmentEditor/SegmentEditorModal.solid.tsx",
  "frontend/src/features/SegmentEditor/AudioSegmentTransport.solid.tsx",
  "frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx",
  "frontend/src/features/Tracks/AudioRecordingModal.solid.tsx",
]);

const webAudioPatterns = [
  /\bnew\s+(?:window\.)?(?:AudioContext|webkitAudioContext)\b/,
  /\bwindow\.(?:AudioContext|webkitAudioContext)\b/,
  /\bAudioWorkletNode\b/,
  /\.audioWorklet\b/,
  /\.createBufferSource\(/,
  /\.createOscillator\(/,
  /\bOfflineAudioContext\b/,
];

for (const file of walk(frontendSrc, (path) => /\.(ts|tsx)$/.test(path))) {
  const relativeFile = rel(file);
  const source = read(file);
  for (const { line, lineNumber } of lineEntries(source)) {
    if (!webAudioPatterns.some((pattern) => pattern.test(line))) continue;
    if (!webAudioAllowlist.has(relativeFile)) {
      fail(`WebAudio use must stay in explicit browser-preview fallbacks ${relativeFile}:${lineNumber}: ${line.trim()}`);
    }
  }
}

if (failures.length) {
  console.error("Audio boundary verification failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Audio boundary verification passed.");
