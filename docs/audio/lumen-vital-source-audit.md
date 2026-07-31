# Lumen / Vital Source Architecture Audit

Reviewed: 2026-07-28
Vital snapshot: `636ca0ef517a4db087a6a08a6a8a5e704e21f836`
Reference location: `/Users/alexcheng/beat-aether-references/vital`

## Decision

Vital contains several designs that align with the Lumen roadmap, but the best next step is not a wholesale port. Lumen already has a strong immutable wavetable cache, mip/frame pointer caching, precomputed unison detune and pan plans, inactive sample/granular-slot pruning, and a per-block modulation activity plan. Replacing those systems would add licensing and regression risk without a demonstrated gain.

The highest-value lessons are:

1. Compile modulation into a sparse, rate-aware execution plan.
2. Move spectral transforms to prepared source buffers instead of repeating nonlinear work on every routed audio lane.
3. Compile the active oscillator/routing topology into a block render kernel.
4. Vectorize the remaining scalar unison loop only after those structural changes are measured.

This is a source-architecture review, not a Vital binary performance result. The public source may trail the current Vital binary, and no Vital binary was available for direct measurement.

## Current Lumen strengths to retain

| Area | Current Lumen behavior | Decision |
| --- | --- | --- |
| Wavetable lifetime | Shared immutable tables are built outside the callback and held in a bounded cache. | Retain. |
| Playback cache | Frame and mip pointers are refreshed only when frequency or position changes; exact-frame/exact-mip reads avoid unnecessary interpolation. | Retain. |
| Unison constants | Detune ratios, weights, phase spread, and stereo gains are cached in a reusable plan. | Retain. |
| Inactive sources | Disabled Sample, Multisample/SFZ, and Granular slots do not render. | Retain. |
| Modulator activity | `DynamicModulation::RenderPlan` avoids evaluating unused LFOs and envelopes. | Extend rather than replace. |
| Compatibility | Disabled Lumen extensions preserve the established Aether render contract. | Preserve with exact-output gates. |

## Ranked opportunities

### P0 — Prepared modulation execution plan

Vital separates control-rate and audio-rate connections, tracks only enabled modulation processors, and specializes the audio-rate path according to whether remapping or curve shaping is active. Its stereo modulation scaling is carried with the route rather than rediscovered at each destination.

Lumen currently discovers which sources are needed once per block, but each active target still evaluates a broad scalar sum of all possible source fields inside the sample loop. This is the clearest near-term structural gap.

Build a Beat-owned `PreparedModulationPlan` on the control/state side with a bounded array of active routes. Each entry should contain:

- source and destination identifiers;
- control-rate, bounded sub-block, or explicitly approved audio-rate policy;
- normalized amount, polarity, destination scale, and left/right coefficients;
- an optional immutable remap lookup table;
- a specialized operation kind: linear, shaped, remapped, or remapped and shaped.

The audio callback should iterate only these active entries. Control-rate entries run once per block or bounded sub-block; audio-rate entries run per sample only for destinations whose policy permits it.

Expected benefit: lower per-voice branch and arithmetic cost as route capacity grows, while directly enabling the roadmap's per-route remap, stereo split, and real audio-rate lanes.

Required gates:

- exact output for all existing patches with legacy routes;
- fixed route and scratch-buffer budgets with no callback allocation or lock;
- live/export equivalence;
- benchmark lanes at 0, 4, 16, and maximum active routes;
- telemetry for active routes, control-rate evaluations, audio-rate samples, and remap reads.

### P0 — Source-stage spectral warp buffers

Vital's spectral modes construct or select frequency-domain-derived wave buffers, reuse a shared buffer when unison lanes have identical spectral parameters, and crossfade bounded buffer transitions. The transform is paid near the oscillator source and then reused.

Lumen's two current runtime warp stages are time-domain nonlinear processors. An enabled stage is applied separately to Main, Direct, Filter 1, and Filter 2 route lanes after source routing. With two stages, stereo processing, and oversampling, a single conceptual warp can become repeated work across four lanes.

Do not replace the existing warp behavior. The first independent implementation should add Lumen-only harmonic-domain wavetable modes backed by immutable prepared buffers:

- transform harmonic/frame data off the callback or at a strictly bounded refresh point;
- key the cache by source identity, frame, spectral mode, amount, and quality;
- share a prepared buffer across unison lanes with identical keys;
- publish immutable data atomically and crossfade changes;
- retain the existing bounded table-transition path for interactive changes;
- provide harmonic shift/stretch, smear, skew, and spectral filtering as independently designed modes.

Expected benefit: a major roadmap feature and a better cost model than applying spectral-style nonlinear work to every post-routing lane.

An immediate independent optimization can precede the feature: compile an active route-lane mask and skip runtime-warp processing and work accounting for lanes that cannot contain audio or tail state.

### P1 — Sparse block render kernels

Vital disables unused producers, modulation processors, filter models, and effects. Its oscillator selects specialized distortion/window processing functions at block scope rather than branching through every possible topology for every sample.

Lumen already skips many disabled sources, but `InstrumentVoice::renderNextBlock` remains a large mixed-engine loop. Build a prepared topology record outside the callback containing active source types, route lanes, filters, warp stages, sends, and modulation classes. Select a small scalar block kernel from that record first.

Expected benefit: fewer inner-loop branches and clearer hot-path telemetry. This also creates the stable boundary needed for safe vectorization.

### P1 — Per-route remap and stereo modulation

Vital's per-connection remap curve and stereo split are better than Lumen's current fixed source-to-target amount fields. Implement these as features of the prepared modulation plan, using Beat-owned curve interpolation and schema design.

The UI should preview the transformed modulation trajectory and its left/right result before committing a route. Audio-thread state should publish only bounded control-rate readouts to the UI; the UI must not pull audio-rate buffers.

### P1 — Editable/keytracked modulators and advanced random sources

Vital's editable LFOs, keytracking, remappable curves, and stereo random sources fit the existing Lumen roadmap. The efficient implementation is to compile user shapes into immutable lookup tables and update UI telemetry at display rate, not to interpret editable point graphs per audio sample.

### P2 — SIMD unison/voice kernel

Vital packs voice and unison work into four- or eight-wide SIMD values and computes only enough phase-update groups for active lanes. This is a real scaling advantage over Lumen's scalar unison loop.

Vectorize after sparse topology and modulation planning, beginning with the wavetable read/accumulate loop. Prefer a cross-platform abstraction suitable for Apple Silicon and Intel. Keep scalar and SIMD renderers side by side until pitch, finite-output, alias, live/export, and performance gates pass.

Expected benefit: strongest at 8–16 unison and high polyphony; limited benefit for sparse one-voice patches. Risk is high because SIMD floating-point order can change hashes and edge behavior.

### P2 — Filter model kernels

Vital exposes broader filter-model choices and enables only the selected implementation. Lumen should follow that lifecycle if it adds models: one prepared active model, inactive implementations fully bypassed, and transitions explicitly crossfaded. This is a capability gap, but not the first performance project because current evidence points to voice/oscillator work rather than filters.

### P3 — Microtonal file workflow

Vital's `.scl`, `.kbd`, and `.tun` support is product-level workflow Lumen lacks. `.scl` plus `.kbd` import is relatively low DSP risk and can reuse Lumen's existing tuning representation. It is roadmap-aligned but not a performance fix.

## What is not presently a gap

- Disabled-effect pruning: Vital skips disabled effects; Beat already has ordered bypassable effect graphs and should optimize only from measured evidence.
- Wavetable cache ownership: Lumen already builds shared immutable tables outside the callback and caches hot frame/mip pointers.
- Static detune/pan math: Lumen already caches unison ratios and stereo gains rather than recalculating the expensive parts for every sample.
- Hybrid sources and Beat integration: Lumen's Sample, Multisample/SFZ, Granular, clip, MPE, routing, and arrangement integration exceed the Vital surface relevant to this audit.

## Recommended delivery sequence

1. Completed: add route/lane and modulation-work telemetry so improvements are measurable.
2. Completed: implement the prepared modulation plan while preserving legacy output exactly.
3. Partial: bounded response curves are integrated; stereo split and arbitrary editable curves remain.
4. Completed: add active route-lane masks to the existing runtime warps.
5. Foundation completed: implement independent prepared harmonic-domain warp modes behind Lumen v15; a separate time/frequency spectral source remains open.
6. Completed: split the monolithic voice loop into prepared Legacy, Aether, Lumen, and Aurum scalar topology kernels.
7. Completed: add a bounded native-SIMD accumulation path for full 16-voice Lumen wavetable unison, retaining the scalar renderer as the reference and fallback.
8. Partial: Lumen v16 per-LFO rate keytracking is integrated; `.scl`/`.kbd`, editable LFO tables, advanced random sources, and additional filter models remain separately gated slices.

## Integration status — 2026-07-28

The first compatibility slice is complete: existing modulation targets now compile into cached sparse route lists outside the sample loop, and runtime warp lanes skip silent/no-history work. No schema or instrument functionality changed. Verification and the exact preservation boundary are recorded in `docs/audio/lumen-vital-integration-2026-07-28.md`.

Bounded per-route response curves and the first Lumen v15 prepared harmonic-domain wavetable modes are now integrated independently. The new modes reuse immutable mipmapped tables and the existing shared cache, so they add no FFT, allocation, lock, or table construction to the audio callback. Their exact-bin native spur ratio is gated below `0.0001`, explicit modes produce materially distinct tables, repeat requests hit the shared cache, browser preview is distinct, and v1-v14/Aether migrations remain on Shape for unsupported future names.

The voice renderer now selects one engine-specific scalar kernel once per block. The prepared topology also stores possible Main/Direct/Filter 1/Filter 2 lanes plus compact active Lumen sample and granular indices, so disabled hybrid slots are not rediscovered inside every sample. The 8-row Lumen/Aether matrix remains output-equivalent after this refactor; its measured aggregate median wall ratio was `1.081938` and its maximum row ratio was `1.099481`. Those timings are a compatibility gate, not a before/after speedup claim.

The first SIMD slice is now integrated only at full 16-voice Lumen wavetable unison. Native-width vectors accumulate the already-rendered lane samples against prepared weight and stereo-gain groups. Table reads and phase advancement remain scalar, preserving the established oscillator state machine. Lower unison widths take the scalar path exactly because isolated measurement showed that their smaller accumulation workload did not repay vector setup.

The focused native gate compares scalar and SIMD output over 16,384 stereo frames. Maximum sample error is `5.96046e-08`, relative residual is `-138.164 dB`, repeated SIMD output is deterministic, and all oscillator phases remain exact. A seven-repetition, warmed 262,144-frame median reduced the isolated full-unison loop from `21.9052 ms` to `20.5384 ms` (`0.937601` ratio, or `6.2%` faster) on the measured Apple Silicon build. Nine-voice fallback is explicitly bit-exact and records no SIMD work. This is an isolated kernel result, not an end-to-end song CPU claim.

Lumen v16 now adds signed per-LFO rate keytracking without placing exponent work inside the sample loop. Zero is an exact compatibility default, Aether ignores the field, and v1-v15 Lumen patches migrate to zero. Control/audio-rate route selection, stereo split, arbitrary editable remap curves, editable LFO tables, advanced random sources, microtonal file import, and a separate time/frequency spectral source remain unimplemented and separately gated.

## Provenance boundary

The reviewed Vital files are GPLv3 source from the pinned external snapshot. This audit records behavior and architecture only; it does not import Vital code, data, presets, artwork, branding, services, or binaries into Beat.

General techniques such as sparse execution, rate classification, immutable prepared buffers, lookup tables, active-lane masks, and SIMD are suitable requirements for an independent Beat implementation. Copying, translating, or closely adapting Vital code or its particular implementation structure must instead follow Beat's documented Vital-derived private-build process: file-level provenance, preserved notices, GPL text, a provenance verifier, and a hard stop before distribution or external testing.

## Reviewed source surfaces

- `src/synthesis/framework/poly_values.h`: platform SIMD width and packed values.
- `src/synthesis/framework/processor_router.cpp`: enabled-processor traversal.
- `src/synthesis/framework/synth_module.cpp`: module-wide enable propagation.
- `src/synthesis/modules/modulation_connection_processor.cpp`: control/audio-rate selection and specialized remap/curve paths.
- `src/synthesis/modules/synth_voice_handler.cpp`: active modulation processor list and unused mod-source disabling.
- `src/synthesis/modules/producers_module.cpp`: disabled-by-default oscillator/sample producers and dependency-aware ordering.
- `src/synthesis/modules/filter_module.cpp`: one active filter model at a time.
- `src/synthesis/modules/reorderable_effect_chain.cpp`: ordered enabled-effect processing.
- `src/synthesis/producers/synth_oscillator.cpp`: active-lane SIMD unison, block-specialized warp dispatch, and reusable spectral wave buffers.
- `src/synthesis/lookups/wavetable.cpp`: waveform/frequency representation and audio-reader publication boundary.
