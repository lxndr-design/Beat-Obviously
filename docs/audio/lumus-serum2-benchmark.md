# Lumus / Serum 2 Benchmark

## Boundary

Lumus is a new Beat synth, not an Aether rename or in-place schema upgrade. Aether remains frozen under instrument type `wavetable-synth` and namespace `synth`. Lumus begins under `lumus-hybrid-synth` and namespace `lumus`, with a separate creation path and engine identity. Its first audible foundation deliberately adapts into the verified Aether renderer so the starting sound is deterministic; future Lumus features must extend the Lumus boundary without changing Aether patches or defaults.

No Serum 2 plug-in is installed on the measured machine, so no direct sound-quality, null-test, CPU, preset, or render claim is made against Serum 2. The current comparison is a feature-contract benchmark derived only from Xfer Records' official [product page](https://www.xferrecords.com/products/serum-2), [sound-generation overview](https://xferrecords.com/web-manual/serum-2/exploring-sound-design-in-serum), [routing documentation](https://xferrecords.com/web-manual/serum-2/routing-an-oscillator-or-filter), [architecture overview](https://xferrecords.com/web-manual/serum-2/exploring-serum), and [version-compatibility FAQ](https://support.xferrecords.com/article/58-how-to-upgrade-from-serum-1-to-serum-2). These sources are behavior references only; no third-party code, preset, wavetable, sample, artwork, branding, or service integration is used.

The machine-readable matrix is `docs/audio/lumus-serum2-capability-matrix.json`.

## Initial measured baseline

Lumus Init currently uses the same parameter values and renderer adapter as Aether Init. Focused frontend coverage requires its 48 kHz stereo float buffers to be byte-identical to Aether Init while preserving the distinct Lumus type and namespace through normalization, instrument conversion, and restoration. Native contract coverage requires the same patch to select `InstrumentDefinition::SynthEngine::Lumus`; an Aether patch must continue selecting `SynthEngine::Aether`.

This equality is a starting-line invariant, not a permanent goal. Every future divergence must name the Lumus-only contract, add a measured render, and prove the equivalent Aether render remains unchanged.

## Three-slot source rack

Lumus schema v10 retains three stable source identities: A, B, and C, and gives each slot independent sample and granular parameters, managed assets, and Wavetable/Sample/Multisample/Granular selection. Multisample is an explicit policy identity over the same bounded key-map/SFZ renderer rather than a duplicate DSP engine. The generalized oscillator editor presents exactly those rows and disables structural add/remove actions. Non-wavetable modes disable only the selected slot's wavetable renderer. V3 sample data migrates losslessly into C; v4 gains silent granular defaults while retaining its legacy auxiliary granular state, and v1/v2 remain wavetable-only and silent for C.

Wavetable, sample, multisample, and bounded granular modes are implemented independently for A, B, and C. A shared A/B/C settings switch exposes each source asset and key map without creating a second component system. Sample and Multisample deliberately share the verified renderer while retaining distinct serialized mode identity. Spectral remains paused rather than exposed as a placeholder. Slot C wavetable mode participates in the existing modulation contract. All source-mode and routing UI uses Beat's shared `FloatingSelect`, button, toggle, input, and knob components with no Lumus-specific typography or layout system.

Schema v7 added a Lumus-owned arpeggiator. Schema v8 added zero-to-75% pair-preserving swing. Schema v9 adds twelve root keys and Chromatic, Major, Natural Minor, Major Pentatonic, and Blues contexts. Incoming held notes are quantized to the nearest allowed pitch before pattern ordering; exact ties resolve downward, then the existing octave expansion applies. Chromatic is the default, and v1-v8 migrate to C Chromatic, preserving older output. When enabled, the route-level MIDI transform produces Up, Down, Up/Down, or deterministic Random patterns at 1/4, 1/8, 1/16, or 1/32 divisions, with bounded gate, swing, and octave controls.

Schema v10 adds a mutually exclusive clip-sequencer foundation. A clip contains exactly 1-32 bounded steps; each step is a rest or one relative note with integer semitone offset, whole-step length, and velocity. The most recently held input note triggers and transposes the pattern; releasing it deterministically falls back to the most recently pressed note still held. New triggers restart at step one. The clip supports the same four tempo divisions and pair-preserving swing range. Clip and Arpeggiator cannot both be active, older patches migrate with an empty disabled 16-step clip, and malformed/future/conflicting data is rejected before preparation. The shared-component editor exposes 16 default steps and selected-step pitch, length, and velocity controls. Polyphonic piano-roll editing, clip banks, recording/MIDI import, macro automation, and preset-preview designation remain explicit gaps.

Both transforms recalculate step duration from the active sample rate, sequencer tempo, and transport speed. Held-note state, order, channel, velocity, block continuity, note-offs, and controller panic behavior are deterministic; transport reset clears the active transform. The callback uses fixed arrays and a pre-sized MIDI buffer, while validation, configuration, and storage preparation happen outside it.

The focused MIDI transform is event-exact across 100-sample block splits and reports zero realtime-safety violations after preparation. The end-to-end offline engine test produces finite, audible, materially different enabled output (`differenceEnergy 647.748`) and a `0.003130` maximum sample delta between 64- and 257-sample render blocks, below the explicit `0.005` integration tolerance. The disabled comparison is block-identical. This tolerance records the renderer's retrigger/envelope numerical boundary rather than relaxing MIDI event timing.

### Verified 2026-07-21

- Complete non-native verification and production frontend build: passed.
- Release `Beat` and `BeatBackendStress` targets: built successfully.
- Complete native stress suite: passed in 16.11 s wall / 14.05 s user / 1.05 s system with only the existing `baseline.recent-project-exists` TCC waiver enabled. The host denied the stress process's `kern.clockrate` query, so no process-RSS value is claimed for that run.
- Lumus v1-v9 migration, v10 roundtrip, independent sample-ownership preservation, malformed/future per-slot and clip metadata rejection, ambiguous legacy-source rejection, malformed/future rack rejection, Arp/Clip conflict rejection, arpeggiator default-off/straight/chromatic migration, clip default-off migration, invalid key/scale/rate rejection, parser clamps, exact gate/swing/scale/clip timing, channel/velocity preservation, block-size invariance, controller panic, fixed UI identities, browser/native wavetable audibility, native sample audibility, stereo pan, per-source route conversion, Slot C modulation, finite output, and deterministic rendering: passed.
- Frozen Aether benchmark renders at 44.1, 48, and 96 kHz retained their recorded SHA-256 values; no baseline was updated. The regenerated 150-WAV baseline retained normalized manifest `67c27249118f7ec4281659db7fdcfa3ce6638d6110885a572e5e71de6ad0cafa`; `baseline.json` SHA-256 is `048adff73a74958556c0fa62d8cfff8d0559babc1c1070caebd3afd1c713d09c`. The matrix completed in 2.61 s wall / 2.21 s user / 0.05 s system with 15,220,736-byte harness peak RSS, measured render times of 13.007292-15.862125 ms, zero deadline overruns, and unchanged 64 accepted / 16 rejected / 16 overflow queue telemetry.

## Benchmark lanes

1. **Identity and compatibility:** distinct stable type, namespace, editor entry, persistence, and explicit one-way Aether conversion only.
2. **Source architecture:** three interchangeable main slots, each capable of the approved Lumus source modes, plus dedicated sub/noise.
3. **Audio quality:** pitch, alias-risk, DC, discontinuity, cross-rate equivalence, stereo coherence, transition continuity, and deterministic live/offline parity.
4. **Routing and modulation:** per-source dual-filter/main/direct/none routing, two sends, bounded effect graph, deterministic modulation, and unchanged event timing.
5. **Performance:** equivalent-patch Lumus must begin no slower than the frozen Aether path; new modes receive independent realtime work budgets and offline-HQ measurements.
6. **Workflow:** the synth-owned arpeggiator, pair-preserving swing, key/scale context, and bounded monophonic clip foundation are complete; the full polyphonic clip workflow remains independently gated work.

## Direct-reference gate

A direct Serum 2 comparison may be added later only from a locally licensed installation and user-created neutral test patches. The harness must record exact plug-in version, host, sample rate, block size, oversampling/quality settings, patch construction, latency compensation, render hashes, wall time, and non-null spectral metrics. It must not use or redistribute Serum factory presets, factory wavetables, samples, preview audio, or artwork.

## Current conclusion

Lumus has a clean identity boundary, a bit-stable Aether-derived starting renderer, a fixed A/B/C rack with independently verified sample, multisample, and granular playback in every slot, a bounded sample-accurate arpeggiator, and a deterministic monophonic clip foundation. The full polyphonic clip workflow and spectral work remain incomplete and are not implied ready by this benchmark.
