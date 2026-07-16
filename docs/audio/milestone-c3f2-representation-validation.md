# Milestone C3F2 artifact-v2 representation validation

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> supply to testers or collaborators, sell, or convey source or binaries.

Date: 2026-07-16

Branch: `codex/aether-c3f2-representation`

Status: **artifact-v2 representation accepted by measured analysis gates;
fixed-capacity playback not implemented**

## Scope and boundary

This slice implements and validates spectral artifact schema/algorithm v2. It
does not implement a spectral `SourceSlot`, touch `SourceSlotIndex::three`, add
a product schema, import path, managed asset, preset, UI, IPC edge, offline
engine edge, or audio-callback caller. Analysis, serialization, decoding,
validation, allocation, hashing, FFT preparation, and comparison rendering run
only on native test/control threads.

## V2 phase contract

- Every frame detects ordered peaks from the shared L/R reference magnitude.
- Each current peak claims at most one prior-frame peak, and each prior peak is
  claimed at most once. Matching visits current peaks from low to high and
  chooses the nearest unused predecessor within four bins; equal-distance ties
  choose the lower prior index.
- A matched peak stores float64 wrapped phase evolution for L and R. An
  unmatched peak stores float64 wrapped absolute phase for that frame.
- Every bin stores an L/R float32 phase relative to its assigned peak, wrapped
  canonically into `[-pi, pi)`.
- Bin-to-peak assignment chooses nearest frequency distance; midpoint ties
  choose the lower-frequency peak.
- If local-maximum detection finds no peak, the lowest-bin global maximum is a
  deterministic synthetic peak. Thus a valid artifact never contains an
  unassigned bin.
- Peak evolution and relative phase are decoded to float64 frame phases before
  inverse transforms. This validation rendering is test/control-thread work,
  not a realtime playback implementation.

## Reconstruction corpus

Each case is two seconds at 48 kHz. RMS and peak columns are absolute sample
error; dB is relative squared reconstruction error. Raw WOLA is measured
separately from artifact roundtrip.

| Case | Channels/content | Raw WOLA dB | V2 dB | V2 RMS | V2 peak | Float32 all-bin dB | Float64 all-bin dB |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: |
| stationary-mono | mono sine | -139.020 | -138.468 | 4.63911e-8 | 2.08616e-7 | -118.423 | -138.662 |
| stationary-stereo | coherent stereo sine/phase offset | -139.104 | -138.653 | 3.22392e-8 | 2.08616e-7 | -119.800 | -138.784 |
| multi-tone-stereo | four distinct tones across L/R | -139.804 | -139.374 | 2.40136e-8 | 1.19209e-7 | -121.432 | -139.483 |
| harmonic-mono | twelve harmonic partials | -139.700 | -139.237 | 3.28362e-8 | 1.78814e-7 | -129.223 | -139.355 |
| transient-stereo | two decays plus hard stereo impulse | -140.521 | -140.310 | 1.33976e-9 | 1.19209e-7 | -106.506 | -140.171 |
| noise-mono | deterministic white noise | -139.544 | -138.989 | 2.27569e-8 | 1.19209e-7 | -126.288 | -139.180 |
| noise-stereo | independent deterministic white noise | -139.533 | -138.955 | 2.27497e-8 | 1.19209e-7 | -126.044 | -139.163 |
| peak-transitions-stereo | appearing/disappearing/converging tones | -139.141 | -138.716 | 2.51572e-8 | 1.49012e-7 | -121.565 | -138.860 |

V2 improves on independently encoded float32 all-bin residuals by 9.99–33.80
dB across the corpus and remains within 0.208 dB of independently encoded
float64 all-bin residuals. Float32 relative
phase is therefore not the dominant error and remains approved. No fallback to
float64 per-bin storage was made.

## Determinism, transitions, and decoding

Repeated analysis preserves payload/source hashes, peak bins, assignments,
predecessors, and serialized bytes. Decode followed by reserialization is
byte-identical. Equal-magnitude detection, midpoint assignment, flat/no-peak
fallback, predecessor-distance boundaries, and repeated matching have focused
fixtures.

The transition corpus records 43,261 matched identities, 7,552 appearances,
7,554 disappearances, 367 peak-count changes, and 99,596 changed bin
assignments. V2 output stays
within `1.49012e-7` peak sample error and below `-138.716 dB`; the error change
across every hop boundary is `8.9407e-8`, below the `2e-6` gate. These gates cover appearance,
disappearance, merge/split pressure, and reassignment without concealing an
output discontinuity.

Decoding rejects oversized/truncated/trailing input, future schema or analysis
versions before vector allocation, invalid dimensions/counts, malformed
hashes, hash mismatch, non-finite or out-of-range magnitude/relative/peak
phase, inconsistent planes, invalid/duplicate predecessor claims, invalid peak
assignment/order/termination, non-binary transients, Parseval mismatch, and
payload overflow. Cancellation returns no artifact.

## Measured 48 MiB duration

The exact serializer was exercised with the worst legal density of 255 peaks
in every frame. Binary search over materialized serialized artifacts measured:

- 3,640 frames: 50,326,904 bytes, accepted;
- 3,641 frames: 50,340,730 bytes, rejected against 50,331,648 bytes;
- guaranteed source: 931,072 samples at 48 kHz, or 19.397333 seconds.

Schema v2 therefore freezes `maxFrames=3640` and
`maxInputSamples=931072`. The former 29.984-second C3F1 provisional limit is
superseded. The 48 MiB budget is unchanged.

## Verification and stop state

Full `verify:non-native` and Release `Beat`, `BeatBackendStress`, and
`BeatAetherBaseline` builds pass. The unwaived native run stops only at
`baseline.recent-project-exists`; the approved-waiver run passes every later
section in 20.90 seconds wall / 17.36 user / 1.59 system with 262,553,600-byte
maximum RSS. That RSS includes the repeated two-second three-representation
corpus and materialized near-48-MiB worst-case artifacts; it is test-process
memory, not callback or production steady-state memory.

The external baseline regenerated all 150 WAVs with unchanged normalized
manifest `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.
Timing-bearing JSON SHA-256 is
`908572a538975a5582d14639df0c135dc37922d4a84a8970959c41d4f6467d37`;
render times were 12.98–15.75 ms (13.64 ms mean), harness peak RSS was
14,942,208 bytes, deadline overruns were zero, and queue telemetry remained
64 accepted / 16 rejected / 16 overflow. Pre-sizing the exact serializer cut
the materialization run from an observed 801,849,344-byte peak to the final
262,553,600-byte peak without changing a serialized byte or acceptance result.
No baseline artifact or waiver was
updated.

Stop here before fixed-capacity playback. C3F2 playback still requires a
separate implementation/review of fixed buffers, identity-phase-locked motion,
pitch, position/freeze, resampling, latency, callback work ceilings, realtime
instrumentation, and deadline pressure across all host rates and block sizes.
