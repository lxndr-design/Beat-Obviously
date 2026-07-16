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

The supplied documents name their four controls generically as Motion, Color, Shape, and Space. Beat's factory-preset audit rejects that shared generic display layout, so the structurally adapted product labels are `Pump Motion / Harmonic Color / Envelope Shape / Stereo Space` for Future Bass and `Pulse Motion / String Color / Envelope Shape / Hall Space` for Progressive House. Stable macro IDs, default values, and supported routes remain the recorded source adaptation; this naming refinement does not claim support for the omitted dynamic targets.

These are user-provided benchmark definitions, not Vital or other upstream factory presets. No acquired repository, branding, service endpoint, binary, executable content, runtime dependency, repository-wide license, or ownership declaration was imported or changed. Local implementation files are frontend/src/data/aether_benchmark_strings_bank.json, frontend/src/state/synthStore.ts, scripts/verify-synth-roundtrip.mjs, two unrelated Solid setter compatibility fixes exposed by the full gate, and these four audit documents; none is Vital-derived.

## Milestone B release-acceptance provenance

The two approved policies update release status only. No implementation,
external-derived work, dependency, binary, asset, preset, branding, service,
license, or ownership declaration changed. Milestone C remains subject to the
existing approval gates for upstream import, execution, and dependencies.

## Milestone C1 source-slot provenance

The three-slot interface, non-owning rack, immutable sample definition,
fixed-capacity playback implementation, pitch-rate table, interpolation,
release/end fades, telemetry, and focused native tests are independently
implemented Beat-owned code. No upstream repository, acquired implementation,
factory preset, external sample, dependency, binary, service, branding, or
downloaded data was consulted, executed, copied, translated, structurally
adapted, imported, or linked. Existing JUCE AudioBuffer and math primitives are
used through Beat's already-declared JUCE dependency; JUCE source is unchanged.
No repository-wide license or ownership declaration changed. Local files are
`backend/Source/Audio/Sources/SourceSlot.h`,
`backend/Source/Audio/Sources/SourceSlotRack.h`,
`backend/Source/Audio/Sources/SampleSourceSlot.h`, `backend/CMakeLists.txt`,
`backend/Tests/BackendStress.cpp`, and these four audit documents; none is
Vital-derived.

## Milestone C2A Slot 1 provenance

The Slot 1 project fields, schema migration, decoded-cache alias, per-voice connection, filter/direct routing, bounded route replacement bridge, missing-asset behavior, product controls, and focused tests are independently implemented Beat-owned code on top of the C1 interfaces and Beat's existing audio-file decoder/cache. No upstream repository, acquired implementation, external sample, factory preset, dependency, binary, service, branding, downloaded data, or web endpoint was consulted, executed, copied, translated, structurally adapted, imported, or linked. Existing JUCE decoding and AudioBuffer APIs are used through Beat's already-declared dependency; JUCE source is unchanged. No repository-wide license or ownership declaration changed, and no file in this slice is Vital-derived.

Local implementation files are `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Source/Audio/Sources/SampleSourceSlot.h`, `backend/Source/Audio/Parameters/SynthPatchContract.cpp`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `backend/Tests/BackendStress.cpp`, `scripts/verify-synth-roundtrip.mjs`, and these four audit documents.

## Milestone C2B Slot 1 slicing/looping provenance

The normalized slice/loop schema, setup-time integer-bound validation, fixed forward-wrap policy, bounded linear seam crossfade, replacement identity, product controls, migrations, and tests are independently implemented Beat-owned code on the existing C1/C2A interfaces. No upstream repository, acquired implementation, external sample, factory preset, runtime dependency, binary, service, branding, downloaded data, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Existing JUCE AudioBuffer access is used through Beat's already-declared dependency; JUCE source is unchanged. No repository-wide license or ownership declaration changed, and no file in this slice is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/SampleSourceSlot.h`, `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/Parameters/SynthPatchContract.cpp`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `backend/Tests/BackendStress.cpp`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents.

## Milestone C2C mapped-zone provenance

The fixed eight-zone map, narrowest-key/velocity-span selector, stable tie-break, immutable decoded-cache publication, bounded child-slot wrapper, v4/v3 schemas, product map controls, migrations, and tests are independently implemented Beat-owned code on the C1–C2B interfaces. Existing Beat sample-zone concepts informed field naming only; no external implementation, repository, preset, sample, binary, service, branding, downloaded data, or runtime dependency was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Existing JUCE containers and AudioBuffer access remain within Beat's already-declared dependency; JUCE source is unchanged. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/MappedSampleSourceSlot.h`, `backend/Source/Audio/Sources/SampleSourceSlot.h`, `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/Parameters/SynthPatchContract.cpp`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `backend/Tests/BackendStress.cpp`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents.

## Milestone C2D mapped-zone playback-control provenance

The per-zone level, pan, slice, and forward-loop controls independently expose fields already implemented and recorded in C2B/C2C. The editor-side slice/loop clamping, compact zone-card layout, and source-contract assertions are Beat-owned work. No external repository, acquired implementation, preset, sample, binary, service, branding, downloaded data, runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `frontend/src/features/Synth/SynthEditor/SynthEditor.module.css`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents.

## Milestone C2E sample-source FX-send provenance

The two stable sample-source send fields, schema migrations, fixed sample-frame accumulation, existing-bus connection, transition identity, product controls, persistence checks, wet/muted behavior fixture, and warmed callback-safety probe are independently implemented Beat-owned work on the existing B16 and C2A–C2D interfaces. No external repository, acquired implementation, preset, sample, binary, service, branding, downloaded data, runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Test audio is generated locally and removed by the fixture. Existing JUCE buffer and project APIs remain within Beat's declared dependency; JUCE source is unchanged. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Source/Audio/Parameters/SynthPatchContract.cpp`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `backend/Tests/BackendStress.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents.

## Milestone C2F overlapping-zone crossfade provenance

The fixed two-match selector, specificity/stable-order policy, key/velocity overlap calculation, equal-power note-on gains, duplicate-bound protection, full-engine overlap fixture, focused arithmetic and callback-safety assertions, and editor disclosure are independently implemented Beat-owned work on the C2C mapped-slot interface. The equal-power sine/cosine law uses JUCE's existing half-pi constant and standard-library trigonometry; no external implementation or coefficient table was consulted. No repository, acquired code, preset, sample, binary, service, branding, downloaded data, runtime dependency, schema, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/MappedSampleSourceSlot.h`, `backend/Tests/BackendStress.cpp`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `scripts/verify-frontend-interactions.mjs`, and these four audit documents.

## Milestone C2G bounded streaming-cache foundation provenance

The fixed shared page cache, double-bank publication protocol, fixed SPSC request path, bounded deduplication, atomic telemetry, deterministic loader fixture, saturation test, callback-safety probe, and concurrent replacement stress are independently implemented Beat-owned work. The architecture was derived from Beat's existing fixed-queue and real-time-boundary requirements; no upstream repository, acquired implementation, source comment, build instruction, preset, sample, binary, service, branding, downloaded data, runtime dependency, coefficient table, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Existing standard-library atomics/containers and Beat's existing `SpscRingBuffer` are used; no external source was modified. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/BoundedSamplePageCache.h`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. The cache remains disconnected from production playback at this gate. A later production connection must receive its own provenance, callback, live/offline, memory-budget, and audible-underflow review.

## Milestone C2H production long-sample streaming provenance

The single-worker session, JUCE-reader adapter, actual-duration and exclusive-use classification, setup preloads, explicit live/offline selection, immutable streamed-source handle, bounded underflow/recovery fades, aggregate telemetry, worker-retirement ordering, and production/standalone tests are independently implemented Beat-owned work on the C1–C2G interfaces. JUCE's existing public `AudioFormatReader`, `AudioBuffer`, `File`, and `Thread` APIs are used through Beat's already-declared dependency; JUCE source is unchanged. No upstream repository, acquired implementation, source comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Test WAVs are generated locally under `/private/tmp` and removed. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/SampleStreamingSession.h`, `backend/Source/Audio/Sources/SampleStreamingSession.cpp`, `backend/Source/Audio/Sources/SampleSourceSlot.h`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Future changes to eligibility, page/cache budgets, worker count, external decoder dependencies, or offline policy require a new ledger entry and independent callback/memory review.

## Milestone C2I sustained streaming-pressure provenance

The slow/failing loader, deterministic random-read pressure, explicit sustained-gap transition assertions, polyphonic seek/loop churn, telemetry reporting, and callback-safety checks are independently implemented Beat-owned test work against the existing C2G/C2H interfaces. No production source, external repository, acquired implementation, source comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. The real-file fixture is generated locally under `/private/tmp` and removed. JUCE remains an unchanged existing Beat dependency. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local changed files are `backend/Tests/BackendStress.cpp` and these four audit documents. The gate does not broaden streaming eligibility or budgets and creates no external-code manifest entry.

## Milestone C3A bounded SFZ subset provenance

The lexer, control/global/group/region inheritance, normalized region record, strict numeric/note/path/range validation, diagnostic accounting, hard limits, selected-text-file wrapper, and focused tests are independently implemented Beat-owned work. The user approved the recommended internal-subset path on 2026-07-15 by directing the established plan to continue. No upstream SFZ implementation, sfizz code, repository, acquired source, README, source comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Existing JUCE `String` and `File` APIs are used through Beat's unchanged declared dependency. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sampler/SfzSubsetImporter.h`, `backend/Source/Audio/Sampler/SfzSubsetImporter.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. The parser is disconnected from playback, project schemas, product UI, and sample assets, so no external-code manifest entry or artifact conveyance is created. Any later upstream implementation, external runtime dependency, or prebuilt decoder remains subject to the existing human approval gate.

## Milestone C3B bounded SFZ sample-resolution provenance

Canonical sample-root containment, file/type/byte-budget validation, duplicate-aware aggregate accounting, immutable resolved-region publication, fixed per-note candidate indexing, bounded diagnostic accounting, and focused negative tests are independently implemented Beat-owned work on the C3A model. No upstream SFZ implementation, repository, acquired source, README, source comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Existing C++ filesystem and standard-library APIs are used; no third-party source was modified. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sampler/SfzSampleResolver.h`, `backend/Source/Audio/Sampler/SfzSampleResolver.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Test sample-shaped files and a symlink escape fixture are generated locally in the temporary directory and removed. C3B remains disconnected from decode, playback, persistence, product UI, and the callback, so it creates no external-code manifest entry or artifact conveyance. Any later upstream implementation, new decoder/runtime dependency, or prebuilt binary remains subject to the existing explicit human approval gate.

## Milestone C3C1 disconnected bounded-decode provenance

The post-open metadata revalidation, unique-sample deduplication, immutable decoded asset/region model, pre-allocation channel/frame/memory budgets, diagnostic accounting, and focused negative tests are independently implemented Beat-owned work on C3B. Existing JUCE `FileInputStream`, `AudioFormatManager`, `AudioFormatReader`, and `AudioBuffer` APIs are used through Beat's unchanged declared JUCE dependency; no JUCE or other third-party source was modified. No upstream SFZ implementation, repository, acquired source, README, source comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sampler/SfzSampleDecoder.h`, `backend/Source/Audio/Sampler/SfzSampleDecoder.cpp`, `backend/Source/Audio/Sampler/SfzSampleResolver.h`, `backend/Source/Audio/Sampler/SfzSampleResolver.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Mono/stereo WAV fixtures are generated locally under `/private/tmp` and removed. The decoder remains disconnected from product import, project schemas, playback, streaming, and the callback, so it creates no external-code manifest entry or artifact conveyance. New codecs, external dependencies, prebuilt binaries, or upstream code remain subject to explicit human approval.

## Milestone C3C2 descriptor-identity provenance

The native identity record, POSIX descriptor-backed JUCE input stream, `O_NOFOLLOW`/close-on-exec open policy, pre/post-decode `fstat` comparisons, fail-closed non-POSIX result, bounded diagnostics, and deterministic test-only mutation hooks are independently implemented Beat-owned work. The design uses documented operating-system file APIs and Beat's existing JUCE `InputStream`/format-reader interface. No upstream implementation, repository, acquired source, README, comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sampler/SfzSampleResolver.h`, `backend/Source/Audio/Sampler/SfzSampleResolver.cpp`, `backend/Source/Audio/Sampler/SfzSampleDecoder.h`, `backend/Source/Audio/Sampler/SfzSampleDecoder.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Test WAVs and symlinks are created locally under `/private/tmp` and removed. The mutation hooks are guarded by `BEAT_SFZ_DECODE_TESTING` on `BeatBackendStress` only and do not enter the production binary. The decoder remains disconnected from product import, schemas, playback, streaming, and callbacks, so no external-code manifest entry or artifact conveyance is created.

## Milestone C3D1 dedicated indexed-source provenance

The fixed indexed candidate selector, two-bank atomic publication and voice pinning, control-thread retirement handoff, 16-record renderer, overlap policy, tuning/gain/pan/slice/loop/one-shot arithmetic, finite publication validation, bounded work telemetry, and focused lifecycle/callback tests are independently implemented Beat-owned work on the existing C3C2 immutable model. Equal-power overlap follows Beat's already-recorded C2F policy and standard sine/cosine arithmetic. No upstream SFZ implementation, repository, acquired source, README, comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new dependency, coefficient table, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. No repository-wide license or copyright ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/SfzSourceSlot.h`, `backend/Source/Audio/Sources/SfzSourceSlot.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Test buffers are generated in memory. The slot is compiled into production but remains disconnected from `AudioEngine`, persistence, product import, and UI; frozen scenarios therefore cannot reach it. Sequence, release-trigger, group, and off-by behavior is explicitly rejected, not independently inferred from an external implementation. Future routing/schema/product work requires its own migration, callback, replacement-transition, and provenance gate.

## Milestone C3D2 managed SFZ product-path provenance

The transactional managed-asset format, SHA-256 content identity, staging/publish protocol, strict manifest loader, traversal/symlink/tamper rejection, schema-5 fields, asset packaging/cleanup integration, IPC/UI import flow, Sample Slot 1 connection, bounded retiring-synth bridge, and focused tests are independently implemented Beat-owned work on C3A–C3D1. JUCE cryptographic, JSON, file, audio-format, synthesiser, and buffer APIs are used through Beat's existing declared JUCE source dependency; JUCE source is unchanged. No upstream SFZ implementation, repository, acquired source, README, comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new external runtime dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Test SFZ/WAV assets are generated locally under `/private/tmp` and removed. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Persistence/ManagedSfzAsset.h`, `backend/Source/Persistence/ManagedSfzAsset.cpp`, `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Source/Audio/Sources/SfzSourceSlot.h`, `backend/Source/Ipc/Schema.h`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `backend/Source/Persistence/ProjectAssetPackage.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/ipc/schema.ts`, `frontend/src/ipc/bridge.ts`, `frontend/src/persistence/assetReferenceGraph.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-daw-core.mjs`, and these four audit documents. `backend/Source/Main.cpp` contains only an unrelated JUCE pointer-call compile correction. Linking `juce_cryptography` adds another module of the already-present JUCE source tree, not a new external source or runtime dependency. Future support for another SFZ semantic, upstream code, external decoder, runtime dependency, or prebuilt binary remains subject to explicit human approval and a new ledger entry.

## Milestone C3E1 bounded granular foundation provenance

The immutable source contract, fixed emitter/grain pools, deterministic xorshift scheduler, linear interpolation, Hann window, equal-power pan law, sample-rate coefficient handling, admission telemetry, lifecycle behavior, and focused tests are independently implemented Beat-owned work from the existing `SourceSlot` requirements and standard mathematics. No upstream granular implementation, repository, acquired source, README, comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, dependency, or web endpoint was consulted, executed, copied, translated, structurally adapted, imported, or linked. In particular, the previously inventoried Clouds and DaisySP candidates remain reference-only and were not inspected for this implementation. No repository-wide license or ownership declaration changed, and no file is Vital-derived.

Local implementation files are `backend/Source/Audio/Sources/GranularSourceSlot.h`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, and these four audit documents. Test audio is generated in memory. The slot remains disconnected from production routing, persistence, UI, assets, and presets; product connection requires a separate lifecycle, migration, replacement, callback, and audible-review gate.

## Milestone C3E2 managed granular product-path provenance

The managed single-audio manifest, transactional content-addressed import, SHA-256 verification, descriptor-backed reuse of Beat's C3C decoder, immutable source construction, Slot 2 schema, stable parameter IDs, UI/import flow, source routing, FX sends, replacement identity, locally generated benchmark audio, and focused tests are independently implemented Beat-owned work on C3E1 and the existing C3D2 project-asset/replacement architecture. The benchmark audio is synthesized at runtime from standard sine functions and contains no copied or bundled recording. JUCE file, JSON, hash, audio-format, buffer, and synthesiser APIs come from Beat's existing declared JUCE source dependency; JUCE is unchanged.

No upstream granular implementation, repository, acquired source, README, comment, workflow, build instruction, preset, sample, binary, service, branding, downloaded data, new dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Previously inventoried Clouds and DaisySP candidates remain reference-only and were not inspected. No file is Vital-derived, and no repository-wide license or ownership declaration changed.

Local implementation files are `backend/Source/Persistence/ManagedGranularAsset.h`, `backend/Source/Persistence/ManagedGranularAsset.cpp`, `backend/Source/Audio/Sources/GranularSourceSlot.h`, `backend/Source/Audio/TrackModel.h`, `backend/Source/Audio/AudioEngine.h`, `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/InstrumentVoice.h`, `backend/Source/Audio/InstrumentVoice.cpp`, `backend/Source/Audio/Parameters/ParameterIds.h`, `backend/Source/Audio/Parameters/ParameterPolicy.h`, `backend/Source/Audio/Parameters/SynthPatchContract.cpp`, `backend/Source/Ipc/Schema.h`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Source/Persistence/ProjectRepository.cpp`, `backend/Source/Persistence/ProjectAssetPackage.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, `frontend/src/state/types.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/ipc/schema.ts`, `frontend/src/ipc/bridge.ts`, `frontend/src/persistence/assetReferenceGraph.ts`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-daw-core.mjs`, and these four audit documents. Managed test WAVs are generated locally under `/private/tmp` and removed. Future external decoders, upstream implementations, runtime dependencies, prebuilt binaries, or spectral work remain subject to their own approval and provenance gate.

## Milestone C3F spectral-review provenance

This checkpoint is architecture documentation only. It compares standard sinusoidal and short-time Fourier representations from general DSP principles and records proposed Beat-owned boundaries, budgets, validation rules, and review questions. No upstream repository, implementation, README, source comment, workflow, build instruction, coefficient table, preset, sample, model, binary, service, branding, downloaded data, new dependency, or web endpoint was consulted, executed, copied, modified, translated, structurally adapted, imported, or linked. Previously inventoried spectral/time-stretch candidates remain reference-only and were not inspected. No file is Vital-derived, and no repository-wide license or ownership declaration changed.

The only new file is `docs/audio/milestone-c3f-spectral-architecture-review.md`; the four audit documents receive status notes. The subsequent AI technical review contributed only mathematical and test-contract revisions: exact WOLA equations, conventional phase-residual propagation, identity phase-locking requirements, stereo reference/coherence metrics, resampler targets, deadline utilization definitions, and latency quantities. It supplied no source code, coefficient table, binary, asset, preset, dependency, or implementation. Any analyzer, transform/resampler implementation, external dependency, prebuilt binary, upstream-derived work, or managed spectral asset requires a later ledger entry and the existing explicit approval gates.

## Milestone C3G non-spectral closeout provenance

C3G adds a Beat-owned Slot 1/2 document validator, fail-closed managed-bundle cleanup, accessibility behavior, keyboard-navigation arithmetic, and test-only benchmark measurement/hash code. It uses existing Beat project models, JUCE JSON/file interfaces, Web platform focus semantics, Node SHA-256, and the already-recorded factory benchmark records. No new repository, external implementation, dependency, binary, preset, sample, service, endpoint, or acquired content was consulted, imported, executed, or added. The provenance of `Benchmark - Future Bass Strings` and `Benchmark - Progressive House Strings` remains the existing user-supplied structural-adaptation entries; C3G measures those existing records and does not modify them.

Local C3G implementation files are `backend/Source/Persistence/HybridSourceDocumentValidation.h`, `backend/Source/Persistence/HybridSourceDocumentValidation.cpp`, `backend/Source/Persistence/ProjectRepository.h`, `backend/Source/Persistence/ProjectRepository.cpp`, `backend/Source/Persistence/ProjectAssetPackage.h`, `backend/Source/Persistence/ProjectAssetPackage.cpp`, `backend/Source/Ipc/MessageBridge.cpp`, `backend/Tests/BackendStress.cpp`, `frontend/src/ipc/schema.ts`, `frontend/src/state/synthStore.ts`, `frontend/src/features/ProjectHealth/ProjectHealthModal.solid.tsx`, `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`, `frontend/src/features/Synth/SynthEditor/SynthEditor.module.css`, `frontend/src/solid-ui/FloatingSelect/FloatingSelect.solid.tsx`, `frontend/src/solid-ui/FloatingSelect/floatingSelectKeyboard.ts`, `frontend/src/solid-ui/Toggle/Toggle.solid.tsx`, `frontend/src/solid-ui/Toggle/Toggle.module.css`, `scripts/verify-synth-roundtrip.mjs`, `scripts/verify-frontend-interactions.mjs`, `scripts/verify-aether-benchmark-renders.mjs`, `frontend/package.json`, `backend/CMakeLists.txt`, and the four audit documents plus the C3G closeout report. Generated test assets remain outside the repository. Slot 3 and the C3F review package are unchanged.

## Milestone C3F1 disconnected analyzer provenance

C3F1 is independently implemented Beat-owned work from the recorded mathematical contracts: the periodic Hann equation, square-root WOLA pair, standard discrete Fourier transform/Parseval identity, conventional wrapped phase-residual equation, root-mean-square stereo reference, stable local maxima, normalized positive spectral flux, and SHA-256 integrity checks. JUCE's existing FFT, buffer, memory-stream, and SHA-256 APIs are used without modification. No external repository, acquired source, comment, README, workflow, coefficient table, preset, sample, binary, model, service, endpoint, new dependency, or upstream implementation was inspected, executed, copied, translated, adapted, imported, or linked. No file is Vital-derived and no repository-wide license or ownership declaration changed.

Local implementation files are `backend/Source/Audio/Spectral/SpectralArtifact.h`, `backend/Source/Audio/Spectral/SpectralArtifact.cpp`, `backend/Source/Audio/Spectral/SpectralAnalyzer.h`, `backend/Source/Audio/Spectral/SpectralAnalyzer.cpp`, `backend/CMakeLists.txt`, `backend/Tests/BackendStress.cpp`, `docs/audio/milestone-c3f-spectral-architecture-review.md`, and the four audit documents. All test PCM is generated in memory. C3F1 has no product, file, schema, asset, source-slot, callback, or service connection.

## Milestone C3F2 artifact-v2 representation provenance

C3F2 representation changes are independently implemented Beat-owned work from the user-approved phase contract and standard phase-vocoder/identity-phase-locking mathematics. They add deterministic bounded peak matching, float64 peak evolution, float32 relative phase, exact binary serialization, bounded decoding, idempotence checks, comparison measurements, and generated transition/corpus fixtures. JUCE's existing FFT, buffer, stream, memory-block, and SHA-256 APIs remain the only library facilities used.

No external repository, acquired source, README, comment, workflow, coefficient table, preset, sample, binary, model, service, endpoint, new dependency, or upstream implementation was inspected, executed, copied, translated, adapted, imported, or linked. No file is Vital-derived and no repository-wide license or ownership declaration changed. Changed implementation files are the four existing files under `backend/Source/Audio/Spectral/`, `backend/Tests/BackendStress.cpp`, the four audit documents, and `docs/audio/milestone-c3f2-representation-validation.md`. All corpus audio is generated in memory; no artifact reaches persistence, product routing, or a callback.

## Milestone C3F2 disconnected playback provenance

The playback slot is independently implemented Beat-owned work from the
approved artifact-v2 contract and standard STFT, phase-vocoder, windowed
overlap-add, sinc interpolation, Kaiser-window, and equal-power arithmetic.
JUCE's existing FFT and audio-buffer APIs are used without modification. The
Kaiser coefficients are generated deterministically at preparation time from
the recorded formula; no external coefficient table is embedded.

No external repository, acquired source, README, source comment, workflow,
build instruction, coefficient table, preset, sample, binary, model, service,
endpoint, new dependency, or upstream implementation was inspected, executed,
copied, translated, structurally adapted, imported, or linked. No file is
Vital-derived and no repository-wide license or ownership declaration changed.
Local files are `backend/Source/Audio/Spectral/SpectralSourceSlot.h`,
`backend/Source/Audio/Spectral/SpectralSourceSlot.cpp`, `backend/CMakeLists.txt`,
`backend/Tests/BackendStress.cpp`, the four audit documents, and
`docs/audio/milestone-c3f2-playback-validation.md`. All PCM and artifacts used
by tests are generated in memory. The slot remains disconnected from product
schema, files, assets, routing, UI, services, and Slot 3.

The active-position extension adds only Beat-owned fixed two-lane voice state,
an atomic latest-request command, standard sine/cosine equal-power gain, and
test-generated position fixtures. The four-voice/two-lane pool is allocated
once during slot construction, before callback use; it never grows. No new
external source, dependency, coefficient table, asset, preset, service, or
provenance classification is introduced.

The active-replacement extension adds Beat-owned three-bank immutable
ownership, fixed reader counters, lane source pinning, deterministic
replacement/position arbitration, and control-side retirement handoff. It
reuses the measured 5 ms equal-power transition and introduces no external
implementation, dependency, asset, preset, binary, coefficient source, service,
or derived code.

The exhaustive sample-offset and overlap-phase fixtures add only Beat-owned
test orchestration around the same disconnected slot and generated in-memory
artifacts. They introduce no external implementation, dependency, file, asset,
preset, binary, service, coefficient source, or derived work.

## C3F3A managed spectral asset boundary — 2026-07-16

`backend/Source/Persistence/ManagedSpectralAsset.{h,cpp}`, its CMake entries,
tests, and audit updates are independently implemented Beat-owned work using
the existing Beat spectral artifact/analyzer, descriptor-validated decoder,
project-sidecar helper, JUCE file/JSON/SHA-256 APIs, and standard-library code.
No upstream repository, acquired code, new dependency, external asset, preset,
binary, service, branding, coefficient table, or derived implementation was
used. The test audio is generated locally in memory.

## C3F3B Slot 3 persistence and asset integrity — 2026-07-16

The TrackModel, repository, hybrid validator, project packaging/cleanup,
frontend types/store/reference graph, verifier, tests, and audit changes are
independently implemented Beat-owned schema and orchestration code. They use no
new dependency, upstream source, external asset, preset, binary, service,
branding, coefficient data, or derived implementation.

## C3F3C bounded Slot 3 product routing — 2026-07-16

The spectral capacity option, shared immutable resampler cache, InstrumentVoice
route/send integration, AudioEngine managed-source preparation, lifecycle
wiring, tests, and audit changes are independently implemented Beat-owned work.
No external source, dependency, asset, preset, binary, service, branding,
coefficient table, or derived implementation was introduced.

## C3F3D Slot 3 import and editor — 2026-07-16

The IPC schema/handler, Solid editor controls, interaction verifier, and audit
updates are independently implemented Beat-owned product code using existing
components and managed-import APIs. No external implementation, dependency,
asset, preset, binary, service, branding, or derived work was introduced.

## C3F3E spectral latency and parity — 2026-07-16

The shared host-rate latency calculation, preallocated InstrumentVoice delay
banks, AudioEngine route-latency integration, product parity fixtures, and
audit updates are independently implemented Beat-owned work. They use existing
Beat/JUCE primitives and introduce no upstream source, copied or adapted code,
runtime dependency, external asset, preset, binary, service, branding,
coefficient data, or derived implementation.
