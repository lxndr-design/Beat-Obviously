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
- `InstrumentVoice` caches the applied frequency/position per wavetable bank voice. The old per-sample unison phase offset is now folded into the oscillator frequency, avoiding a `setPhase` call per unison voice per sample while preserving the intended phase drift.
- `InstrumentVoice` caches Aether oscillator/sub pitch rates derived from octave, semitone, and fine tuning. Static Aether voices no longer recalculate those `pow()` rates per sample; only active dynamic fine modulation pays that cost. The render timing payload exposes `oscillatorRateCalculations` so this stays visible during CPU triage.
- `WavetableOscillator` caches frame-selection state derived from wavetable position, playback frequency, sample rate, and table size. Stable notes reuse the same frame pointers and blend amount instead of recomputing band-limit frame selection on every sample.
- Aether/wavetable voice playback quantizes modulated wavetable position and playback frequency before applying oscillator setter changes. This bounds frame-cache invalidation churn from tiny modulation deltas while preserving high-resolution movement, and render work counters expose frequency/position update counts separately.
- Aether voice setup skips the legacy single-oscillator wavetable setup path entirely, and also skips wavetable table lookup/bank configuration for disabled Aether oscillators and non-wavetable oscillator modes. Enabled wavetable oscillators still prepare even at zero base level so modulation can raise them without missing table state.
- Aether voice drive is a true nonlinear-stage bypass at zero drive. The render loop no longer calls `tanh()` for clean oscillator paths, and backend stress asserts the drive-work counter stays at zero when drive is disabled.
- Active Aether/basic voice drive uses bounded 2x midpoint oversampling with per-voice left/right previous-input and downsample smoothing state. The bypass path keeps that state warm so automation can enable drive without stale-state discontinuities, and the filter-drive work counter reports oversampled work.
- The native stress target exercises the backend after the wavetable/unison changes.
- `AudioEngine` publishes a lightweight `engine.renderTiming` IPC event from atomic render timing snapshots.
- Live master metering now publishes additive dB diagnostics on the existing
  `engine.levelMeters` master row: RMS dBFS, sample-peak dBFS, bounded
  4x-interpolated true-peak dBTP, and momentary LUFS over a preallocated
  400 ms K-weighted ring. This is intentionally separate from full-file
  integrated LUFS, which remains an offline/export analysis result.
- Live and offline render callbacks use `juce::ScopedNoDenormals`; direct `InstrumentVoice` renders do the same. Route-effect tails also flush useless near-zero samples, so delay/reverb/filter tails cannot drag the CPU into denormal slow paths near silence.
- Route saturator/distortion now use bounded 2x midpoint oversampling with per-route, per-effect state and a lightweight downsample smoothing stage. The route nonlinear work counter reports the doubled sample work, and backend stress covers block-size continuity plus the timing counter so nonlinear FX CPU cost stays visible before heavier warp/morph modes are exposed.
- Instruments can now own their own FX chain in addition to the track route chain. At render time the engine composes `instrument.effects` before `track.effects` and runs the combined list through the same route FX processor/state used for track effects, so Aether/sampler instrument FX share latency compensation, export-tail estimation, live/export parity behavior, and project-health plugin validation instead of creating a second synth-only DSP path.

The render timing event contains:

- `scheduleMs`: sequencer/event collection time.
- `synthMs`: synth voice render time.
- `voiceMs`: direct synth voice render calls inside the synth phase.
- `modulationMs`: realtime parameter, automation, and route-control application overhead.
- `samplesMs`: sample playback mixing time.
- `fxMs`: route effect plus master FX time.
- `filterFxMs`: route track-effect/plugin-placeholder processing time before track meters and mixdown.
- `analyzerMs`: FFT/meter analysis time.
- `copyMs`: output buffer copy time.
- `totalMs`: full audio callback time.
- `loadPercent`: callback time divided by available block time.
- Active counts: synth voices, sample voices, audio-clip voices, route count,
  and queued automation events for the latest block.
- Wavetable cache stats: shared-table cache hit count, miss count, and current
  cache size. These are setup-path counters, not per-sample timers, so they
  expose whether Aether edits stay on cached table data without adding render
  overhead.
- Voice work counters: voice render blocks/samples, wavetable voice-samples,
  plain oscillator sample work, Aether oscillator A/B/sub/noise sample work,
  filter sample work, modulation sample work, active realtime-ramp work, and
  dynamic oscillator-rate recalculations for the latest published block. These
  are low-overhead work counters rather than per-sample wall-clock probes, so
  they expose CPU-scaling pressure without polluting the audio callback with
  timing calls inside the inner loop.
- Route-effect work counters: total route-effect sample work plus filter,
  nonlinear, and delay/modulation-delay buckets. The nonlinear bucket counts
  oversampled saturator/distortion work at the oversampled rate. These are
  effect-granularity counters, not inner-loop timers, and are stress-covered by
  the dense Aether route path so native FX CPU changes stay visible.

The frontend consumes this through `frontend/src/audio/analyzerClient.ts` into `useAnalyzerStore().renderTiming`; it is ready for a developer-facing timing panel.

The realtime helpers are not a blanket concurrency solution:

- `SpscRingBuffer` must have exactly one producer and one consumer.
- `FixedObjectPool` objects must be released by the owner that finished using them; callers must not keep stale pointers.
- `RealtimeParameterQueue` stores instrument and parameter IDs in bounded inline arrays; long IDs are truncated and negative offsets/ramps are clamped to zero.
- Both primitives are bounded and fail fast when full rather than allocating.

`AudioEngine::queueRealtimeParameterChange` now accepts `engine.setParameter` IPC messages and drains them on the audio thread under the existing non-blocking engine-state try-lock. Active synth voices ramp parameter changes over `rampSamples`; inactive voices adopt the target immediately so a future note does not start with stale automation.

`BeatBackendStress` includes a dense Aether route case that drives high-unison oscillator A/B, sub/noise, dynamic modulation, route automation, track FX, realtime parameter edits, variable block sizes, meters, route-effect work counters, and render-timing counters through the full engine path.

Native MIDI notes now preserve per-note automation lanes from the frontend project payload and from `.beat` document roundtrips. The sequencer passes the source note through its trigger event, and `AudioEngine` attaches a bounded automation context to the note before rendering the target synth. `InstrumentVoice::startNote` consumes the matching context when JUCE assigns the actual polyphonic voice, so overlapping notes can own independent parameter automation instead of fighting over one instrument-level value.

Each voice stores a baseline patch snapshot. Patch/global realtime changes update that baseline for future notes, while per-note automation starts from the baseline and stays local to the active voice. This prevents note automation from leaking into the next note when a voice is reused.

Native MIDI pitch curves now use the same voice-owned context. Frontend note `curve` points are parsed into the backend model, preserved through native project repository save/load, converted to fractional MIDI-frequency targets during scheduling, and consumed by the assigned `InstrumentVoice` as a local pitch ramp. This makes `Curve To`-style pitch movement part of native playback instead of only the browser preview path and avoids quantizing editor pitch handles to whole-note steps.

Segment-level parameter automation is also native. `Segment::automation` lanes are parsed from either `segment.automation` or `payload.automation`, emitted by `Sequencer` as sample-offset `ParameterAutomationEvent`s, and routed into the same bounded block realtime event vector used by `engine.setParameter`. The sequencer emits an interpolated value at block entry when playback starts midway through a ramp, then ramps toward the next point over the remaining samples.

Project-level parameter automation is native as well. Top-level `projectAutomation` or `automation` lanes use absolute beat positions and may target a specific `instrumentId`; an empty instrument ID targets the default/global synth route. These lanes share the same event path as segment automation and are useful for whole-song sweeps that are not tied to one MIDI note or clip.

Route-level automation is also supported for the unified track route path:

- `track.gainDb`
- `track.gain`
- `track.pan`
- `effect.<effectId>.<param>`
- `effects.<effectId>.<param>`

Track effects may also own timeline automation lanes directly on the effect node. Each lane targets one effect parameter and carries sorted absolute-beat timepoints with an outgoing curve (`hold`, `linear`, `quadratic`, `cubic`, `easeIn`, `easeOut`, or `smoothstep`). The sequencer emits those lanes as route automation targets such as `effect.<effectId>.mix`, so thin effect rows and parameter subrows can draw/edit diamonds, curve choices, and tinted transition lines without adding another audio-thread path.

Automation ramps are no longer only sampled at render-block boundaries. The sequencer emits bounded 128-sample control checkpoints across non-hold automation spans, evaluating the lane's outgoing curve at each checkpoint. This keeps track gain/pan, effect-owned lanes, project lanes, and segment lanes closer to their intended shape even when the device/offline block size is large. `BeatBackendStress` includes a curve-checkpoint stress case that distinguishes linear, cubic, ease-out, and smoothstep midpoint values, so curve handling cannot silently collapse back into a single stepped block value.

Project automation lanes may carry `trackId` for route targets. Segment automation already has an owning track, so segment route automation can target that track directly. Route events are sorted by sample offset and processed in chunks before meters and mixdown, which keeps synth tracks, arrangement audio clips, and sample-backed instruments on the same automation/export path.

Route-gain automation also has a dedicated block-size stability stress using an audio-clip route rendered in 128-sample and 4096-sample blocks. This protects the automation scheduler/control path from becoming block-size dependent while keeping broader synth/filter block-size behavior as a separate quality target.

Realtime parameter ramps now use an active-ramp list inside `InstrumentVoice`. The render loop advances only parameters that are currently ramping, instead of scanning every supported realtime parameter on every sample. Immediate parameter changes remove stale ramp entries so an old ramp cannot keep running after a direct override. Voices also skip LFO waveform evaluation when no active modulation path needs it, and wavetable unison plan updates are slightly quantized to avoid repeated `pow()` work from tiny modulation deltas.

Track-level routing is now part of the native render path:

- `Sequencer::TriggerEvent` carries `trackGainDb`, `trackPan`, and `segmentGainDb`.
- Each track/instrument route owns its own `juce::Synthesiser`, so two tracks using the same preset do not share voice state or steal each other's note-offs.
- Native synth routes render into a reusable route buffer, then add into the master mix with track gain and equal-power pan.
- Arrangement audio clips now use the same route-buffer path. The frontend sends `audioFiles` with `engine.applyProject`/`project.exportWav`, the backend resolves `audioFileId` to disk, and the sequencer emits block-overlap clip events so clips render correctly after seek and during offline export.
- Arrangement audio clips carry `sourceStartBeat`, `fadeInBeats`, and `fadeOutBeats` through IPC into sequencer audio-clip events. The audio engine applies these as output-time linear envelopes, so trimmed clips and simple fades match live playback and export without rebuilding source buffers.
- Recorded takes are planned as ordinary audio-file assets plus audio segments. The backend recording planner validates capture metadata, creates or reuses an audio track, appends the audio-file registry entry, appends the segment, and extends project length without introducing a separate recording-only data path. Input recording capture uses a preallocated native buffer; the audio callback only copies incoming samples when armed, stops on capacity overflow, and leaves WAV finalization to the non-callback path. Captured takes can now commit through one backend helper that preflights the model update, writes the WAV, and only then swaps the staged project into place. Take planning also accepts input/output/manual latency compensation in samples; compensated takes move earlier on the timeline, and takes that would start before beat zero instead clamp to beat zero and advance `sourceStartBeat`. Backend stress covers append, duplicate-id rejection, renderability, local repository roundtrip, callback capture, WAV write, overflow handling, commit, rollback when commit validation fails, and latency-compensated placement.
- Recording session orchestration has a pure backend planner. Given a requested start beat, count-in length, tempo, input-channel request, and optional target track, it chooses the record-armed track, clamps transport start at beat zero, calculates the capture delay in seconds, and rejects missing/unarmed targets before any device work starts. This keeps future record UI from duplicating timing rules. Backend stress covers normal count-in, count-in clamped at the start of the song, first-armed-track selection, unarmed explicit targets, missing armed tracks, invalid durations, and input-channel bounds.
- Recording latency calibration has a small backend math contract. Given a measured loopback/round-trip latency, reported input/output latency, and optional user adjustment in samples, it produces the manual correction and total compensated latency used by take placement. Applying calibration stamps a `RecordedTakeSpec` with one compensated latency value, so append/commit continues through the same tested latency path. Projects also carry a `RecordingInputProfile` for selected input device/channel metadata plus calibration values, and the repository roundtrips it with bounded clamps. Project Health integrity checks warn on invalid recording input channels, missing calibration sample rate, negative latency measurements, and record-armed track channel metadata that would be clamped. Backend stress covers calibration math, profile-to-calibration mapping, milliseconds reporting, invalid measurements, project profile persistence, integrity surfacing, and the resulting segment placement.
- Input monitoring has a default-off native path. When enabled, the callback adds incoming input channels into the main mix buffer with an atomic linear gain before master FX, meters, analyzer, and output copy. Backend stress covers default-off silence, enabled monitoring output, master meter publication, and disabling back to silence.
- Track recording metadata now has a stable backend shape: `recordArmed`, `inputMonitoring`, `inputDeviceId`, `inputChannelStart`, `inputChannelCount`, and `recordGainDb`. These fields roundtrip through the local project repository and parse through native project IPC. Applying a project enables native input monitoring only when at least one track is both armed and monitoring-enabled; applying a non-monitoring project disables it again.
- Live device initialization now has an explicit `prepareWithDefaultDevices(inputChannels, outputChannels)` path. Normal app startup still requests zero inputs, while future record-arm UI can deliberately ask for input channels and surface the native device-manager error if permission/device setup fails.
- Sample-backed instruments now render into the owning track route. Zone and segment gain are applied at voice start; track gain/pan, route automation, effects, meters, and export all happen through the same route path as synths and arrangement audio clips.
- Sample-backed instruments now respect key/velocity zones, deterministic `seqPosition` ordering, root-note pitch shifting, tuning cents, zone gain, pan, one-shot zones, choke/exclusive groups, and sustain-loop metadata. Active sample voices use note length plus a bounded release ramp, with short attack/end fades to avoid clicks. One-shot zones play through the sample instead of being cut by short MIDI note lengths. Choke groups release older matching sample voices on the same track/instrument/group with a short ramp, which keeps imported kit articulations from stacking when they should cut each other off.
- Uploaded multi-file sampler instruments are treated as hit variants by default. Imported zones may carry `durationSeconds` plus equal note-length bands; playback/export first match pitch/velocity, then length band, then nearest sample duration, then deterministic round-robin among equivalent candidates. Backend stress covers combined velocity + note-length zone selection so multi-variable instruments do not collapse into a single ambiguous layer.
- Sample buffers are deduped during project apply, so repeated zone/instrument references to the same WAV share one decoded buffer for that applied project snapshot.
- Built-in non-wavetable saw and square oscillators now use a bounded polyBLEP edge correction instead of raw discontinuities. This reduces aliasing for high notes at small CPU cost and is covered by voice stress so the path stays finite/non-silent without contaminating wavetable counters.
- Sample zones are allowed to load their own `zone.path` directly even when the instrument's top-level `sampleUrls` list is missing or incomplete. This keeps DecentSampler-style keymaps from rendering silent if an importer stores samples only on the zones.
- DecentSampler package import now preserves package-level UI metadata in
  addition to sample zones: source path, optional background image path,
  declared UI dimensions, visible control labels, control geometry, value
  ranges/defaults, binding metadata, and zone count. Sample-zone parsing
  inherits group-level volume, round-robin sequence position, and choke-group
  metadata so drum kits with grouped articulations do not collapse into a flat
  sample list. Installed DS packages are
  represented as package-wrapper plugin adapters with live sampler-compatible
  capability metadata and open in the protected package wrapper rather than the
  generic Aether instrument editor. Native sampler conversion now links a
  Beat-compatible MIDI instrument from the same parsed zone data without
  creating an Aether fallback patch, while true
  DecentSampler runtime hosting is still intentionally out of the audio
  callback. Backend stress now covers the Lorenzo DecentSampler drum package as
  both live sampler playback and WAV export, so drum-kit DS imports cannot
  silently regress into Aether/synth fallback behavior.
- `.beat` project documents include an asset manifest generated from audio files, sample-backed instruments, and plugin package placeholders. Each asset records kind, path, policy (`bundled`, `external`, or `plugin`), and references, which is the foundation for missing-file diagnostics and future sidecar asset packaging.
- Mute and solo still happen in the sequencer before events are emitted.
- Native send/return buses now exist as a backend routing foundation. Tracks may own post-fader `sends`, projects may own `returnBuses`, and each return bus has its own preallocated return buffer plus the same native effect-chain machinery as track routes. Sends accumulate into return buffers during route processing, return effects run before the master chain, and backend stress verifies that an enabled return bus changes the mix while a muted bus does not. Bus UI, latency-reporting polish, and deeper routing UX remain future work.
- Native group/folder routing now has a backend foundation. Tracks may carry `parentTrackId`, group tracks use `TrackKind::Group`, and the engine preallocates group buffers that receive child route output before group effects, group sends, and group/master summing. Missing parent groups deliberately fall back to direct master mix instead of producing silence during incomplete edits, but Project Health treats missing parents, self-parents, non-group parents, and parent cycles as structural errors before save/open flows trust the document. Group bus panning uses stereo-balance behavior so a center 0 dB group remains transparent, while source tracks keep equal-power pan. Backend stress verifies that a 0 dB group nulls against the ungrouped render, that group gain attenuates the summed child path, and that bad parent graphs are surfaced by the integrity verifier.

Transport reset is treated as an audio-engine panic path. Pause, stop, restart, and seek clear pending note-offs, pending automation, active sample/audio-clip voices, route MIDI buffers, queued realtime parameter changes, and delay/reverb/filter runtime state. Route gain, pan, and effect params are restored from the last applied project snapshot before playback resumes, so seeking backward does not inherit automation or effect tails from the old playhead position.

Transport requests are queued through a bounded SPSC command buffer and drained at the top of the audio callback before sequencer scheduling. The drain path coalesces UI bursts into the latest seek plus the latest terminal play/pause intent, while still applying loop and speed edits in order. This keeps rapid play/pause/seek/restart bursts from replaying stale toggles on the audio thread, while preserving the panic reset path for commands that must clear active voices or tails. If the queue fills, stale queued transport commands are dropped before the newest command is queued, so old play/seek state cannot override a later user action after an overflow burst.

Review-loop playback is scheduled as a piecewise timeline, not as a visual playhead correction. When an audio block crosses the loop endpoint from before the endpoint, the sequencer emits MIDI, automation, and audio-clip events for the pre-endpoint span, wraps the remaining samples to the loop start, and emits the post-wrap span with sample offsets still relative to the original output block. Manual seeks beyond the loop endpoint do not wrap until playback crosses the endpoint from before it again.

Applying a new project is also treated as a runtime boundary: active voices, queued realtime changes, pending note automation, route state, loaded route/sample buffers, and the new immutable project snapshot are installed under the audio-engine state lock. Backend stress verifies that applying an empty project while playback is active immediately silences stale voices/tails without forcing the transport into a different play/pause state.

Render scratch buffers and voice DSP preparation are preallocated to at least 8192 samples even when the device/offline nominal block is smaller. The callback still sets the logical block size each render, but common device-size variation and odd offline stress blocks up to that capacity do not need to grow the route/mix buffers in the audio callback.

Track-level meters are now native as a core mixer primitive:

- The audio engine creates a meter slot for every project track plus `master`.
- Synth route meters are measured after track gain/pan is applied.
- Audio clip and sample-instrument route meters are measured after track gain/pan is applied.
- Master meters are measured after master FX.
- `MessageBridge` emits the existing `engine.levelMeters` IPC event, and the frontend stores per-track meters keyed by track ID.
- Track headers display a thin peak strip for immediate feedback; fuller mixer metering can build on the same store later.

Track effect chains have a first native DSP pass:

- Frontend `track.effects.filters` are parsed into the backend `Track` model.
- Each track route owns its effect chain and filter state, matching the per-track synth ownership model.
- Low-pass and high-pass filters use JUCE's TPT state-variable filter.
- Saturator is a native dry/wet waveshaper.
- Distortion is a native dry/wet nonlinear clipper with bounded drive, soft-to-hard shape, output trim, and backend block-size parity stress.
- Bitcrush is a native stateful dry/wet reducer with persistent sample-hold state.
- Compressor is a native per-route processor with threshold, ratio, attack, release, makeup, and mix. Its detector envelope is stored per route/effect and reset on transport panic paths.
- Chorus is a native per-route processor with rate, depth, delay, feedback, and mix. Its delay line, write cursor, and modulation phase are owned per route/effect so tracks cannot share modulation state.
- Phaser is a native per-route processor with rate, center frequency, octave depth, feedback, and mix. Its allpass stage history, feedback, and modulation phase persist per route/effect, with backend stress coverage for block-size continuity.
- Flanger is a native per-route processor with tighter modulation-delay bounds than chorus. It reuses the preallocated modulation delay state with flanger-specific delay/depth defaults and backend stress coverage for block-size continuity.
- Bitcrush is stateful per route/effect. Its held sample and hold counter persist across render blocks, so live playback and export do not change character at arbitrary callback boundaries.
- Delay and reverb now own per-route state, so track effect chains can produce time-based tails without sharing state across tracks.
- Effects run before track meters and before the route is added to the master mix.
- Offline export estimates a bounded track-effect tail for delay/reverb so bounced WAVs do not end exactly at the dry project boundary.
- Plugin effect nodes are now represented as first-class chain items, but they are intentionally pass-through in native playback/export until a real-time-safe plugin bridge is available. This preserves project intent and plugin metadata without pretending unavailable third-party DSP is running.
- Track effects can carry `latencySamples` metadata through the frontend type, IPC parser, local project repository, and backend model. If a plugin effect row omits latency but references an installed/imported plugin adapter, the native engine resolves effect latency from that adapter's `effect` capability before latency estimation and project application. `AudioEngine::estimateProjectLatencySamples` returns the maximum active per-track latency. Plugin-placeholder effects with declared or capability-derived latency delay their route through preallocated ring buffers, and lower-latency routes receive compensation delay before summing into the master. This gives live playback and export the same delay-compensation foundation before true third-party plugin processing arrives.
- Plugin adapters now have an explicit capability contract in the frontend and native project model. Capabilities describe whether an adapter provides an instrument/effect/renderer/utility surface, whether it can run realtime/offline, declared latency, and the intended fallback mode (`aether`, `rendered-audio`, or `pass-through`). The native project repository roundtrips this metadata with backend stress coverage, so future plugin-derived instruments and effect placeholders can survive save/load without relying on loose UI-only fields.
- Native effect nodes now carry a `schemaVersion`. Loading older/minimal project data fills missing native effect parameters with the same defaults used by the render path without overwriting authored values. The shared normalizer covers track, return-bus, and instrument-owned effect chains, and backend stress roundtrips legacy reverb/delay/distortion nodes so preset/file migration cannot silently depend on hidden playback fallbacks.
- `AudioEngine::applyProject` and offline export apply the same native-effect normalizer at engine ingress, so live IPC projects, saved `.beat` files, and offline WAV export all converge on the same bounded default parameter set before route latency, tail, and render state are prepared.

The master output path has a project-owned master chain after Global Mastering EQ and before meters/analyzer/playback/export:

- `masterChain` stores neutral input gain, optional compressor, and output gain settings in the project model. Defaults are bypassed/0 dB so old projects preserve their sound.
- The master compressor uses the same peak-envelope gain-reduction shape as the native track compressor, with bounded threshold, ratio, attack, release, makeup, and mix controls. It is zero-allocation in the shared live/offline path and resets its detector envelope when a project is applied.
- A fixed final safety limiter still runs after the creative master chain.
- Ceiling is `-0.3 dBFS`, with instant peak clamp and a short release back to unity.
- The limiter is zero-allocation and lives in the shared live/offline render path.
- It is not a creative compressor; it is the current headroom policy that prevents accidental clipped playback and clipped PCM16 exports while the fuller master chain is still being built.
- `BeatBackendStress` intentionally overdrives the master path and asserts both live and exported peaks stay under the limiter ceiling. It also verifies the optional master compressor changes/reduces a hot signal and remains stable across different render block sizes.

Offline export now uses the native engine instead of returning only a chosen path:

- `AudioEngine::renderProjectToWav` drives an isolated offline engine in fixed-size blocks.
- `AudioEngine::renderProjectRangeToWav` renders a beat-range slice through the same isolated offline engine. It clamps the requested range, rejects empty ranges, seeks the engine to the start beat, preserves the temp-file/progress/cancel safety path, and can optionally include the bounded effect tail. `project.exportRangeWav` exposes this through IPC with the same asset preflight and native analysis response as full-project export, so future selection, loop, and region exports do not need a second render path.
- `AudioEngine::renderTrackToWav` renders one selected track through the same offline path by soloing that track in a project copy. `project.exportTrackWav` exposes this through IPC with the same asset preflight and native analysis response as full-project export.
- Track-stem export stress now compares the exported WAV prefix against live/offline playback of the same project with the target track soloed, so stems are checked for render-path parity instead of only nonzero energy.
- Track bounce/freeze now has a backend planning primitive in `Audio/Rendering/TrackBouncePlanner`. The planner does not render audio itself; it commits an already-rendered stem as an `AudioFileAsset`, creates a replacement audio track/segment, and mutes the source track without deleting it. Freeze-style bounces default to detaching the replacement track from the source parent group so a stem that was rendered through group processing is not processed by that parent a second time; callers that need an explicit routed export can opt into preserving `parentTrackId`. `project.bounceTrackWav` wraps the existing track-stem renderer, analyzes the rendered WAV, applies the planner, and returns the new audio-file asset plus bounced track for frontend state integration. Backend stress renders a source stem, applies the bounce planner, rejects duplicate IDs, verifies the parent-routing policy, and verifies the resulting project renders non-silent audio. UI wiring and reversible unfreeze metadata remain future work.
- `AudioDeviceManager` is created lazily in `prepare()`, so offline engines do not enumerate or initialize hardware.
- WAV export writes deterministic integer PCM into a sibling temporary file, validates that render output exists, verifies the temp stream with JUCE's WAV reader, then replaces the selected destination. The native export contract accepts bounded format options for sample rate, mono/stereo channels, block size, and 16/24/32-bit WAV depth while preserving the old 44.1 kHz stereo PCM16 default. A failed export should not destroy the previous WAV.
- `project.exportWav` expects the current project, instrument list, and audio-file registry from the frontend and returns either `path` plus native render analysis or an `error`.
- The offline render path accepts a progress callback that can cancel before final replacement. Cancellation deletes the temporary WAV, preserves any previous destination WAV, and returns an explicit export-cancelled error, which is the backend foundation for future progress/cancel UI.
- `project.exportWavAsync`, `project.exportRangeWavAsync`, and `project.exportTrackWavAsync` start background WAV export jobs for full projects, beat ranges, and track stems. Jobs emit `project.exportProgress` events, support `project.exportCancel`, expose `project.exportStatus` for polling/recovery, report their job `type`, and attach the same render analysis used by synchronous export once a job completes. The first backend implementation intentionally allows one active export job at a time; the old synchronous full/range/track export IPC remains available for compatibility. The app export button now uses the async native path and displays a compact progress/cancel panel while jobs run.
- Successful exports are immediately re-analyzed with `AudioFileAnalyzer`, so the caller can inspect sample rate, duration, channel count, source bit depth, L/R peak, true peak, RMS, crest factor, DC offset, clipping ratio, stereo correlation, and integrated LUFS from the same backend math used by the audio-file library.
- Native WAV export preflights referenced `audioFiles`, `sampleUrl(s)`, and `sampleMap` paths. Missing files return an explicit export error instead of silently producing an incomplete render.
- `BeatBackendStress` now links the full audio engine and verifies that tiny native synth and audio-clip projects export WAVs with finite nonzero signal, monotonic export progress, cancelled export cleanup without clobbering a previous output file, exact sample-length range exports, and nonzero-beat range export parity against live playback after seek.
- Project integrity stress now exercises missing assets, sidecar orphans and cleanup, duplicate IDs, and invalid segment graph references before save/open paths can trust a document. Native Open distinguishes relinkable missing media from fatal document-structure errors; missing assets can still hydrate with warnings, while duplicate IDs, schema errors, invalid timing, or broken graph references are rejected before the editor state is replaced. Deterministic native repair helpers are intentionally narrow: they can rebuild the asset manifest and repair stale segment container `trackId` values, but they do not guess timing, payload, or missing media intent.
- Project integrity verification now validates audio segment trim/fade metadata against available audio-file durations. Negative source starts and impossible source starts are fatal structural errors; clips that extend beyond their referenced source and fade lengths that exceed segment length are warnings because they can be clamped or rendered as partial/silent tails without losing the project.
- Project sidecar packaging stress now verifies that sample-map path rewriting preserves musical zone metadata, including pitch/root, velocity bands, gain/pan/tuning, hit-variant sequence position, and note-length bands.
- Live/export parity stress now covers native synth/effects/global mastering, effect-owned automation lanes, dense Aether patches with unison/modulation/route effects, sample-backed instruments with direct zone-path loading and sustain loops, trimmed/faded/crossfaded audio clips, and a mixed synth + sampler + audio-clip project.
- Dense Aether stress now includes a full-engine max-unison polyphony case with overlapping notes, both oscillators at eight wavetable voices, route automation, realtime parameter ramps, and render-work counter assertions.

Native audio-file analysis is now its own backend module:

- `AudioFileAnalyzer` computes producer-facing file stats from decoded audio buffers: source bit depth for files, L/R sample peaks, estimated 4x true peak, RMS, crest factor, DC offset, clipping count/ratio, stereo correlation, and integrated LUFS using K-weighting plus absolute/relative gating.
- `audio.waveform` exposes bounded native L/R waveform buckets for audio-library previews. It returns upper/lower peak arrays per channel, clamps requests to a safe maximum bucket count, and keeps a small bridge-local cache keyed by path, file size, modified time, and bucket count so repeated preview clicks do not re-decode unchanged files.
- The Audio Files management page now asks the native waveform endpoint first and falls back to browser decode only in dev or when the native file path is unavailable.
- The analyzer also exposes a streaming file path entry point through JUCE's audio readers, so import, document validation, and future export-safety checks can share the same native metrics without allocating one giant buffer for long recordings.
- Native audio import/list persistence now stores and reloads those analysis fields in the `audio_files` table. Nullable stats are preserved as omitted JSON fields instead of fake zero values, which keeps silence or unreadable files distinguishable from real 0 dB readings.
- Native audio listing now repairs older library rows that are missing size/import date, duration/sample-rate, or analysis stats. When the source file still exists, `audio.list` re-reads the file, preserves the stable library id, backfills imported-at from the file creation/modification time when needed, and writes the repaired row back after the SQLite read cursor closes.
- Native audio deletion now has a bounded IPC path. `audio.delete` removes selected rows by stable id and deletes the physical file only when it lives inside Beat's managed audio-library folder, returning deleted ids plus failed ids/paths so the UI can keep failed rows visible.
- `BeatBackendStress` verifies deterministic peak/RMS/crest/correlation math, clipping detection, parity between in-memory analysis and streaming file analysis, and bounded stereo waveform buckets against synthetic stereo fixtures.

Aether/native wavetable rendering now separates expensive table generation from voice playback:

- Harmonic/custom-frame synthesis happens once per unique wavetable config key and produces immutable `Wavetable` data.
- `InstrumentVoice` instances share those immutable tables via a bounded setup-time cache instead of rebuilding identical legacy/Aether tables for every polyphonic voice.
- Oscillators still hold raw const table pointers during render, so the audio thread stays lock-free and table lookup remains a two-frame/two-sample interpolation path.
- The cache is capped and only touched during patch/setup work; active voices keep shared ownership of any table they are rendering even if the cache later evicts that key.
- `instrument.renderPreview` renders a bounded one-note instrument preview through the same isolated offline engine used by WAV export, then returns native render analysis plus waveform buckets. Callers can request an `audioDataUrl` for a compact rendered WAV preview, allowing synth/Aether audition to share the same native render path as the displayed waveform/analysis instead of duplicating synthesis in React.
- The Home Instruments page uses actual sample waveforms for sampler instruments and native/rendered synth waveforms for synth/Aether instruments. Sampler preview cycles through associated sample files deterministically, while synth/Aether preview sustains until pause. Sample instruments also expose their associated audio-file structure: single sample, hit variance, velocity/volume layers, length layers, and pitch zones. The first management pass lets users reorder associated sample paths, choose the visible grouping intent, and save/revert that structure back onto `sampleUrls`/`sampleMap` metadata.

Project document IO has a frontend validation/migration gate:

- `.beat` documents must declare the current schema version.
- Project basics are validated before hydration: id/name, BPM, time signature, length, tracks, effect chain, and required arrays.
- User-installed plugin adapters are now included in `.beat` documents so plugin-derived instruments and plugin effect placeholders preserve their source adapter metadata.
- Unsupported schema versions or trackless/malformed projects are rejected before they can replace the current store/engine snapshot.
- Native `.beat` saves now respect Save versus Save As. Save reuses the known file path, Save As forces the native picker, and writes go through a temporary file before replacing the project file.
- When Save overwrites an existing `.beat`, the backend copies the previous good file into a sibling `<project name> Backups` folder before replacement. The folder keeps a stable `Latest.beat` plus timestamped snapshots, giving recovery tooling a deterministic rollback source. Backup listing and restore helpers are backend-safe: restore rejects paths outside the project backup folder, validates the backup JSON, runs document-integrity checks, rejects fatal structural errors, stages through a temp file, and creates one more backup of the current project before replacing it. The app menu now exposes recovery for the current project when a native file path exists.
- Native `.beat` saves package external audio/sample assets into a sibling `<project name> Assets` folder and write relative paths into the saved document. Native open resolves those relative paths back to absolute file paths before hydrating the frontend/engine.
- Native `.beat` open reports missing manifest/audio/sample assets back to the frontend, which warns the user after load instead of silently hiding broken sample dependencies.
- Native `.beat` open also returns the full backend project-integrity report alongside missing assets, so future UI can separate missing references, orphaned sidecar warnings, duplicate IDs, and structural errors without reparsing the file in React. Fatal structural integrity errors now block native Open before hydration; missing asset references remain openable so relink flows can recover user work.
- Native recent projects are now owned by `ProjectRepository` rather than bridge-local SQL helpers. The backend stress suite verifies deterministic recent ordering, missing-file flags, removal, and document-derived display names.
- `ProjectIntegrityVerifier` is now a backend persistence helper for document safety checks outside the UI. It verifies schema support, project/track/segment IDs, segment timing, audio/instrument/plugin references, manifest asset paths, sidecar asset existence, and unused sidecar files. Native Save runs this verifier after sidecar packaging and before temp-file write/replace, so a document with broken internal references is rejected before it can overwrite the current project file. The backend stress suite covers a clean packaged project, a deleted packaged sample, and a sidecar orphan warning.
- `cleanupUnusedProjectSidecarAssets` is the backend cleanup primitive for project asset folders. It gathers every sidecar file referenced by the document manifest, audio files, and sample-backed instruments, then deletes only unreferenced files inside the sibling `<project name> Assets` folder. Native Save runs this cleanup after the new `.beat` file has been atomically finalized and returns the cleanup report alongside the saved path. `project.cleanupAssets` also exposes the same helper through IPC for future asset-management UI. The cleanup report includes deleted/failed paths instead of silently swallowing failures, and stress coverage verifies that orphan files are removed while referenced packaged assets are preserved.
- New/Open/Save menu and hotkey paths share document-action helpers, so dirty checks and transport reset behavior stay consistent.
- `npm run verify:documents` covers representative `.beat` migration/fingerprinting for instruments, audio files, components, plugin adapters, plugin effect nodes, and effect automation lanes.

Native startup now has a shell-level loading buffer:

- `Beat.app` shows a native JUCE splash overlay with the app logo and an indeterminate progress bar while the WebView and persisted libraries hydrate.
- The React frontend sends `app.ready` only after instruments, components, and audio files have completed their startup load attempts.
- The native shell hides the splash on `app.ready`, with a fallback timeout so a broken frontend cannot permanently block the app window.

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

The frontend exposes current render cost through `RenderTimingPanel`, mounted globally from `App.tsx`. It reads `useAnalyzerStore().renderTiming` and shows callback load plus per-phase timings. Voice work is split into oscillator samples, wavetable voice samples, Aether oscillator A/B/sub/noise samples, raw filter samples, filter-drive samples, filter coefficient updates, modulation samples, ramp samples, and oscillator-rate calculations so dense synth patches can be profiled without guessing where CPU is going.

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
npm run verify:documents
npm run build
npm run verify:drums
cmake --build build-native --target BeatBackendStress
cmake --build build-native --target Beat
build-native/bin/BeatBackendStress
node --check frontend/public/worklets/aether-preview-worklet.js
curl -I http://127.0.0.1:4174/worklets/aether-preview-worklet.js
```

The local in-app browser automation context did not expose `AudioContext`, so it could not execute the WebAudio graph directly from automation. The worklet file was still syntax-checked, built, copied into `dist`, and confirmed served by the preview server. A manual audible audition in the actual app remains the best final check for the worklet path.

## Near-Term Engine Plan

1. Keep buffer rendering only for export, fallback, sample playback, and deterministic tests.
2. Expand tests for rapid preview restart, high-polyphony unison patches, and dense overlapping automation.
3. Add frontend controls for segment and project automation targets beyond pitch.
4. Add broader export/offline render coverage for region export and plugin-delay compensation once those systems exist.
5. Split the large frontend bundle once the current synth/drum architecture settles.
