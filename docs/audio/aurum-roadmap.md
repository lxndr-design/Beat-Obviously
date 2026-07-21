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
- `[x]` Separate bipolar FM and ring/amplitude-modulation matrices render, persist, and share a bounded one-sample-delayed routing model.
- `[x]` Operator release values control note-off independently in browser and native rendering; native voice lifetime follows the longest enabled operator tail.
- `[x]` Native feedback routes reject non-finite values, clamp route depth and stored feedback state, and pass dense bipolar matrix stress across 44.1, 48, and 96 kHz with 1-to-4096-sample blocks and maximum unison.
- `[x]` Aurum has deterministic native live/export parity fixtures at 44.1, 48, and 96 kHz, including stereo WAV metadata and bounded residual checks.

Exit gate: identical patches survive save/load, produce finite audible browser/native output, and remain bounded under dense bipolar feedback and high unison.

## M2: Operator depth

- `[x]` Basic sine, triangle, saw, and square sources with ratio, coarse, fine, phase, level, and ADSR controls.
- `[x]` Each operator has an editable 16-partial additive spectrum with bounded normalization, Nyquist suppression, browser/native rendering, and versioned persistence.
- `[x]` Every operator has bounded wavefold shaping, versioned persistence, matching browser/native rendering, and a live scope driven by the browser engine sampler.
- `[x]` Each operator has independent amplitude, pitch, and phase ADSRs; pitch and phase use bipolar depths, persist in schema v5, and render consistently in browser and native paths.
- `[x]` Each operator has editable five-point velocity and keyboard gain-response curves with neutral migration, browser/native rendering, and versioned persistence.
- `[x]` Selectable 1x, 2x, and 4x operator-network quality runs FM, feedback, RM, and wavefold at the internal rate with box-filter decimation, bounded convergence checks, and explicit work scaling.

Exit gate: operator edits agree between waveform preview and rendered audio, and cross-rate reference tests meet a documented threshold.

## M3: Filter and signal routing

- `[x]` Two independently enabled multimode output filters expose cutoff, resonance, and drive in browser and native paths.
- `[x]` Serial and Parallel filter routing persists in schema v8; legacy patches migrate their shared output filter into Filter A with Filter B bypassed.
- `[x]` A dedicated 6 x 3 bipolar output matrix routes every operator to Filter A, Filter B, or Direct; Serial routing feeds Filter A into Filter B while Parallel keeps both filter buses independent.
- `[x]` Per-operator pan renders before Aurum bus filtering, while the completed stereo mix reuses Beat's instrument FX, track FX, and send/return routing.
- `[x]` Live signal-flow diagnostics classify carriers, modulators, disconnected or zero-level operators, active output buses, and fully silent patches.

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

1. Add operator initialize, copy, paste, swap, and reset commands.
2. Add algorithm templates for common FM topologies.
