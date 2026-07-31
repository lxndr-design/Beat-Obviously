# Lumen / Vital Benchmark

## Result

Vital is a useful benchmark for Lumen, but it is not the same target as Serum 2. Serum 2 remains the breadth target for Lumen's hybrid A/B/C source architecture. Vital is the stronger reference for deep wavetable spectral warping, fast visual modulation, audio-rate routing, stereo modulation, modulation remapping, and microtonal workflow.

The current comparison is feature-contract only. No Vital AU, VST3, VST, or standalone application was found on the measured Mac on 2026-07-28, so this document makes no direct Vital sound, CPU, aliasing, latency, null, preset, or stability claim. Official product claims come only from the public product page, press kit, and repository README. A separate source-architecture review inspected the locally quarantined snapshot at commit `636ca0ef517a4db087a6a08a6a8a5e704e21f836`; it was not built, linked, copied, or imported into Beat.

The machine-readable matrix is `docs/audio/lumen-vital-capability-matrix.json`.
The implementation-oriented review is `docs/audio/lumen-vital-source-audit.md`.

## What the comparison changes

Lumen should not pivot away from its Serum 2-style hybrid source plan. Its Sample, Multisample/SFZ, Granular, Beat-native clip, routing, and arrangement integration are meaningful advantages over the narrower Vital reference surface documented here. Vital instead sharpens the next wavetable/modulation priorities:

1. Extend the shipped Lumen v15 prepared spectral-harmonic warp foundation with transition, alias, and direct spectral-measurement gates before considering a separate spectral source mode.
2. Extend the shipped bounded per-route response curves into arbitrary editable remap curves before expanding the route count.
3. Add stereo-split modulation and visible left/right modulation trajectories.
4. Establish a genuinely user-routable audio-rate modulation lane with explicit destination budgets.
5. Build on the integrated v16 keytracked LFO rate with editable LFO shapes and bounded advanced random sources.
6. Add `.scl` plus `.kbd` import first, with `.tun` compatibility evaluated separately.
7. Move the shipped audio-library wavemap resynthesis path behind an explicit native worker boundary.

The first three items create the clearest Vital-like sound-design gain. The microtonal and import items are lower DSP risk and can land independently. None requires Vital source reuse.

## Current measured Lumen baseline

The existing `benchmark-lumen-aether-equivalence.mjs` lane remains an internal regression benchmark, not a Vital comparison. Its current eight-row matrix covers 44.1/48/96 kHz, 128/512-sample blocks, and 1/4/8 submitted voices. After the prepared-modulation, sparse-warp, spectral-table, scalar-topology, bounded-SIMD, and zero-default keytracked-LFO integration, all rows remain output-equivalent to their source Aether patches. The final isolated v16 run measured a `1.086237` aggregate Lumen/Aether median wall ratio and a `1.094587` maximum row ratio. A prior contended run exceeded the timing budget while retaining 8/8 exact output, then passed twice when isolated; no timing failure was waived. This matrix does not exercise 16-voice unison, so it remains a compatibility guard rather than evidence for or against the SIMD path.

The first separately gated SIMD result is narrower: only the accumulation stage of a full 16-voice Lumen wavetable-unison bank uses native vectors. A warmed seven-repetition native microbenchmark initially measured `21.9052 ms` scalar versus `20.5384 ms` SIMD for 262,144 stereo frames, a `0.937601` ratio (`6.2%` faster); the final full-suite rerun measured `21.9474 ms` versus `20.4907 ms` (`0.933631`, or `6.6%` faster). Maximum scalar/SIMD sample error was `5.96046e-08` with a `-138.164 dB` relative residual and exact oscillator phases. Lower widths stay bit-exact on the scalar renderer because they did not show a reliable benefit. This does not substitute for the future matched Vital protocol or establish end-to-end patch speedup.

## Direct-render protocol

A direct Vital/Lumen benchmark becomes valid only after an official Vital binary is installed locally. Do not compile the delayed public source and present that result as the current commercial/free binary.

For each run, record:

- Vital edition, exact plug-in version, file hash, architecture, and format.
- macOS version, CPU model, power mode, sample rate, block size, host, and requested quality/oversampling.
- One user-authored neutral patch family using only basic generated waves—no factory preset, wavetable, sample, LFO pattern, or effect preset.
- Matched lanes for one oscillator, three oscillators, 1/8/16 unison, filter, modulation, and effects-disabled baselines.
- Warm-up count, render order alternation, at least seven timed repetitions, median and p95 wall time, reported latency, peak/RMS/DC, render hashes, and spectral/alias metrics.
- Separate idle, held-voice, note-churn, automation, and live-callback deadline runs.

The two products have different architectures, so exact sample nulling is not a parity requirement. Neutral pitch, gain, and duration must be calibrated first; CPU and alias results must be reported per lane rather than collapsed into a single winner.

## Licensing boundary

Vital's published source is GPLv3 and the official repository states that proprietary/closed-source use requires separate licensing. It also explicitly restricts reuse of Vital branding, services, and bundled presets. Beat's existing private-build policy therefore remains unchanged: no Vital-derived source enters Beat without the provenance manifest, notices, verifier, and explicit distribution stop already recorded in `external-source-ledger.md`. This benchmark adds no external code or content.

## Conclusion

Lumen is currently broader as a Beat-integrated hybrid instrument, while Vital remains substantially ahead in wavetable-specific depth and modulation UX. Lumen v15 has five prepared harmonic-domain wavetable warps plus bounded Linear/Ease In/Ease Out/S-Curve remapping per route, and v16 adds bounded per-LFO octave-rate keytracking. Its product oscillator surface can also resynthesize existing audio-library assets into any A/B/C wavetable slot with bounded analysis windows, though native analysis worker isolation remains open. Full spectral-source processing, direct alias/sound comparison, audio-rate routing, stereo and arbitrary editable remapping, editable LFO shapes, advanced random sources, unified visualization, and microtonal file loading also remain open. A direct performance ranking remains blocked until the official plug-in is installed.
