# Serum-Style Synth Roadmap

## Goal

Build a serious in-app synth instrument, inspired by Serum-style sound design, without trying to clone Serum feature-for-feature immediately.

Target outcome:

- Stable DAW backend.
- High-quality wavetable synth voice.
- Visible and editable modulation.
- Spectrum/analyzer feedback.
- Preset-ready architecture.
- Real-time safe audio behavior.

Non-goals for the first execution pass:

- Full Serum 2 parity.
- Plugin export as VST/AU.
- Full spectral resynthesis editor.
- MPE/modular routing.
- Commercial-grade preset browser polish.

Implementation notes:

- Current audio-engine decisions and verification commands live in `docs/audio-engine.md`.

## Milestone 0: Stabilize The Host

Purpose: make sure the DAW/synth container is trustworthy before adding more complexity.

Checklist:

- Verify play/pause/restart/seek behavior under rapid user input.
- Confirm no backend/UI transport split-brain.
- Confirm audio thread does not block on UI/project locks.
- Confirm no callback-time allocations in common render path.
- Add stress tests for sequencer events, transport, analyzer, and note on/off bursts.
- Add panic path: all notes off, clear stuck voices, reset sustained notes.
- Add CPU timing markers around synth render, sample render, master FX, and analyzer.

Done when:

- Rapid transport spam does not freeze controls.
- No stuck playhead after pause.
- No sustained notes after stop/restart.
- Backend stress test passes repeatedly.
- Callback hot path has documented no-lock/no-allocation expectations.

## Milestone 1: Real Wavetable Oscillator Core

Purpose: create the first serious synth subsystem.

Checklist:

- Define `Wavetable` data model:
  - frames
  - frame size
  - sample rate assumptions
  - normalized table data
  - metadata/name/source
- Add wavetable oscillator per voice.
- Implement frame interpolation.
- Implement phase accumulator.
- Implement pitch-to-frequency conversion.
- Add selectable basic tables:
  - sine
  - saw
  - square
  - triangle
  - PWM-like shape
- Add wavetable position parameter.
- Add basic oscillator controls:
  - octave
  - semitone
  - fine tune
  - level
  - pan
  - phase
  - random phase
- Add anti-aliasing strategy:
  - first acceptable version: mipmapped tables or bandlimited generated tables
  - avoid naive high-frequency saw/square playback
- Add unit/stress tests:
  - no NaN/Inf
  - stable phase wrap
  - frequency accuracy
  - interpolation bounds
  - high-note alias sanity check

Done when:

- One synth voice can play a wavetable cleanly across the keyboard.
- Wavetable position moves smoothly.
- Oscillator does not explode at extreme pitch/modulation values.
- CPU cost is predictable.

## Milestone 2: Voice Architecture Upgrade

Purpose: make each note musically controllable.

Checklist:

- Define `SynthVoiceState`.
- Add voice allocation policy.
- Add voice stealing policy.
- Add per-voice ADSR envelope.
- Add per-voice filter state.
- Add glide/portamento.
- Add mono/poly/legato modes.
- Add velocity mapping.
- Add pitch bend support.
- Add unison:
  - voice count
  - detune
  - blend
  - stereo spread
  - phase randomization
- Add oversampling option for nonlinear voice processing.

Done when:

- Polyphony feels stable.
- Unison sounds wide without phase chaos.
- Fast note bursts do not produce stuck or corrupted voices.
- Voice stealing sounds intentional.

## Milestone 3: Modulation System V1

Purpose: make the synth feel like a sound-design instrument.

Checklist:

- Define modulation sources:
  - Env 1
  - Env 2
  - LFO 1
  - LFO 2
  - velocity
  - note/keytrack
  - mod wheel
  - macro 1-4
- Define modulation targets:
  - wavetable position
  - oscillator pitch
  - oscillator level
  - filter cutoff
  - filter resonance
  - amp level
  - pan
  - unison detune
  - FX mix params later
- Add modulation routing structure:
  - source
  - target
  - amount
  - bipolar/unipolar
  - per-voice/global
- Add modulation summing rules.
- Add clamping/smoothing per target.
- Add sample-accurate or block-smoothed modulation where appropriate.
- Add tests for:
  - target bounds
  - negative modulation
  - multiple sources on one target
  - disabled routing cost
  - no NaN/Inf under extreme routes

Done when:

- LFO can move wavetable position.
- Envelope can move filter cutoff.
- Macro can control multiple targets.
- Modulation is visible in state and serializable.

## Milestone 4: Analyzer And Visual Feedback

Purpose: connect FFT/analyzer work to actual sound-design UX.

Checklist:

- Expose analyzer snapshots from backend IPC.
- Add spectrum event throttling.
- Add frontend spectrum display.
- Add level meters:
  - master RMS
  - master peak
  - maybe per-track later
- Add oscillator/wavetable display.
- Add modulation amount visual indicators.
- Add envelope/LFO visual editors.

Done when:

- User can see spectrum while audio plays.
- Analyzer does not cause audio thread blocking.
- UI updates are smooth but not spammy.
- Spectrum data survives rapid play/pause/restart.

## Milestone 5: Effects Rack V1

Purpose: make patches sound finished.

Checklist:

- Add per-instrument FX chain.
- Add effect modules:
  - filter
  - distortion
  - chorus
  - delay
  - reverb
  - compressor
  - EQ
- Add wet/dry controls.
- Add bypass per effect.
- Add parameter smoothing.
- Add oversampling for distortion where needed.
- Add modulation targets for key FX params.

Done when:

- Synth patch can be shaped without external processing.
- Effects are stateful, serializable, and automatable/modulatable.
- Bypass does not click/pop badly.

## Milestone 6: Presets And State

Purpose: make work saveable and reusable.

Checklist:

- Define synth patch schema.
- Include:
  - oscillator settings
  - wavetable reference/data
  - envelopes
  - LFOs
  - modulation routes
  - FX chain
  - macros
- Add factory presets folder.
- Add user presets folder.
- Add preset load/save.
- Add version migration.
- Add tests for patch roundtrip.

Done when:

- A patch can be saved, reloaded, and sound the same.
- Old patches can survive schema changes.
- Presets are portable inside the project.

## Milestone 7: Sound Design UI

Purpose: make the synth feel like an instrument, not a config panel.

Checklist:

- Build synth editor main view.
- Add oscillator section.
- Add wavetable display/position control.
- Add filter section.
- Add envelopes/LFO tabs.
- Add modulation matrix.
- Add macro controls.
- Add FX rack.
- Add preset browser.
- Add analyzer view.
- Make drag or click modulation assignment possible eventually.

Done when:

- A user can create a patch without touching raw project data.
- Modulation relationships are visible.
- Common controls are one or two interactions away.
- UI does not hide the sound-design state.

## Recommended Execution Order

1. Finish host/audio safety baseline.
2. Build real wavetable oscillator core.
3. Upgrade voice architecture.
4. Add modulation matrix V1.
5. Wire analyzer to UI.
6. Add FX rack.
7. Add preset system.
8. Deepen wavetable editing/import later.

## Parallel Execution Model

The work can run in parallel if each lane owns a narrow boundary and merges through agreed contracts. Avoid multiple agents editing the same files unless one agent is explicitly integrating.

### Lane A: Backend Audio Safety

Owner focus:

- `backend/Source/Audio/AudioEngine.*`
- `backend/Source/Audio/Sequencer.*`
- backend stress tests
- callback safety documentation

Primary tasks:

- Keep transport stable.
- Expand stress tests.
- Audit audio callback locks/allocations.
- Add CPU timing markers.
- Maintain panic/all-notes-off behavior.

Dependencies:

- Should not wait on UI work.
- Must review any synth voice changes for real-time safety.

### Lane B: Wavetable Oscillator DSP

Owner focus:

- wavetable data structures
- oscillator render code
- oscillator tests
- anti-aliasing/mipmapping strategy

Primary tasks:

- Implement `Wavetable`.
- Implement oscillator playback.
- Add interpolation and phase handling.
- Add basic factory tables.
- Add frequency/aliasing tests.

Dependencies:

- Needs a stable interface into the existing synth voice.
- Should avoid changing transport, IPC, or UI unless integration requires it.

### Lane C: Voice And Modulation Architecture

Owner focus:

- voice state
- envelopes/LFOs
- modulation routing model
- parameter smoothing/clamping
- patch serializable state

Primary tasks:

- Define modulation source/target IDs.
- Build route evaluation.
- Add per-voice/global modulation distinction.
- Connect Env/LFO to oscillator/filter targets.
- Keep modulation state serializable from the start.

Dependencies:

- Needs oscillator parameters from Lane B.
- Should coordinate with Lane F before freezing patch schema.

### Lane D: Analyzer And Metering UI

Owner focus:

- analyzer IPC event
- frontend spectrum/meter components
- event throttling
- UI rendering performance

Primary tasks:

- Expose `FftAnalyzer` snapshots.
- Add frontend store for spectrum data.
- Render spectrum and levels.
- Validate no UI event spam under playback.

Dependencies:

- Can proceed from the existing analyzer backend.
- Should not touch oscillator internals.

### Lane E: Synth Editor UI

Owner focus:

- synth editor layout
- oscillator panel
- envelope/LFO editors
- modulation matrix UI
- macros and FX rack surface

Primary tasks:

- Build the first usable synth editor screen.
- Add controls for oscillator and wavetable position.
- Add visual modulation indicators.
- Add editor states for envelopes/LFOs/macros.

Dependencies:

- Needs stable parameter IDs from Lanes B/C.
- Can mock unavailable backend values behind feature flags or placeholder state.

### Lane F: Presets And Project State

Owner focus:

- patch schema
- project serialization
- preset folders
- migration
- roundtrip tests

Primary tasks:

- Define versioned patch format.
- Add load/save/roundtrip tests.
- Coordinate IDs with modulation and oscillator work.
- Keep backward compatibility with existing projects.

Dependencies:

- Needs early schema agreement with Lanes B/C/E.
- Should avoid UI polish until schema is stable.

### Lane G: Effects Rack

Owner focus:

- per-instrument FX chain
- effect modules
- smoothing/bypass behavior
- modulation target exposure

Primary tasks:

- Define effect chain model.
- Add first modules.
- Add wet/dry and bypass.
- Make parameters serializable and modulatable.

Dependencies:

- Can start after basic patch schema exists.
- Should use modulation target conventions from Lane C.

## Coordination Rules

- One integrator owns `AudioEngine.*` at a time.
- One integrator owns patch/project schema at a time.
- Every new DSP subsystem needs:
  - no NaN/Inf test
  - bounds test
  - fast repeated render/stress test
  - documented real-time behavior
- UI work may mock backend state, but must use planned parameter IDs.
- Backend work may expose placeholder IPC fields, but must version them or keep them additive.
- Merge order should prefer contracts first, implementations second, UI last.

## Suggested Two-Agent Split

If two agents are active, split the work like this:

- Agent 1: Lanes A, B, and C.
- Agent 2: Lanes D, E, and F.

This keeps core DSP/audio-thread work together and frontend/state work together. The main shared contract should be a small parameter/schema document before heavy implementation starts.

## Immediate Next Step

Create the first contract document for synth parameters and patch state:

- oscillator parameter IDs
- modulation source IDs
- modulation target IDs
- patch schema version
- IPC/store boundaries

After that, Lane B can build the wavetable core while Lane E/D can build UI/analyzer surfaces against stable names.
