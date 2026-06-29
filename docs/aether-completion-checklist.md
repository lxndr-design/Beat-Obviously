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
- `[x]` Runtime macro semantics.
  - Done: macro labels, ranges, curves, visible assignment summaries, visible macro source lanes for raw value/range/output/targets, structured macro conflict rows with target/source/summed behavior for overlapping modulation targets, browser static route math, browser live-preview parity that keeps macro routes dynamic instead of baking them into base preview values, native macro range/curve parsing, first-class voice macro state, macro route storage in dynamic targets, and `macro.1`-`macro.4` realtime/note automation with backend no-leak stress.
  - Proof: document roundtrip verifier covers macro definitions/routes inside Aether preset-grade patches; synth verifier covers macro lane state, macro conflict summary/detail detection, and browser dynamic macro-route preview semantics.
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
- `[x]` Deeper waveform drawing semantics.
  - Done: explicit Freehand/Additive editor modes, waveform drawing locked to Freehand mode, harmonic partial drawing and additive partial presets in Additive mode, and bounded scan-anchor editing that keeps endpoints fixed and middle frames from crossing neighbors.
  - Proof: synth verifier covers additive partial presets and bounded scan-anchor math; browser smoke verified Freehand/Additive controls, additive preset tools, and scan constraint labels on a mixed-era Aether wavemap fixture.
- `[x]` Richer FFT/resynthesis analysis.
  - Done: deterministic browser/native source provenance fields, deterministic full/transient/sustain/manual imported-audio selection windows, native IPC selection support, absolute source-range frame metadata, per-frame RMS/peak/zero-cross/roughness/asymmetry/centroid/dominant-harmonic analysis metadata, Solid import mode controls, visible manual range picker controls for imported audio, and deeper analysis display controls.
  - Proof: deterministic fixture import that produces stable frame metadata and audible/rendered differences; synth verifier covers manual range normalization/clamping, selected sample windows, and analysis summary aggregation; browser smoke verified Manual mode shows Start/End controls, updates the `20-65%` range readout, and moves the visual range strip to the same span; browser smoke also verified the Details analysis view exposes analyzed frame count, RMS, peak, zero-crossing, roughness, asymmetry, centroid, dominant harmonic, and source sample span.
- `[~]` Wavemap preset/version migration.
  - Done: JS synth verifier covers mixed-era wavemap metadata migration, including legacy-only `customWavetables`, modern `wavemaps` precedence for duplicate IDs, schema/default backfill, source sanitization, frame completion, and alias mirroring; native synth-contract stress covers the same mixed-era old/current map merge for Aether oscillator custom frames; document roundtrip verifier preserves legacy-only wavemap metadata and oscillator references in saved `.beat` instruments; true browser smoke loads and deletes an older mixed-era preset record exposed through the preset dropdown.
  - Remaining: none for current wavemap preset migration coverage; keep adding fixtures when the preset schema changes.
  - Proof: JS synth verifier covers mixed-era old/current wavemap shape normalization; `BeatBackendStress` covers native old/current map merge and current repository roundtrip for Aether wavemap frame controls; document verifier covers legacy-only wavemap preservation and dirty fingerprint sensitivity; browser smoke verified the mixed-era preset selected `user.modern`, rendered the modern duplicate instead of stale legacy data, preserved the legacy-only `user.legacy-only` Oscillator B wavemap, and removed the preset after Delete.

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
- `[x]` Aether FX rack UI.
  - Done: dedicated Solid instrument FX rack controls, add/remove/reorder/bypass affordances, latency/tail badges, shared effect defaults/specs, preset save/load/delete controls, and synth patch/instrument roundtrip for instrument-owned FX.
  - Remaining: none for the current FX rack and preset fixture plan; keep adding browser smoke when new effect kinds or preset fields land.
  - Proof: synth roundtrip verifier, frontend interaction verifier for preset state transitions, true browser smoke for current instrument preset Save As/load/delete controls, true browser smoke for current FX preset save/load/delete controls, true browser smoke for older mixed-era FX preset load/delete with default-filled params, plus existing live/export parity stress for a patch with instrument FX and track FX.
- `[ ]` Named Aether effect/instrument preset library.
  - Done: schema-versioned local instrument preset records, schema-versioned local instrument-effect chain presets, legacy record normalization, explicit Save As preset, user preset load/delete, Restore Init action, and FX preset save/load/delete.
  - Remaining: curate factory/user preset library UX beyond the local Save As lists.
  - Proof: synth verifier covers schema creation/migration; frontend interaction verifier covers Save As/load/delete/Restore Init state transitions, including mixed-era wavemap user preset loading; document roundtrip verifier covers preset-grade Aether synth patches, macro routes, custom wavemap analysis metadata, and instrument-owned FX; backend stress covers native repository roundtrip for Aether oscillator/sub/noise config, wavemap frame controls/partials, macro values/routes, Env 2, and instrument-owned FX.
- `[x]` Aether FX preset/version migration.
  - Proof: synth and interaction verifiers cover legacy effect-default normalization; true browser smoke loads and deletes an older mixed-era FX preset, preserving authored reverb/delay values while filling missing default params; document roundtrip verifier and backend stress cover current instrument-owned FX chains.

## 6. UI And Editing Workflow

- `[x]` Solid synth editor shell with analyzer, oscillator, modulation, LFO, macro, and filter controls.
- `[x]` Browser/native preview paths for current core Aether parameters.
- `[~]` Fast editing workflow.
  - Remaining: reduce one-off controls inside synth surfaces, unify range fields/sliders/selects against the Solid UI kit, and make assignment/automation states readable at a glance.
  - Proof: `verify-design-system`, interaction verifier coverage, and manual preview pass.
- `[~]` Note/segment automation UI.
  - Done: backend/native note and segment automation paths; native IPC mapping from frontend Track Details `track.automation` into backend project automation lanes with track and instrument IDs; first visible piano-roll note automation lane selector/badges for pitch, wavemap, filter, amp, and macro targets; selected-note start/mid/end value editing for visible Aether lanes; draggable start/mid/end point handles for visible piano-roll lanes; visible selected-note point beat/value/add/remove controls; curve selection for visible note lanes; document roundtrip coverage for note-lane curve metadata; browser preview coverage proving note-lane curves change Aether macro automation output; macro note lanes drive macro-routed browser preview output; note automation point timing is preserved during note drag/copy/paste; first visible Segment Editor Aether segment lane selector for wavemap, filter, amp, and macro targets; segment-lane start/mid/end value editing, curve selection, segment-local beat clipping, document roundtrip coverage, and visible segment point beat/value/add/remove controls; first visible Track Details Aether track lane selector for wavemap, filter, amp, and macro targets; track-lane start/mid/end value editing, curve selection, project-timeline beat clipping, document roundtrip coverage, visible track point beat/value/add/remove controls, point-level add/move/delete helpers for note, segment, and track Aether lanes, point-level quantize/value snapping helpers and controls for note, segment, and track Aether lanes, first visible arrangement-view Aether track automation lane preview, arrangement-view drag editing for existing Aether track automation points, and arrangement-view add/remove controls for Aether track automation points.
  - Remaining: fuller browser interaction parity coverage for arbitrary multi-point edits, plus multi-select/copy-paste polish.
  - Proof: editor interaction tests for note, segment, and track lane creation/value-edit/drag-value helpers, point add/move/delete helpers, point quantize/value snapping helpers, no-clutter behavior when snapping missing lanes, document verifier coverage for note-lane curve metadata plus segment-lane and track-lane persistence, audio-boundary verifier coverage for frontend track automation to native project automation mapping, synth verifier coverage for macro-lane preview output and curve-shaped preview output, true browser fixture smoke for rendered Aether track, segment, and selected-note Macro 1 lane entrypoints, browser smoke for visible note/segment/track point editor panels, and dense native Aether live/export parity stress covering multi-point note, segment, project, and track-scoped Aether automation lanes.

## 7. Verification Gates Still Needed

- `[x]` Aether-specific stress for high polyphony, high unison, dense modulation, and rapid parameter edits.
- `[x]` Backend stress for render-work counters, wavetable cache stats, note-local pitch/parameter/phase automation, glide, mono/legato, LFOs, envelopes, and modulation helpers.
- `[x]` Dense overlapping automation parity stress with high-polyphony Aether patches.
  - Covers project, track-scoped, segment, note, route, instrument-effect, track-effect, macro, and master EQ automation in one live/export parity render, with a stripped-automation baseline proving the automation materially changes output.
- `[ ]` Null-test style live/offline comparisons where deterministic output is expected.
- `[~]` Browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, and note automation lanes.
  - Done: browser fixture coverage now proves seeded Aether track, segment, and selected-note Macro 1 automation lane entrypoints render with live controls.
  - Remaining: broader synth editing, wavemap import/draw, macro assignment, arbitrary multi-point lane editing, and full note automation interaction flows.
- `[x]` Preset migration fixtures once Aether preset storage is formalized.
  - Done: JS synth verifier covers mixed-era wavemap metadata migration and legacy Aether/FX preset record normalization; backend stress covers native mixed-era wavemap map merging; document verifier covers legacy-only wavemap metadata preservation; frontend interaction verifier covers mixed-era wavemap user preset load/delete flow; true browser smoke covers current Aether instrument preset Save As/load/delete; true browser smoke covers older mixed-era wavemap preset load/delete through the preset dropdown; true browser smoke covers older mixed-era FX preset load/delete through the FX preset dropdown.
  - Remaining: none for the current preset migration fixture plan; add new fixtures alongside any future preset schema changes.

## Near-Term Slice Order

1. Add browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, arbitrary multi-point lane editing, and broader note/segment/track automation interactions.
2. Add fuller browser interaction coverage for arbitrary multi-point automation edits.
3. Curate the named Aether instrument/effect preset library UX beyond local Save As lists.
