# Aurum M4/V4 engine evidence checkpoint

Date: 2026-07-26

This checkpoint closes the automated engine-evidence slice requested for Aurum's modulation/performance milestone. It does not declare M4 complete and does not claim Sytrus audio or CPU parity.

## Focused browser evidence

`npm run verify:aurum` exercises a deterministic 250 ms stereo fixture containing operator phase-envelope modulation, bipolar matrix FM, and bounded self-feedback.

- Two independent renders are sample-exact at 44.1, 48, and 96 kHz.
- Removing phase-envelope depth, the FM edge, or the feedback edge changes the 48 kHz render by a mean stereo difference greater than `0.05`.
- The fixture remains finite and bounded with peak `0.24–0.29` and RMS `0.15–0.18` at every tested rate.
- RMS spread across the three rates is limited to `0.001`. This is an amplitude-stability gate, not an alias-energy or spectral-parity benchmark.

The same verifier builds a six-carrier fixture with six distinct ratios, pans, and bipolar Direct sends. Muting any one operator must change the render by more than `0.005`, establishing that all six rows remain audibly connected. A JSON roundtrip through the current Aurum normalizer must preserve the complete 6x7 FM matrix, 6x6 RM matrix, and six 3-bus output rows.

Schema evidence also covers:

- Current Aurum preset-record JSON roundtrip without mutation.
- Rejection of malformed and future preset records.
- Engine migration from versions 1 through 12 into schema v13, with neutral defaults for capabilities that did not exist in the source version.
- Identity-safe preset application and non-aliasing of persisted sound data.
- Browser-audition expression snapshots reaching Aurum pressure routes audibly.
- Deterministic preview precedence: direct automation replaces the manual destination base, macro automation replaces the persisted macro source, and pressure or other route sources remain additive.
- Independent Macro 1 and Macro 2 values normalize through the shared route contract; Macro 2 audibly reaches an Aurum operator-level destination in browser and native focused renders.

## Focused native evidence

`build-native/bin/BeatBackendStress --aurum` covers the corresponding native guarantees:

- Dense bipolar FM/RM/feedback at 44.1, 48, and 96 kHz across 1, 17, 257, and 4096-sample blocks.
- Finite, bounded, non-subnormal output and block-size-invariant samples.
- Exact oscillator-work accounting with six operators and maximum unison.
- Repository serialization roundtrip for Aurum matrices, operators, and routing.
- Sample-exact repeated live renders plus bounded live/export WAV residuals at all three sample rates.
- Two 48 kHz / 512-sample realtime tiers: eight notes at 4-unison/2x with an 80% median-load ceiling, and three notes at 8-unison/4x with a 90% ceiling. Both require zero new deadline overruns.

The final 2026-07-26 focused run passed. Its observed median loads were `56.93%` and `72.52%`; those observations are machine-specific and are not product-wide supported-load limits.

## Why M4 remains open

The engine evidence above is sufficient for this bounded closure increment, but M4 still cannot be marked complete:

- Browser audition captures pressure and the other current expression values when rendering begins, but expression changes during an already-rendered audition are not continuous until Aurum has a streaming preview path.
- The exit gate still needs explicit multi-note/voice isolation evidence proving modulation state cannot leak between notes or voices.
- Additional shared sources and destinations remain capability breadth work: more envelopes/LFOs/macros, operator tuning and matrix targets, and filter resonance/drive.

Release-readiness work also remains separate: browser/native bounded-difference testing, alias-energy and spectral cross-rate methodology, release-machine performance limits, accessibility/responsive coverage, factory listening sign-off, and durable audio hashes.
