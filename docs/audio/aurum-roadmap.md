# Aurum Roadmap

## Product boundary

Aurum is Beat's six-operator FM, RM, and additive instrument. Its historical behavior-reference family is Sytrus, while its target remains a deep Beat-native matrix workflow rather than a clone. The source-backed comparison lives in `aurum-sytrus-benchmark.md` and `aurum-sytrus-capability-matrix.json`.

Lumen/Aether owns wavetable and hybrid synthesis concerns such as sample, granular, spectral, and wavetable engines. Lumen retains the legacy internal `lumen-hybrid-synth` / `lumen` identifiers for project compatibility. Aurum should consume shared Beat modulation, effects, preset, and automation infrastructure where practical instead of creating incompatible parallel systems.

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

- `[~]` Aurum schema v13 reuses Beat's shared route IDs and evaluator for Envelope 1, tempo-synced LFO 1, Macro 1, Macro 2, velocity, keytrack, mod wheel, and pressure. The bounded destinations are master level/pan, level/pan for all six operators, and Filter A/B cutoff, resonance, and drive; normalized additive scaling, neutral v11/v12 migration, persistence, and audible browser/native propagation are verifier-covered. More envelopes/LFOs/macros plus operator tuning and matrix destinations remain open.
- `[~]` Aurum Main exposes a bounded eight-route shared-modulation table with source, destination, bipolar mode, enable state, amount, and a prepared Linear/Ease In/Ease Out/S-Curve response. Existing operator level/pan and filter cutoff/resonance/drive controls show compact source/amount summaries; arbitrary editable curves, master-control overlays, and deeper multi-route inspection remain open.
- `[x]` Aurum Main exposes shared mono, legato, glide, voice-limit, and persisted 0-to-24-semitone pitch-bend range controls; negotiated RPN and MPE ranges retain runtime precedence.
- `[~]` Native pressure, velocity, keytrack, and mod-wheel sources evaluate per voice. Aurum browser audition now captures the latest Web MIDI pressure, mod-wheel, timbre, velocity, and pitch-bend snapshot when audition starts, and the shared resolver verifies deterministic precedence: direct automation replaces the manual destination base, macro automation replaces the persisted macro source, and note-expression routes remain additive. Continuously changing expression during an already-rendered browser audition still requires a streaming Aurum preview path.
- `[x]` The [M4/V4 engine-evidence checkpoint](aurum-m4-evidence.md) now covers sample-exact browser rerenders for phase-envelope modulation, matrix FM, and self-feedback at 44.1, 48, and 96 kHz; audible contribution from all six routed operators; current-schema JSON roundtrip plus v1-to-v11 migration; and the existing native dense-feedback, realtime-load, and cross-rate live/export gates. This closes the engine-evidence slice, not the milestone.

Exit gate: modulation changes are audible in browser/native playback and do not leak between notes or voices.

## M5: Patch workflow and content

- `[x]` Versioned Aurum preset records share Beat's instrument-preset store and tags/favorite metadata contract; v1 JSON roundtrip, legacy nested-engine migration, identity-preserving application, and malformed/future-version rejection are verifier-covered.
- `[x]` The shared instrument-preset browser provides user save/delete plus immutable factory records, name/tag search, separate per-user favorites, reversible metadata-driven audition, and identity-safe transactional apply.
- `[x]` Operator initialize, copy, paste, swap, and reset commands use isolated parameter snapshots, fixed slot identities, and routing-aware destructive behavior.
- `[x]` Seven algorithm templates cover single, stacked, parallel, branched, feedback, and six-carrier FM topologies without replacing operator sound parameters.
- `[x]` Transactional undo/redo covers matrix, output, operator, filter, voice, name, algorithm-template, and operator-command edits; continuous drags coalesce into one bounded history step and keyboard plus visible controls share the same history.
- `[~]` Beat-authored Factory Bank v2 covers bass, bell, keys, pad, lead, percussion, and FX with stable IDs, listening intent, zero-neutral v13 performance routes, and bounded 48 kHz peak/RMS regression metrics; human listening sign-off remains open.

Exit gate: patches are discoverable, portable, migration-tested, and can be edited without destructive surprises.

## M6: Release readiness

- `[~]` A focused 48 kHz / 512-sample callback gate covers an eight-note, 4-unison, 2x dense-matrix tier and a three-note, 8-unison, 4x dense-matrix tier with Hot Route timing, exact oscillator-work counts, and zero deadline overruns. Broader supported-load tiers still need product limits and release-machine coverage.
- `[ ]` Browser/native/live/export bounded-difference gates.
- `[ ]` Aliasing and cross-sample-rate benchmark with documented reference methodology.
- `[ ]` Accessibility and responsive-editor browser sweep.
- `[ ]` Factory-patch listening log and regression hashes.

Exit gate: the release report distinguishes verified audio behavior, performance limits, visual coverage, and remaining product gaps.

## Immediate order

1. Add a streaming Aurum browser-preview path only if continuous mid-audition expression is required; preserve the verified snapshot and precedence contract before adding more destinations.
2. Add browser/native bounded-difference and spectral cross-rate gates before expanding operator cost.
3. Complete human listening sign-off and durable regression hashes for Factory Bank v2.
