# Aether Completion Checklist

This checklist tracks the remaining work to move Aether from a strong prototype to a completion-ready Beat instrument. The broader DAW roadmap lives in `docs/serum-style-synth-roadmap.md`; this file is the focused Aether burn-down list.

Status legend:

- `[x]` done and covered by build, stress, verifier, or runtime evidence.
- `[~]` partially done; usable but not final.
- `[ ]` not done or only placeholder-level.

## 1. Runtime Synth Engine

- `[x]` Native wavetable oscillator, cached frame selection, interpolation, shared table cache, unison planning, and basic factory tables.
- `[x]` Aether oscillator A/B, sub, noise, unison, detune, spread, pan, level, phase, random phase, mono, legato, glide, pitch bend, mod wheel, velocity, and keytracking.
- `[x]` Bounded CPU behavior for built-in oscillator polyBLEP, route nonlinear oversampling, Aether filter-drive oversampling, zero-drive bypass, cached pan, cached pitch-rate math, quantized wavetable frequency/position updates, and render-work counters.
- `[x]` Continue thinning `InstrumentVoice`.
  - Done: envelope shaper, LFO helper, dynamic-modulation helpers, oscillator helpers, Aether table-stack renderer, filter stage, drive stage, wavetable cache/table ownership, wavetable oscillator-bank rendering, wavetable unison planning, Aether pan/pitch cache helpers, voice math helpers, render-stat types, per-block render-work assembly, note-automation inbox/types/runtime state, realtime ramp state, realtime parameter mapper/application, active-ramp bookkeeping, and voice allocation.
  - Remaining: none for the current extraction plan; keep direct backend stress for any future extraction.
- `[ ]` Add heavier nonlinear warp experiments only after the oversampling strategy is extended to any runtime warp stage.
  - Proof: backend stress showing bounded work counters, continuity across block boundaries, and dense Aether route stability.

## 2. Modulation, Macros, And Note Automation

- `[x]` Dynamic modulation routes exist for LFO 1, LFO 2, Env 1, Env 2, velocity, keytrack, and mod wheel to oscillator, filter, amp, and unison targets.
- `[x]` Per-note native/browser lanes cover pitch, amp level/pan, filter cutoff/resonance/drive, oscillator position/fine/level/pan/phase, and unison detune/spread.
- `[~]` Runtime macro semantics.
  - Done: macro labels, ranges, curves, visible assignment summaries, and browser/native static route math.
  - Remaining: first-class voice-level macro state so macro lanes can modulate routed targets at runtime instead of being baked into patch parameters at parse time.
  - Proof: browser preview, native parser, `InstrumentVoice`, sequencer note automation, project/document roundtrip, and backend no-leak stress for macro lanes.
- `[~]` Modulation matrix UX.
  - Done: target/source selection and visible assignments.
  - Remaining: semantic cleanup for per-target range displays, conflict clarity, disabled route states, and source-specific editing affordances.
  - Proof: design-system/interaction verifier coverage for route add/edit/remove/disable and assignment display.
- `[ ]` Automation conflict rules.
  - Define precedence for project, segment, note, live knob, and macro writes.
  - Proof: backend sequencer stress for overlapping targets and frontend editor tests for the displayed effective value.

## 3. Wavemap Drawing And Resynthesis

- `[x]` First-class wavemap metadata with legacy custom-wavetable compatibility.
- `[x]` Audio-file wavemap import through Solid editor and native IPC, with deterministic browser/native resynthesis.
- `[x]` Phase-aware harmonic partial extraction, deterministic normalize/evolve transforms, 16-bin partial drawing, per-frame skew/tilt/focus/formant/notch/phase controls, direct mini-waveform sketching, editable scan anchors, interpolation mode, and wavemap morph.
- `[~]` Deeper waveform drawing semantics.
  - Remaining: richer draw modes beyond the current mini-waveform/partial lanes, clearer frame editing constraints, and intentional tools for additive-vs-freehand editing.
  - Proof: browser preview differences, native table generation differences, patch persistence, verifier snapshots, and backend stress for cache identity.
- `[~]` Richer FFT/resynthesis analysis.
  - Remaining: more informative analysis controls, better transient/frame selection, and source metadata that explains how a wavemap was derived.
  - Proof: deterministic fixture import that produces stable frame metadata and audible/rendered differences.
- `[ ]` Wavemap preset/version migration.
  - Add explicit migration for older wavemap schema versions once the current editing semantics settle.
  - Proof: JS document verifier plus native repository roundtrip for old and current wavemap shapes.

## 4. Envelopes, LFOs, And Performance Controls

- `[x]` Env 1 and Env 2 curve shapes, loop modes, Solid controls, browser preview, native parser, runtime shaping, and stress coverage.
- `[x]` LFO 1/2 waveform, tempo sync, one-shot, smoothing, phase, random phase, retrigger, browser/worklet preview, native render, and stress/verifier coverage.
- `[~]` Deeper envelope editing.
  - Remaining: richer envelope visual editing, better loop/curve handles, and clearer assignment feedback.
  - Proof: interaction tests for handle movement, patch roundtrip, browser preview, and native render stress.
- `[~]` Performance/expression UX.
  - Done: filter keytracking, keytrack routing, mod wheel routing, runtime pitch bend, linked-note glide, max voice caps, note stealing, mono voice caps, and legato retune.
  - Remaining: clearer editor controls and visible feedback for expression sources.

## 5. Aether FX And Presets

- `[x]` Instrument-owned FX chains render through the same route FX processor before track FX and share live/export parity behavior.
- `[~]` Aether FX rack UI.
  - Remaining: dedicated instrument FX rack controls, add/remove/reorder/bypass affordances, latency/tail badges, and preset handoff.
  - Proof: interaction verifier plus live/export parity stress for a patch with instrument FX and track FX.
- `[ ]` Named Aether effect/instrument preset library.
  - Include schema versioning, migration, save-as-new preset, delete, and restore default behavior.
  - Proof: document verifier, native repository roundtrip, and UI interaction coverage.
- `[ ]` Aether FX preset/version migration.
  - Proof: migration fixtures for old effect defaults and current instrument-owned FX chains.

## 6. UI And Editing Workflow

- `[x]` Solid synth editor shell with analyzer, oscillator, modulation, LFO, macro, and filter controls.
- `[x]` Browser/native preview paths for current core Aether parameters.
- `[~]` Fast editing workflow.
  - Remaining: reduce one-off controls inside synth surfaces, unify range fields/sliders/selects against the Solid UI kit, and make assignment/automation states readable at a glance.
  - Proof: `verify-design-system`, interaction verifier coverage, and manual preview pass.
- `[~]` Note/segment automation UI.
  - Done: backend/native note and segment automation paths.
  - Remaining: visible lanes in track/piano-roll/segment editors for pitch, level, phase, filter, wavetable position, and macro targets.
  - Proof: editor interaction tests for lane creation, point drag, curve selection, and playback preview.

## 7. Verification Gates Still Needed

- `[x]` Aether-specific stress for high polyphony, high unison, dense modulation, and rapid parameter edits.
- `[x]` Backend stress for render-work counters, wavetable cache stats, note-local pitch/parameter/phase automation, glide, mono/legato, LFOs, envelopes, and modulation helpers.
- `[ ]` Dense overlapping automation parity stress with high-polyphony Aether patches.
  - Cover project, segment, note, route, and effect automation in one render.
- `[ ]` Null-test style live/offline comparisons where deterministic output is expected.
- `[ ]` Browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, and note automation lanes.
- `[ ]` Preset migration fixtures once Aether preset storage is formalized.

## Near-Term Slice Order

1. Add runtime macro state and macro lane automation with backend no-leak stress.
2. Add dense overlapping Aether automation parity stress.
3. Add an instrument FX rack UI backed by existing instrument-owned FX rendering.
4. Tighten wavemap drawing/resynthesis semantics and add deterministic fixtures.
5. Add visible note/segment automation lanes for the Aether targets.
6. Add Aether preset storage, Save As preset flow, and migration fixtures.
