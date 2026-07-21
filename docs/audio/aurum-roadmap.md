# Aurum Roadmap

## Product boundary

Aurum is Beat's six-operator FM, RM, and additive instrument. Its target is a deep matrix-synthesis workflow with Beat-native editing and automation, not feature-count parity with broad hybrid synthesizers.

Lumus/Aether owns wavetable and hybrid synthesis concerns such as sample, granular, spectral, and wavetable engines. Aurum should consume shared Beat modulation, effects, preset, and automation infrastructure where practical instead of creating incompatible parallel systems.

## Status legend

- `[x]` Implemented and verified across the stated boundary
- `[~]` Foundation exists but the milestone is not complete
- `[ ]` Not implemented

## M1: Matrix correctness and release honesty

- `[~]` Six operators and a 6 x 7 operator/output matrix render in browser and native paths.
- `[x]` Bipolar FM and output sends support phase-inverted routing across UI, normalization, IPC, persistence, browser audio, and native audio.
- `[ ]` Separate FM and ring/amplitude-modulation matrices.
- `[ ]` Operator release values control note-off instead of relying only on the shared amplitude release.
- `[ ]` Feedback behavior has explicit stability limits and sample-rate/block-size stress.
- `[ ]` Aurum has native live/export parity fixtures at 44.1, 48, and 96 kHz.

Exit gate: identical patches survive save/load, produce finite audible browser/native output, and remain bounded under dense bipolar feedback and high unison.

## M2: Operator depth

- `[x]` Basic sine, triangle, saw, and square sources with ratio, coarse, fine, phase, level, and ADSR controls.
- `[ ]` Editable additive harmonic spectrum per operator.
- `[ ]` Operator waveshaping with a live waveform preview driven by engine data.
- `[ ]` Independent pitch, phase, and amplitude articulation.
- `[ ]` Velocity and keyboard tracking curves.
- `[ ]` Oversampling/quality policy for nonlinear FM, feedback, and waveshaping.

Exit gate: operator edits agree between waveform preview and rendered audio, and cross-rate reference tests meet a documented threshold.

## M3: Filter and signal routing

- `[~]` Shared output filter, resonance, and drive exist.
- `[ ]` At least two independently configurable filter modules.
- `[ ]` Bipolar operator-to-filter sends and filter-to-filter routing.
- `[ ]` Per-operator pan, direct output, and shared Beat FX sends.
- `[ ]` Visible signal-flow diagnostics for silent or disconnected patches.

Exit gate: every audible route is visible in the editor and covered by persistence plus live/export tests.

## M4: Modulation and performance

- `[ ]` Reuse Beat envelopes, tempo-synced LFOs, macros, velocity, keytrack, mod wheel, aftertouch, and automation targets.
- `[ ]` Visible modulation amounts and source summaries on Aurum controls.
- `[ ]` Mono, legato, glide, pitch bend, and voice-limit controls.
- `[ ]` Per-note expression and deterministic automation precedence.

Exit gate: modulation changes are audible in browser/native playback and do not leak between notes or voices.

## M5: Patch workflow and content

- `[ ]` Versioned Aurum preset records and migrations.
- `[ ]` Factory preset browser with tags, favorites, and search.
- `[ ]` Operator initialize, copy, paste, swap, and reset commands.
- `[ ]` Algorithm templates for common FM topologies.
- `[ ]` Undo/redo transactions for matrix and operator edits.
- `[ ]` Auditioned factory bank covering bass, bell, keys, pad, lead, percussion, and effects families.

Exit gate: patches are discoverable, portable, migration-tested, and can be edited without destructive surprises.

## M6: Release readiness

- `[ ]` High-polyphony, high-unison, dense-matrix callback stress with work counters.
- `[ ]` Browser/native/live/export bounded-difference gates.
- `[ ]` Aliasing and cross-sample-rate benchmark with documented reference methodology.
- `[ ]` Accessibility and responsive-editor browser sweep.
- `[ ]` Factory-patch listening log and regression hashes.

Exit gate: the release report distinguishes verified audio behavior, performance limits, visual coverage, and remaining product gaps.

## Immediate order

1. Finish bipolar matrix routing.
2. Make operator release truthful.
3. Add RM as a separate matrix mode.
4. Add the additive harmonic editor.
5. Add native Aurum live/export and cross-rate gates before expanding filters or content.
