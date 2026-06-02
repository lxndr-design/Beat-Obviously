# Audio Engine Notes

This document tracks the current audio-engine decisions for Beat's synth and drum work. It is meant to be practical: what path runs today, what is optimized, and what still needs to move off the UI thread.

## Current Synth Preview Path

The synth editor now auditions Aether patches with an AudioWorklet-first path:

- `frontend/src/audio/synthWorkletPreview.ts` loads `/worklets/aether-preview-worklet.js` once per `AudioContext`.
- `frontend/public/worklets/aether-preview-worklet.js` renders the preview inside an `AudioWorkletProcessor`.
- `frontend/src/features/Synth/SynthEditor/SynthEditor.tsx` connects the worklet node through the same analyzer/gain path used by the previous preview.
- If AudioWorklet setup fails, the editor falls back to the cached `AudioBuffer` renderer from `frontend/src/audio/synthPreview.ts`.

This keeps the expensive click-to-play path out of the React event handler in supported browsers while preserving a safe fallback for development shells and older browser contexts.

The same worklet can also run scheduled one-shot notes for timeline Aether instruments:

- `frontend/src/audio/timelineAudio.ts` tries the worklet path for instruments with `instrument.aether`.
- `frontend/src/features/MidiEditor/MidiTransport.tsx` uses the same worklet-first behavior for in-modal MIDI preview.
- Sample-backed instruments, drum rows, and unsupported browsers continue to use `AudioBufferSourceNode`.
- Worklet render options now include `startTimeS`, `targetFrequency`, pitch `curve`, per-note `automation`, and `velocity`.
- The processor outputs silence until the requested audio start frame, then renders the note duration and exits.

## Frontend Synth Caches

The frontend preview renderer keeps several caches so repeated small edits do not rebuild the same math over and over:

- Rendered instrument buffers are keyed by patch settings, duration, frequency, and sample rate.
- Wavetable preview tables are cached per waveform/frame-shape input.
- Oscillator rate plans are cached for repeated pitch and sample-rate combinations.
- Unison voice plans are cached so voice detune, pan, spread, and blend do not get recalculated per sample.

These caches are intentionally preview-side only. They improve modal audition and visual feedback, but the native render path remains the source of truth for long-running project playback.

## Native Synth Optimizations

The backend synth path has the first wave of real-time-focused improvements:

- `backend/Source/Audio/Realtime/SpscRingBuffer.h` provides a fixed-capacity single-producer/single-consumer queue for future control-to-audio messages.
- `backend/Source/Audio/Realtime/FixedObjectPool.h` provides preallocated reusable object storage for bounded real-time work.
- `backend/Source/Audio/Realtime/RealtimeParameterQueue.h` defines fixed-string parameter-change messages on top of the SPSC queue.
- `WavetableOscillator::setFrequency` and `setPosition` early-out when values are unchanged.
- `InstrumentVoice` uses fixed-size unison plans rather than dynamically building voice data during the render loop.
- The native stress target exercises the backend after the wavetable/unison changes.
- `AudioEngine` publishes a lightweight `engine.renderTiming` IPC event from atomic render timing snapshots.

The render timing event contains:

- `scheduleMs`: sequencer/event collection time.
- `synthMs`: synth voice render time.
- `samplesMs`: sample playback mixing time.
- `fxMs`: master FX time.
- `analyzerMs`: FFT/meter analysis time.
- `copyMs`: output buffer copy time.
- `totalMs`: full audio callback time.
- `loadPercent`: callback time divided by available block time.

The frontend consumes this through `frontend/src/audio/analyzerClient.ts` into `useAnalyzerStore().renderTiming`; it is ready for a developer-facing timing panel.

The realtime helpers are not a blanket concurrency solution:

- `SpscRingBuffer` must have exactly one producer and one consumer.
- `FixedObjectPool` objects must be released by the owner that finished using them; callers must not keep stale pointers.
- `RealtimeParameterQueue` stores instrument and parameter IDs in bounded inline arrays; long IDs are truncated and negative offsets/ramps are clamped to zero.
- Both primitives are bounded and fail fast when full rather than allocating.

`AudioEngine::queueRealtimeParameterChange` now accepts `engine.setParameter` IPC messages and drains them on the audio thread under the existing non-blocking engine-state try-lock. Active synth voices ramp parameter changes over `rampSamples`; inactive voices adopt the target immediately so a future note does not start with stale automation.

Native MIDI notes now preserve per-note automation lanes from the frontend project payload. The sequencer passes the source note through its trigger event, and `AudioEngine` attaches a bounded automation context to the note before rendering the target synth. `InstrumentVoice::startNote` consumes the matching context when JUCE assigns the actual polyphonic voice, so overlapping notes can own independent parameter automation instead of fighting over one instrument-level value.

Each voice stores a baseline patch snapshot. Patch/global realtime changes update that baseline for future notes, while per-note automation starts from the baseline and stays local to the active voice. This prevents note automation from leaking into the next note when a voice is reused.

Native MIDI pitch curves now use the same voice-owned context. Frontend note `curve` points are parsed into the backend model, converted to frequency targets during scheduling, and consumed by the assigned `InstrumentVoice` as a local pitch ramp. This makes `Curve To`-style pitch movement part of native playback instead of only the browser preview path.

Segment-level parameter automation is also native. `Segment::automation` lanes are parsed from either `segment.automation` or `payload.automation`, emitted by `Sequencer` as sample-offset `ParameterAutomationEvent`s, and routed into the same bounded block realtime event vector used by `engine.setParameter`. The sequencer emits an interpolated value at block entry when playback starts midway through a ramp, then ramps toward the next point over the remaining samples.

Project-level parameter automation is native as well. Top-level `projectAutomation` or `automation` lanes use absolute beat positions and may target a specific `instrumentId`; an empty instrument ID targets the default/global synth route. These lanes share the same event path as segment automation and are useful for whole-song sweeps that are not tied to one MIDI note or clip.

Realtime parameter ramps now use an active-ramp list inside `InstrumentVoice`. The render loop advances only parameters that are currently ramping, instead of scanning every supported realtime parameter on every sample. Immediate parameter changes remove stale ramp entries so an old ramp cannot keep running after a direct override.

Track-level routing is now part of the native render path:

- `Sequencer::TriggerEvent` carries `trackGainDb`, `trackPan`, and `segmentGainDb`.
- Each track/instrument route owns its own `juce::Synthesiser`, so two tracks using the same preset do not share voice state or steal each other's note-offs.
- Native synth routes render into a reusable route buffer, then add into the master mix with track gain and equal-power pan.
- Sample-backed instruments apply zone gain, track gain, segment gain, and equal-power pan when voices are started.
- Mute and solo still happen in the sequencer before events are emitted.

The first supported live parameter set is intentionally limited to continuous values:

- `filter.cutoff`
- `filter.resonance`
- `filter.drive`
- `amp.level`
- `amp.pan`
- `osc.a.position`
- `osc.b.position`
- `osc.a.fine`
- `osc.b.fine`
- `osc.a.level`
- `osc.b.level`
- `osc.a.pan`
- `osc.b.pan`
- `unison.detune`
- `unison.spread`
- `lfo.1.rate`
- `lfo.1.depth`

Wavetable bank/frame changes still go through full project/patch apply because they can rebuild table data.

The frontend exposes current render cost through `RenderTimingPanel`, mounted globally from `App.tsx`. It reads `useAnalyzerStore().renderTiming` and shows callback load plus per-phase timings.

## Drum Generator Playback

The drum generator has been adjusted around musical genre rules rather than raw grid density:

- Speed is constrained to `1..6`.
- Complexity no longer means "add more instruments."
- `50` complexity is treated as the ideal genre baseline.
- Higher complexity should add variation, fills, ghost notes, retriggers, and timing detail without filling every cell.
- Swing uses `50%` as no swing; lower and higher values push timing in opposite directions.

The generator should continue to follow explicit genre rules before randomness. For example, breakcore should start from break slices and edits, not tom-heavy generic drum-grid density.

## Verification Run

The current audio-engine chunk was verified with:

```sh
npm run typecheck
npm run verify:synth
npm run build
npm run verify:drums
cmake --build build --target BeatBackendStress
cmake --build build --target Beat
./build/bin/BeatBackendStress
node --check frontend/public/worklets/aether-preview-worklet.js
curl -I http://127.0.0.1:4174/worklets/aether-preview-worklet.js
```

The local in-app browser automation context did not expose `AudioContext`, so it could not execute the WebAudio graph directly from automation. The worklet file was still syntax-checked, built, copied into `dist`, and confirmed served by the preview server. A manual audible audition in the actual app remains the best final check for the worklet path.

## Near-Term Engine Plan

1. Keep buffer rendering only for export, fallback, sample playback, and deterministic tests.
2. Expand tests for rapid preview restart, high-polyphony unison patches, and dense overlapping automation.
3. Add frontend controls for segment and project automation targets beyond pitch.
4. Add export/offline render coverage for native parameter automation.
5. Split the large frontend bundle once the current synth/drum architecture settles.
