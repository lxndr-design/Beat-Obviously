# Lumus / Serum 2 Benchmark

## Boundary

Lumus is a new Beat synth, not an Aether rename or in-place schema upgrade. Aether remains frozen under instrument type `wavetable-synth` and namespace `synth`. Lumus begins under `lumus-hybrid-synth` and namespace `lumus`, with a separate creation path and engine identity. Its first audible foundation deliberately adapts into the verified Aether renderer so the starting sound is deterministic; future Lumus features must extend the Lumus boundary without changing Aether patches or defaults.

No Serum 2 plug-in is installed on the measured machine, so no direct sound-quality, null-test, CPU, preset, or render claim is made against Serum 2. The current comparison is a feature-contract benchmark derived only from Xfer Records' official [product page](https://www.xferrecords.com/products/serum-2), [sound-generation overview](https://xferrecords.com/web-manual/serum-2/exploring-sound-design-in-serum), [routing documentation](https://xferrecords.com/web-manual/serum-2/routing-an-oscillator-or-filter), [architecture overview](https://xferrecords.com/web-manual/serum-2/exploring-serum), and [version-compatibility FAQ](https://support.xferrecords.com/article/58-how-to-upgrade-from-serum-1-to-serum-2). These sources are behavior references only; no third-party code, preset, wavetable, sample, artwork, branding, or service integration is used.

The machine-readable matrix is `docs/audio/lumus-serum2-capability-matrix.json`.

## Initial measured baseline

Lumus Init currently uses the same parameter values and renderer adapter as Aether Init. Focused frontend coverage requires its 48 kHz stereo float buffers to be byte-identical to Aether Init while preserving the distinct Lumus type and namespace through normalization, instrument conversion, and restoration. Native contract coverage requires the same patch to select `InstrumentDefinition::SynthEngine::Lumus`; an Aether patch must continue selecting `SynthEngine::Aether`.

This equality is a starting-line invariant, not a permanent goal. Every future divergence must name the Lumus-only contract, add a measured render, and prove the equivalent Aether render remains unchanged.

## Three-slot source rack

Lumus schema v7 freezes three stable source identities: A, B, and C, and gives each slot independent sample and granular parameters, managed assets, and Wavetable/Sample/Multisample/Granular selection. Multisample is an explicit policy identity over the same bounded key-map/SFZ renderer rather than a duplicate DSP engine. The generalized oscillator editor presents exactly those rows and disables structural add/remove actions. Non-wavetable modes disable only the selected slot's wavetable renderer. V3 sample data migrates losslessly into C; v4 gains silent granular defaults while retaining its legacy auxiliary granular state, and v1/v2 remain wavetable-only and silent for C.

Wavetable, sample, multisample, and bounded granular modes are implemented independently for A, B, and C. A shared A/B/C settings switch exposes each source asset and key map without creating a second component system. Sample and Multisample deliberately share the verified renderer while retaining distinct serialized mode identity. Spectral remains paused rather than exposed as a placeholder. Slot C wavetable mode participates in the existing modulation contract. All source-mode and routing UI uses Beat's shared `FloatingSelect`, button, toggle, input, and knob components with no Lumus-specific typography or layout system.

Schema v7 also adds a Lumus-owned arpeggiator. It is disabled by default, so older patches and the Lumus Init/Aether Init equality invariant remain unchanged. When enabled, the route-level MIDI transform produces Up, Down, Up/Down, or deterministic Random patterns at 1/4, 1/8, 1/16, or 1/32 divisions, with bounded gate and octave controls. Step duration is recalculated from the active sample rate, sequencer tempo, and transport speed. Held-note state, order, channel, velocity, block continuity, gate note-offs, and controller panic behavior are deterministic; transport reset clears the transform. The callback uses fixed arrays and a pre-sized MIDI buffer, while configuration and storage preparation happen outside it. Swing, scale/key constraints, and clip sequencing are not implemented.

The focused MIDI transform is event-exact across 100-sample block splits and reports zero realtime-safety violations after preparation. The end-to-end offline engine test produces finite, audible, materially different enabled output (`differenceEnergy 647.748`) and a `0.003130` maximum sample delta between 64- and 257-sample render blocks, below the explicit `0.005` integration tolerance. The disabled comparison is block-identical. This tolerance records the renderer's retrigger/envelope numerical boundary rather than relaxing MIDI event timing.

### Verified 2026-07-20

- Complete non-native verification and production frontend build: passed.
- Release `Beat` and `BeatBackendStress` targets: built successfully.
- Complete native stress suite: passed with only the existing `baseline.recent-project-exists` TCC waiver enabled.
- Lumus v1-v6 migration, v7 roundtrip, independent sample-ownership preservation, malformed/future per-slot metadata rejection, ambiguous legacy-source rejection, malformed/future rack rejection, arpeggiator default-off migration, parser clamps, exact gate timing, channel/velocity preservation, block-size invariance, controller panic, fixed UI identities, browser/native wavetable audibility, native sample audibility, stereo pan, per-source route conversion, Slot C modulation, finite output, and deterministic rendering: passed.
- Frozen Aether benchmark renders at 44.1, 48, and 96 kHz retained their recorded SHA-256 values; no baseline was updated.

## Benchmark lanes

1. **Identity and compatibility:** distinct stable type, namespace, editor entry, persistence, and explicit one-way Aether conversion only.
2. **Source architecture:** three interchangeable main slots, each capable of the approved Lumus source modes, plus dedicated sub/noise.
3. **Audio quality:** pitch, alias-risk, DC, discontinuity, cross-rate equivalence, stereo coherence, transition continuity, and deterministic live/offline parity.
4. **Routing and modulation:** per-source dual-filter/main/direct/none routing, two sends, bounded effect graph, deterministic modulation, and unchanged event timing.
5. **Performance:** equivalent-patch Lumus must begin no slower than the frozen Aether path; new modes receive independent realtime work budgets and offline-HQ measurements.
6. **Workflow:** the first synth-owned arpeggiator slice is complete; swing, scale/key context, and clip sequencing remain independently gated work.

## Direct-reference gate

A direct Serum 2 comparison may be added later only from a locally licensed installation and user-created neutral test patches. The harness must record exact plug-in version, host, sample rate, block size, oversampling/quality settings, patch construction, latency compensation, render hashes, wall time, and non-null spectral metrics. It must not use or redistribute Serum factory presets, factory wavetables, samples, preview audio, or artwork.

## Current conclusion

Lumus has a clean identity boundary, a bit-stable Aether-derived starting renderer, a fixed A/B/C rack with independently verified sample, multisample, and granular playback in every slot, and a bounded sample-accurate arpeggiator. Swing, key/scale context, clip sequencing, and spectral work remain incomplete and are not implied ready by this benchmark.
