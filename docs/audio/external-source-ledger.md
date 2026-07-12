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
