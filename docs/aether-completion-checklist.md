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
  - Done: macro labels, ranges, curves, visible assignment summaries, browser static route math, native macro range/curve parsing, first-class voice macro state, macro route storage in dynamic targets, and `macro.1`-`macro.4` realtime/note automation with backend no-leak stress.
  - Remaining: browser preview parity for live macro route changes, visible macro lanes, and conflict display.
  - Proof: document roundtrip verifier covers macro definitions/routes inside Aether preset-grade patches; browser preview and editor interaction coverage for macro lanes still needed.
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
  - Done: deterministic browser/native source provenance fields, deterministic full/transient/sustain/manual imported-audio selection windows, Solid import mode controls, native IPC selection support, absolute source-range frame metadata, and per-frame RMS/peak/zero-cross/roughness/asymmetry/centroid/dominant-harmonic analysis metadata.
  - Remaining: visual/manual range picker polish and deeper analysis display controls.
  - Proof: deterministic fixture import that produces stable frame metadata and audible/rendered differences.
- `[~]` Wavemap preset/version migration.
  - Done: JS synth verifier covers mixed-era wavemap metadata migration, including legacy-only `customWavetables`, modern `wavemaps` precedence for duplicate IDs, schema/default backfill, source sanitization, frame completion, and alias mirroring; native synth-contract stress covers the same mixed-era old/current map merge for Aether oscillator custom frames; document roundtrip verifier preserves legacy-only wavemap metadata and oscillator references in saved `.beat` instruments.
  - Remaining: browser preset-flow smoke once older preset fixtures are exposed in the UI.
  - Proof: JS synth verifier covers mixed-era old/current wavemap shape normalization; `BeatBackendStress` covers native old/current map merge and current repository roundtrip for Aether wavemap frame controls; document verifier covers legacy-only wavemap preservation and dirty fingerprint sensitivity.

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
  - Done: dedicated Solid instrument FX rack controls, add/remove/reorder/bypass affordances, latency/tail badges, shared effect defaults/specs, preset save/load/delete controls, and synth patch/instrument roundtrip for instrument-owned FX.
  - Remaining: browser smoke for older/mixed-era FX preset fixtures.
  - Proof: synth roundtrip verifier, frontend interaction verifier for preset state transitions, true browser smoke for current instrument preset Save As/load/delete controls, true browser smoke for current FX preset save/load/delete controls, plus existing live/export parity stress for a patch with instrument FX and track FX.
- `[ ]` Named Aether effect/instrument preset library.
  - Done: schema-versioned local instrument preset records, schema-versioned local instrument-effect chain presets, legacy record normalization, explicit Save As preset, user preset load/delete, Restore Init action, and FX preset save/load/delete.
  - Remaining: fuller true browser coverage for older/mixed-era instrument and FX preset fixtures.
  - Proof: synth verifier covers schema creation/migration; frontend interaction verifier covers Save As/load/delete/Restore Init state transitions, including mixed-era wavemap user preset loading; document roundtrip verifier covers preset-grade Aether synth patches, macro routes, custom wavemap analysis metadata, and instrument-owned FX; backend stress covers native repository roundtrip for Aether oscillator/sub/noise config, wavemap frame controls/partials, macro values/routes, Env 2, and instrument-owned FX.
- `[ ]` Aether FX preset/version migration.
  - Proof: synth and interaction verifiers cover legacy effect-default normalization; document roundtrip verifier and backend stress cover current instrument-owned FX chains.

## 6. UI And Editing Workflow

- `[x]` Solid synth editor shell with analyzer, oscillator, modulation, LFO, macro, and filter controls.
- `[x]` Browser/native preview paths for current core Aether parameters.
- `[~]` Fast editing workflow.
  - Remaining: reduce one-off controls inside synth surfaces, unify range fields/sliders/selects against the Solid UI kit, and make assignment/automation states readable at a glance.
  - Proof: `verify-design-system`, interaction verifier coverage, and manual preview pass.
- `[~]` Note/segment automation UI.
  - Done: backend/native note and segment automation paths; first visible piano-roll note automation lane selector/badges for pitch, wavemap, filter, amp, and macro targets; selected-note start/mid/end value editing for visible Aether lanes; draggable start/mid/end point handles for visible piano-roll lanes; curve selection for visible note lanes; document roundtrip coverage for note-lane curve metadata; browser preview coverage proving note-lane curves change Aether macro automation output; macro note lanes drive macro-routed browser preview output; note automation point timing is preserved during note drag/copy/paste.
  - Remaining: track and segment automation lane surfaces, arbitrary multi-point lane editing, and fuller playback/live-export parity coverage.
  - Proof: editor interaction tests for lane creation/value-edit/drag-value helpers, document verifier coverage for note-lane curve metadata, synth verifier coverage for macro-lane preview output and curve-shaped preview output, plus future browser/editor interaction tests for arbitrary multi-point lane editing.

## 7. Verification Gates Still Needed

- `[x]` Aether-specific stress for high polyphony, high unison, dense modulation, and rapid parameter edits.
- `[x]` Backend stress for render-work counters, wavetable cache stats, note-local pitch/parameter/phase automation, glide, mono/legato, LFOs, envelopes, and modulation helpers.
- `[x]` Dense overlapping automation parity stress with high-polyphony Aether patches.
  - Covers project, segment, note, route, instrument-effect, track-effect, macro, and master EQ automation in one live/export parity render, with a stripped-automation baseline proving the automation materially changes output.
- `[ ]` Null-test style live/offline comparisons where deterministic output is expected.
- `[ ]` Browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, and note automation lanes.
- `[~]` Preset migration fixtures once Aether preset storage is formalized.
  - Done: JS synth verifier covers mixed-era wavemap metadata migration and legacy Aether/FX preset record normalization; backend stress covers native mixed-era wavemap map merging; document verifier covers legacy-only wavemap metadata preservation; frontend interaction verifier covers mixed-era wavemap user preset load/delete flow; true browser smoke covers current Aether instrument preset Save As/load/delete.
  - Remaining: true browser-level preset-flow smoke for older wavemap preset records.

## Near-Term Slice Order

1. Add an instrument FX rack UI backed by existing instrument-owned FX rendering.
2. Tighten wavemap drawing/resynthesis editing semantics beyond deterministic source/frame analysis metadata.
3. Add visible note/segment automation lanes for the Aether targets.
4. Add Aether preset storage, Save As preset flow, and migration fixtures.
