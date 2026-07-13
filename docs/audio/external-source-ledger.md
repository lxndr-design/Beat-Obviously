# External DSP source ledger

Reference root: `/Users/alexcheng/beat-aether-references` (outside the Beat tree). Repositories were shallow-cloned on 2026-07-11. No upstream code or assets have been copied into Beat in this audit phase.

Private-build constraint: Vital-derived GPLv3 code may be integrated only for this private personal build. Any future distribution, external testing, collaboration, publication, sale, or third-party conveyance is a hard stop requiring a new licensing decision. Component boundaries aid provenance and replacement; they do not exempt a combined derivative build from GPL obligations.

| Upstream / commit | License | Files inspected / subsystem | Decision | Local destination / modifications / dependencies | RT assumptions, tests, upgrade strategy |
| --- | --- | --- | --- | --- | --- |
| Vital `636ca0ef517a4db087a6a08a6a8a5e704e21f836` | GPLv3 | `src/common/wavetable/*`, `src/synthesis/synth_engine/*`, oscillator/module/framework code | Approved for selective adaptation in private GPLv3 build; no code imported yet | None. Preserve file notices; never import presets, branding, artwork or web services. | Preallocation/SIMD assumptions require local proof. Add provenance manifest before first import; pin commit and review replacements per adapted unit. |
| Surge XT `c3aa9b00529bb90a597442903a142c2c194a46e6` | GPLv3 | wavetable storage/oscillator, filters and routing | Reference only by default; direct reuse would add independent GPL provenance | None | Use for architecture comparison and tests; re-review exact file before any adaptation. |
| Signalsmith DSP `2d20161915e733f117545c6be8cd3275a739a1e3` | MIT | `rates.h` oversampling/resampling primitives | Candidate adaptation/wrapper | None yet; retain MIT notice if used | Preallocate buffers during prepare; measure latency, stop band, allocations and sample-rate behavior. |
| Signalsmith Stretch `57b93f4e9206a089a45387eaa39bdc9f310d3308` | MIT | stretch engine and examples | Candidate spectral/time-stretch building block, not a spectral oscillator | None | Analysis/preparation off callback; deterministic/resynthesis and latency tests required. |
| DaisySP `599511b740f8f3a9b8db72a0642aa45b8a23c3a3` | MIT | noise, wavefolder, filters/effects/granular candidates | Selective reference/adaptation only when measured better than Beat | None | Validate desktop sample rates, stereo behavior, finite values, oversampling and callback allocation. |
| chowdsp_wdf `43bcd295e8403de913f9966f4fd7ff9d17c9f1a5` | BSD-3-Clause | WDF models/examples | Deferred candidate for later nonlinear filters | None | Do not integrate before ordinary dual-filter routing is stable; benchmark per-sample cost. |
| sfizz `f5c6e29f23b8057867c08e88f5f6ac6738baa30b` | BSD-2-Clause | parser, region/sample/voice/preload architecture | Evaluate wrapper versus parser-only after source-slot API | None | File loading/decoding/preload off callback; deterministic zone/round-robin/voice-limit tests. |
| Mutable Instruments eurorack `08460a69a7e1f7a81c5a2abcc7189c9a6b7208d4` | MIT notices per Clouds source; README identifies STM32 code as MIT | `clouds/dsp/grain*`, windows, granular processor, phase-vocoder code | Reference only for desktop-native granular/spectral design | None | Embedded memory/rate/format assumptions are unsuitable unchanged; build a new bounded desktop grain pool. |
| STK `6aacd357d76250bb7da2b1ddf675651828784bbc` | MIT-style STK license | Granulate and synthesis classes | Reference/candidate adaptation | None | Remove dynamic/file operations from callback path; preallocate and benchmark dense grains. |
| Rubber Band `e4296ac80b1170018a110bc326fd0d45a0eb27d6` | GPL-2.0-or-later public source; commercial dual license separately available | stretcher API/engine | Reference only unless its separate licensing impact is explicitly accepted | None | Not a complete spectral oscillator. Offline/RT modes and latency require explicit integration policy. |
| KissFFT `6398d8a1d0c92486b5ece8a456fd5e6a97ad1f08` | BSD-3-Clause | FFT core/tools | Candidate only if it beats JUCE FFT for the chosen workload | None | Plans/buffers created off callback; compare correctness, allocations and throughput with JUCE FFT. |

## Vital import checklist

Before any Vital-derived line enters Beat:

1. Add the complete GPLv3 text and a prominent private-build/no-distribution notice.
2. Create a machine-readable manifest entry containing upstream commit/path, local path, copyright, license, modifications and replacement owner.
3. Preserve the upstream header in the local file and identify modifications without using upstream branding as product identity.
4. Add a verifier that every marked derived file has a manifest entry and notice, and that prohibited presets, branding and service endpoints are absent.
5. Add focused tests before replacing current behavior.
6. Update this table with the local destination, modifications, dependencies, RT assumptions, tests and upgrade strategy.

## Secure reacquisition status

- The original `/Users/alexcheng/beat-aether-references` tree is read-only quarantined evidence. It was not executed or imported.
- Eleven repositories were reacquired at the pinned full SHAs into `/Users/alexcheng/beat-aether-references-reviewed` using an isolated HOME, disabled credentials/hooks/LFS smudging/submodule recursion, and canonical HTTPS remotes.
- Static SHA-256 inventories, flagged dependency/build assets, acquisition commands/environment names, and SPDX 2.3 JSON were generated without executing upstream code.
- Acquisition report SHA-256: `420fe52ec869cb96012504f68df85afb6f94cc5ece6f54a061310b99114a0aa6`.
- SPDX report SHA-256: `e2390bc4bebdd86d255d0690b3c1fe1e9f438b9f64fe4271059cc870d5eb8b07`.
- No project has import approval; no code, preset, asset, runtime dependency, or binary was incorporated.

## Sample-rate baseline freeze

The sample-rate correction uses only existing Beat production sources and test infrastructure. It contains no copied, translated, structurally adapted, or reference-derived upstream implementation and adds no runtime dependency. The reviewed and quarantined reference trees were neither executed nor imported. This ledger therefore has no new external-code entry for the correction.

## Milestone A1 provenance

The immutable timbral-frame/mip model, harmonic-level generator, validation contract, two-axis playback interpolation, and tests are independently implemented from the previously audited Beat code and standard Fourier/wavetable mathematics. No upstream repository was opened during implementation, no upstream instructions were followed, and no copied, modified, translated, structurally adapted, or reference-derived external code was introduced. No runtime dependency was added. Vital import approval has not been requested or granted.

## Milestone A2 provenance

The realtime parameter metadata/policy refactor is an independent consolidation of existing Beat stable IDs, ranges, ramp behavior, and modulation targets. It uses no external implementation, introduces no dependency, and does not change the external-code manifest. Reviewed reference repositories were not consulted, executed, or imported.

## Milestone A3 provenance

`BeatSynthesiser`, the deterministic victim comparator, voice allocation state, and bounded steal transition are independently implemented against JUCE's documented virtual synthesiser hooks and existing Beat voice code. JUCE source was inspected only to confirm local call ordering; JUCE was not modified and no new external code or dependency was imported.

## Milestone A4 provenance

The telemetry counters and render-budget policy consolidate and bound existing Beat queues, vectors, timing, and work counters. They are independently implemented, add no external dependency, and introduce no external-derived file.

## Milestone A5 provenance

The first-order master DC blocker is independently implemented from the standard recurrence `y[n] = x[n] - x[n-1] + R*y[n-1]`. No external source, dependency, or reference-derived implementation was used.

## Milestone A6 provenance

The quality enum, engine/voice propagation, and four-point interpolation are independently implemented using standard Catmull-Rom mathematics. No external code, asset, service, or dependency was used.

## Milestone A7 provenance

The dual-table playback cache, bounded replacement crossfade, and retained-owner reclamation boundary are independently implemented from existing Beat ownership and oscillator code. No upstream source or dependency was used.

## Milestone A8 provenance

The test-only allocation interposer, non-owning sequencer callback view, preallocated MIDI storage, bounded stable insertion ordering, and string-region matching are independently implemented from existing Beat/JUCE integration code and standard C++ allocation hooks. No upstream repository was consulted, executed, or imported; no external source, asset, service, prebuilt binary, or runtime dependency was added.

## Milestone A9 provenance

The development/test-only mutex and file-operation interposers, fixed-capacity typed report buffer, lazy-initialization/container-growth hooks, callsite capture, negative tests, and offline exclusion are independently implemented against operating-system APIs already used by Beat/JUCE. No upstream repository was consulted, executed, or imported. No copied, translated, structurally adapted, or reference-derived code, runtime dependency, prebuilt binary, asset, service, or licensing change was introduced.

## Milestone B1 provenance

The per-oscillator unison parameter contract, legacy shared-value migration, frontend/native conversion, and focused tests are independent extensions of Beat's existing separate oscillator banks and unison plans. No upstream repository was consulted, executed, or imported, and no external code, dependency, asset, preset, service, binary, branding, or licensing change was introduced.

## Milestone B2 provenance

The four oscillator-specific unison modulation targets, additive legacy compatibility, activity planning, preview/native routing, and tests are independently implemented extensions of Beat's modulation matrix. No upstream source was consulted, executed, adapted, or imported, and no dependency or licensing state changed.

## Milestone B3 provenance

The semitone, harmonic, ratio, and equal-division step tuning contracts, parameter schema, cached-rate calculation, preview support, and tests are independently implemented from elementary frequency-ratio mathematics. No upstream source or dependency was consulted, executed, adapted, or imported.

## Milestone B4 provenance

The independent A/B basic phase accumulators, wavetable-member phase preservation, retrigger/memory schema, lifecycle behavior, preview support, and tests are independent extensions of Beat's existing oscillator state. No upstream source, dependency, preset, asset, service, or binary was consulted, executed, adapted, or imported.

## Milestone B5 provenance

The second shared filter state, serial/parallel topology, gain policy, schema, preview path, and focused tests independently reuse Beat's existing filter and drive primitives. No upstream code, dependency, preset, asset, service, or binary was consulted, executed, adapted, or imported.

## Milestone B6 provenance

The per-source filtered/direct bus contract, shared normalization, direct filter bypass, independent runtime-warp state, schema, preview path, and tests are independent extensions of Beat's existing source mixer and voice graph. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived code, runtime dependency, prebuilt binary, preset, asset, branding, service, or licensing change was introduced.

## Milestone B7 provenance

The explicit Filter 1, Filter 2, both-filter, and direct destinations; isolated prepared DSP state lanes; compatibility alias; preview implementation; and focused tests are independent extensions of Beat's B5/B6 graph. No upstream source was consulted, executed, copied, adapted, or imported, and no dependency, binary, asset, preset, service, branding, or licensing state changed.

## Milestone B8 provenance

The second serial runtime-warp state, stable schema, persistence/IPC conversion, preview ordering, and tests independently reuse Beat's existing bounded nonlinear warp implementation. No upstream repository was consulted or executed; no external code, dependency, binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B9 provenance

Macro 5–8 storage, real-time metadata, modulation evaluation, persistence, frontend automation/node validation, and tests are independent extensions of Beat's existing fixed macro contract. No upstream source was consulted, executed, copied, adapted, or imported, and no dependency, binary, preset, asset, service, branding, or licensing state changed.

## Milestone B10 provenance

Envelope 3/4 ADSR, curve/loop lifecycle, cached activity planning, modulation evaluation, persistence, frontend preview/editor support, and tests independently extend Beat's existing Envelope 2 implementation and fixed voice graph. No upstream source was consulted, executed, copied, adapted, or imported, and no dependency, binary, preset, asset, service, branding, or licensing state changed.

## Milestone B11 provenance

The fixed LFO 3–10 configuration/phase/route arrays, conditional evaluation, persistence, frontend schema/preview support, and tests independently extend Beat's existing LFO implementation. No upstream source was consulted, executed, copied, adapted, or imported, and no dependency, binary, preset, asset, service, branding, or licensing state changed.

## Milestone B12 provenance

The saturating fixed-graph work-ceiling arithmetic, extra-LFO and runtime-warp accounting, atomic block-boundary overrun telemetry, IPC/debug presentation, and focused negative tests are independently implemented from Beat's existing render counters and fixed voice graph. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived code, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B13 provenance

The bounded AM/ring formulas, carrier crossfade and gain/routing policy, nonlinear accounting, persistence/frontend contracts, and test-only FFT measurement are independently implemented from elementary signal multiplication and Beat's existing oscillator renderer. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived code, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B14 provenance

The independent pressure/CC74 timbre route fields, JUCE MIDI dispatch integration, activity telemetry, persistence/frontend contracts, preview evaluation, and focused tests are independent extensions of Beat's existing fixed modulation and MIDI-input paths. JUCE APIs already present in Beat provide the MIDI message/voice callbacks; no JUCE source was copied or modified. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B15 provenance

The LFO 3–10 sync fields, setup-time musical-division conversion, persistence/frontend contracts, and tests independently extend Beat's existing LFO 1/2 tempo-sync mathematics and fixed extra-LFO graph. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B16 provenance

The two fixed source-send buffers, non-owning render context, source contribution taps, return-bus aggregation, persistence/frontend controls, and tests independently extend Beat's existing Aether source mixer and project return-bus routing. JUCE's existing synchronous `Synthesiser::renderNextBlock` API is used without copying or modifying JUCE source. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B17 provenance

The effect-descriptor comparison, same-project route matching, bounded output bridge, project-identity reset policy, and focused native test independently extend Beat's existing route-effect application and `VoiceTransition` infrastructure. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B18 provenance

The fixed member-channel pressure/timbre caches, note-start initialization, voice-steal lifecycle behavior, and focused isolation tests independently extend Beat's existing JUCE synthesiser wrapper and Aether modulation sources. JUCE's existing channel/note dispatch and pitch-wheel cache APIs are used without copying or modifying JUCE source. No upstream repository was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B19 provenance

The fixed RPN selector/range state, Data Entry interpretation, channel-specific voice update, current-wheel recomputation, and tests are an independent implementation of the public MIDI RPN 0,0 pitch-bend-sensitivity message contract on top of Beat's existing JUCE synthesiser wrapper. No upstream source was consulted, copied, modified, translated, structurally adapted, or imported; no runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B20 provenance

The versioned persisted member-zone contract, validation/migration policy, bounded master-to-member propagation, fixed mod-wheel cache, frontend normalization, and tests independently extend Beat's existing MIDI-expression and project/synth-patch infrastructure. JUCE's existing channel-filtered voice dispatch is called through public APIs without copying or modifying JUCE source. No upstream repository or acquired reference was consulted or executed; no copied, modified, translated, structurally adapted, or reference-derived implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced.

## Milestone B21 provenance

The legacy RPN 0,6 selector handling, manager-specific lower/upper range calculation, runtime-only replacement policy, bounded clear behavior, and focused tests are independently implemented from the public MIDI 1.0 MPE Configuration Message contract. Protocol semantics were checked against the MIDI Association's public [control-change/RPN table](https://midi.org/midi-1-0-control-change-messages) and [MPE presentation](https://midi.org/wp-content/uploads/2025/04/CCRMA-OH24-presentation.pdf). Beat's already-declared JUCE 8.0.4 dependency, resolved locally at `51d11a2be6d5c97ccf12b4e5e827006e19f0555a`, was inspected at `modules/juce_audio_basics/mpe/juce_MPEZoneLayout.cpp` and `juce_MPEMessages.cpp` only to confirm the lower/upper manager byte mapping. This was reference-only inspection of an existing build dependency: no JUCE or other external source was copied, modified, translated, structurally adapted, imported, or newly executed, and no runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing state changed. Local modified files are `backend/Source/Audio/BeatSynthesiser.h`, `backend/Source/Audio/BeatSynthesiser.cpp`, `backend/Tests/BackendStress.cpp`, and these four audit documents; none is Vital-derived.

## Milestone B22 provenance

The fixed 2/48-semitone MCM defaults, independent additive manager/member pitch scalars, retained-wheel initialization, range-update behavior, and tests are independently implemented from the MIDI Association's public MPE pitch-bend contract. The public [MIDI.org MPE discussion quoting the receiver requirements](https://midi.org/community/midi-specifications/how-midi-mpe-pitch-bend-works) was used as a protocol reference. JUCE's already-present synthesiser API and inherited fixed pitch-wheel cache are used without copying or modifying JUCE source. No copied, modified, translated, structurally adapted, or reference-derived external implementation, runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing change was introduced. Local modified files are `backend/Source/Audio/BeatSynthesiser.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Tests/BackendStress.cpp`, and these four audit documents; none is Vital-derived.

## Milestone B23 provenance

The saved-zone switch, bounded integer channel inputs, overlap validation, compact status presentation, source-contract assertion, and live fixture verification independently expose Beat's existing B20 schema. No external source or acquired reference was consulted, executed, copied, modified, translated, structurally adapted, or imported. No runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing state changed. Local modified files are `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `SynthEditor.module.css`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents; none is Vital-derived.

## Milestone B24 provenance

The tuning-mode selector, mode-specific bounded fields, phase-memory selector, compact oscillator-row layout, source-contract assertion, and live fixture verification independently expose Beat's existing B3/B4 stable fields. No external source or acquired reference was consulted, executed, copied, modified, translated, structurally adapted, or imported. No runtime dependency, prebuilt binary, preset, asset, service, branding, or licensing state changed. Local modified files are `frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx`, `OscillatorPanel.module.css`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents; none is Vital-derived.

## Milestone B25 provenance

The memory-mode steal, bounded transition-output, and legato-retune phase assertions independently extend Beat's native test fixture around existing Beat-owned lifecycle behavior. No production implementation changed. No external source or acquired reference was consulted, executed, copied, modified, translated, structurally adapted, or imported. No dependency, binary, preset, asset, service, branding, or licensing state changed. Local modified files are `backend/Tests/BackendStress.cpp` and these four audit documents; none is Vital-derived.

## Milestone B26 provenance

The disconnected two-times source-rate interaction candidate, fixed sixth-order Butterworth downsampler, callback-safety probe, and analytic FFT comparison are independently implemented from standard oscillator multiplication and public-domain filter mathematics. No upstream repository, acquired reference, external implementation, or downloaded coefficient table was consulted, executed, copied, translated, adapted, or imported. The three Q values are the direct normalized poles of a sixth-order Butterworth response and are recorded in source. No runtime dependency, binary, preset, asset, service, branding, or licensing state changed. Local modified files are `backend/Source/Audio/Oscillator/AetherInteractionStage.h`, `backend/Tests/BackendStress.cpp`, and these four audit documents; none is Vital-derived. The stage was deliberately disconnected at the B26 gate; B27 records its later Beat-owned production connection.

## Milestone B27 provenance

The production connection of Beat's B26 interaction stage, duplicate fixed A/B oscillator-bank state, source-rate phase synchronization, exact work accounting, compatibility/callback tests, and audit updates are independently implemented within Beat-owned interfaces. No upstream repository, acquired reference, external implementation, or downloaded data was consulted, executed, copied, translated, structurally adapted, imported, or linked. No runtime dependency, prebuilt binary, preset, asset, service, branding, repository-wide license, copyright ownership, or licensing state changed. Local modified files are `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Source/Audio/Oscillator/AetherTableStackRenderer.h`, `backend/Source/Audio/Realtime/RenderBudgets.h`, `backend/Tests/BackendStress.cpp`, and these four audit documents; none is Vital-derived.

## Milestone B28 provenance

The optional export-quality field, legacy/default normalization, Export Review selector, IPC propagation, setup-time offline-engine selection, and focused tests independently expose Beat's existing A6 quality enum and render API. No external source, acquired reference, implementation, asset, preset, service, binary, or dependency was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Repository-wide licensing and ownership are unchanged. Local modified files are `frontend/src/ipc/schema.ts`, `frontend/src/state/exportStore.ts`, `frontend/src/features/ExportReview/ExportReviewModal.solid.tsx`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Tests/BackendStress.cpp`, `scripts/verify-daw-core.mjs`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents; none is Vital-derived.

## Milestone B release-review provenance

The release report and corresponding audit pointers summarize already-recorded Beat-owned implementation and measured evidence. They add no implementation, external-derived work, dependency, binary, asset, preset, branding, service, or licensing/ownership change. Local modified files are `docs/audio/milestone-b-release-report.md` and these four audit documents; none is Vital-derived.

## Milestone B29 benchmark factory-preset provenance

Two user-supplied local preset documents were structurally adapted into Beat's existing factory-guide representation:

| Supplied document | SHA-256 | Beat destination | Classification |
| --- | --- | --- | --- |
| /Users/alexcheng/Documents/aether_future_bass_strings_preset.json | e7bc2d66bffb4cc1dc04b6973c52eac0150732fab8f6768b5625af1d9dd09016 | frontend/src/data/aether_benchmark_strings_bank.json / Benchmark - Future Bass Strings | user-supplied, structurally adapted |
| /Users/alexcheng/Documents/aether_progressive_house_strings_preset.json | 2d5874986920fca3852d041200b64392105a3dfedd6920dd87a815891dcb8d55 | frontend/src/data/aether_benchmark_strings_bank.json / Benchmark - Progressive House Strings | user-supplied, structurally adapted |

The adaptation converts normalized source values to the factory guide's percentage representation, converts phase degrees to cycle position, maps oscillator-wide vibrato to matched A/B fine-pitch routes, and preserves the authored static oscillator, envelope, LFO, filter, macro, performance, and effect values supported by Aether. The Future Bass source requests nine unison voices; Aether's current per-oscillator maximum is eight, so the local preset explicitly uses eight to remain schema-idempotent. Dynamic routes targeting FX parameters, envelope time, LFO depth/smoothing, and other unavailable Aether modulation targets are not represented; their static target values remain present. No test was weakened to accept the conversion.

These are user-provided benchmark definitions, not Vital or other upstream factory presets. No acquired repository, branding, service endpoint, binary, executable content, runtime dependency, repository-wide license, or ownership declaration was imported or changed. Local implementation files are frontend/src/data/aether_benchmark_strings_bank.json, frontend/src/state/synthStore.ts, scripts/verify-synth-roundtrip.mjs, two unrelated Solid setter compatibility fixes exposed by the full gate, and these four audit documents; none is Vital-derived.
