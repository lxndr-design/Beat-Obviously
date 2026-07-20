# Lumus / Serum 2 Benchmark

## Boundary

Lumus is a new Beat synth, not an Aether rename or in-place schema upgrade. Aether remains frozen under instrument type `wavetable-synth` and namespace `synth`. Lumus begins under `lumus-hybrid-synth` and namespace `lumus`, with a separate creation path and engine identity. Its first audible foundation deliberately adapts into the verified Aether renderer so the starting sound is deterministic; future Lumus features must extend the Lumus boundary without changing Aether patches or defaults.

No Serum 2 plug-in is installed on the measured machine, so no direct sound-quality, null-test, CPU, preset, or render claim is made against Serum 2. The current comparison is a feature-contract benchmark derived only from Xfer Records' official [product page](https://www.xferrecords.com/products/serum-2), [sound-generation overview](https://xferrecords.com/web-manual/serum-2/exploring-sound-design-in-serum), [routing documentation](https://xferrecords.com/web-manual/serum-2/routing-an-oscillator-or-filter), [architecture overview](https://xferrecords.com/web-manual/serum-2/exploring-serum), and [version-compatibility FAQ](https://support.xferrecords.com/article/58-how-to-upgrade-from-serum-1-to-serum-2). These sources are behavior references only; no third-party code, preset, wavetable, sample, artwork, branding, or service integration is used.

The machine-readable matrix is `docs/audio/lumus-serum2-capability-matrix.json`.

## Initial measured baseline

Lumus Init currently uses the same parameter values and renderer adapter as Aether Init. Focused frontend coverage requires its 48 kHz stereo float buffers to be byte-identical to Aether Init while preserving the distinct Lumus type and namespace through normalization, instrument conversion, and restoration. Native contract coverage requires the same patch to select `InstrumentDefinition::SynthEngine::Lumus`; an Aether patch must continue selecting `SynthEngine::Aether`.

This equality is a starting-line invariant, not a permanent goal. Every future divergence must name the Lumus-only contract, add a measured render, and prove the equivalent Aether render remains unchanged.

## Three-slot wavetable slice

Lumus schema v2 freezes three stable source identities: A, B, and C. The existing generalized oscillator editor now presents exactly those three rows for Lumus and disables structural add/remove actions. Slot C owns its own enable state, wavetable, tuning, phase, unison, level, pan, routing, and two send values. It is disabled in the default and in deterministic v1-to-v2 migration, preserving the initial Aether-equivalent render. Enabling it produces a separately measured, finite stereo contribution in both the browser preview and native voice.

Only wavetable mode is implemented. Sample, multisample, granular, and spectral selection are not exposed as placeholder choices, and modulation targeting for Slot C is not claimed in this slice.

### Verified 2026-07-20

- Complete non-native verification and production frontend build: passed.
- Release `Beat` and `BeatBackendStress` targets: built successfully.
- Complete native stress suite: passed with only the existing `baseline.recent-project-exists` TCC waiver enabled.
- Lumus v1 migration, v2 roundtrip, malformed/future rack rejection, fixed UI identities, browser audibility, native audibility, stereo pan, finite output, and deterministic rendering: passed.
- Frozen Aether benchmark renders at 44.1, 48, and 96 kHz retained their recorded SHA-256 values; no baseline was updated.

## Benchmark lanes

1. **Identity and compatibility:** distinct stable type, namespace, editor entry, persistence, and explicit one-way Aether conversion only.
2. **Source architecture:** three interchangeable main slots, each capable of the approved Lumus source modes, plus dedicated sub/noise.
3. **Audio quality:** pitch, alias-risk, DC, discontinuity, cross-rate equivalence, stereo coherence, transition continuity, and deterministic live/offline parity.
4. **Routing and modulation:** per-source dual-filter/main/direct/none routing, two sends, bounded effect graph, deterministic modulation, and unchanged event timing.
5. **Performance:** equivalent-patch Lumus must begin no slower than the frozen Aether path; new modes receive independent realtime work budgets and offline-HQ measurements.
6. **Workflow:** synth-owned arp/clip sequencing is evaluated only after source/routing contracts are stable so it cannot conceal renderer timing defects.

## Direct-reference gate

A direct Serum 2 comparison may be added later only from a locally licensed installation and user-created neutral test patches. The harness must record exact plug-in version, host, sample rate, block size, oversampling/quality settings, patch construction, latency compensation, render hashes, wall time, and non-null spectral metrics. It must not use or redistribute Serum factory presets, factory wavetables, samples, preview audio, or artwork.

## Current conclusion

Lumus has a clean identity boundary, a bit-stable Aether-derived starting renderer, and a fixed A/B/C wavetable rack. The largest verified architectural gaps against the official Serum 2 contract are interchangeable non-wavetable modes in those slots, Slot C modulation coverage, synth-owned arp/clip sequencing, and the remaining routing choices. Spectral work remains incomplete and is not implied ready by this benchmark.
