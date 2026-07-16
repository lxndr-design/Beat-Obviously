# Milestone C3F2 disconnected playback validation

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> share with testers or collaborators, sell, or convey source or binaries.

Date: 2026-07-16

Branch: `codex/aether-c3f2-playback`

Status: **disconnected fixed-capacity playback, active-position, and active
source-replacement gates pass; alignment remains open, so C3F2 is not yet
closed and C3F3 is not authorized by this report**

## Implemented boundary

`SpectralSourceSlot` consumes only an immutable, control-thread-validated
artifact-v2 object. Preparation reconstructs float64 peak-phase history and
builds the window and resampler tables outside the callback. The callback owns
four fixed voices, fixed FFT/overlap/canonical rings, float64 peak synthesis
phase, and atomic/preallocated telemetry. There is no file selection, decode,
analysis, allocation, schema, IPC, UI, managed asset, factory content,
`SourceSlotIndex::three` attachment, `AudioEngine` caller, or product route.

Standard synthesis uses the accepted 1024/256 square-root-Hann WOLA contract.
Peak phases follow deterministic predecessors in float64, transient frames
reset synchronously, and assigned bins retain their stored relative phase.
Pitch uses ratio `2^(q/12)`, direct bin scaling with linear complex deposition,
Nyquist discard, collision summation, and bounded energy normalization. The
implemented range is plus or minus 12 semitones. Source duration does not
change.

The canonical 48 kHz timeline feeds a fixed 2048-phase, maximum-96-tap Kaiser
converter with beta 10.5 and linear coefficient-phase interpolation. Exact
48 kHz bypasses the converter. Active taps are 96 at 44.1 kHz, 53 at 88.2 kHz,
48 at 96 kHz, and 16 at 192 kHz. A 1024-canonical-sample scheduling pre-roll distributes
indivisible inverse transforms across small callbacks. Underflow is explicit
telemetry and measured zero.

## Objective results

- Pitch: the stationary reference measures 440.00 Hz; plus 12 semitones
  measures 880.00 Hz with the 0.25 Hz test estimator.
- Resampling: 10 kHz passband delta at 192 kHz is `+0.00001405 dB`; worst
  measured 192 kHz image is `-116.734 dB`; a 23 kHz input downsampled to
  44.1 kHz produces a 21.1 kHz alias at `-112.636 dB` relative to the 48 kHz
  reference.
- Nyquist: pitching the 15 kHz fixture up one octave at 48 kHz is discarded at
  `-66.485 dB` energy relative to the unshifted fixture.
- Position/freeze: fixed normalized positions 0.2 and 0.8 on the generated
  chirp produce finite audible and materially distinct output
  (`L1 difference 1112.92`). Freeze and ordinary playback are exactly
  deterministic between block sizes 64 and 257.
- Active position: a control-rate atomic request prepares a second fixed lane
  through the existing 1024-canonical-sample pre-roll and then performs an
  equal-power 5 ms crossfade. Three requests produce two completed transitions;
  the second request deterministically supersedes the first pending pre-roll,
  while a request during an audible fade becomes the sole next target. Output
  is exactly equal at block sizes 64 and 257, maximum adjacent-sample change is
  `0.0218091`, and an active 48-to-96 kHz change preserves/completes the fade.
- Active replacement: three fixed ownership banks allow an immutable source to
  remain pinned by the outgoing lane, a replacement to render in the incoming
  lane, and one latest source to wait during the fade. Replacement supersedes a
  position still in pre-roll; a position request remains pending and applies to
  the final source afterward. Two replacements plus the deferred position are
  exactly equal at block sizes 64 and 257, maximum adjacent-sample change is
  `0.0126168`; waveform, level, pan, and stereo-width changes share the same
  fade. Retired ownership is returned only through the control-side
  `takeRetiredSource()` boundary.
- Reported latency is 1691, 1792, 3341, 3631, and 7198 host samples at
  44.1, 48, 88.2, 96, and 192 kHz respectively. It includes scheduling
  pre-roll, WOLA alignment, and converter group delay.
- Capacity: four voices are accepted and the fifth is deterministically
  rejected. Active publication is accepted while a reader-free ownership bank
  remains; a fourth publication during the pressured two-replacement fixture is
  rejected when all three banks are occupied. Invalid prepared data is rejected.
- Realtime safety: allocation, blocking lock, file/stream, lazy-init, and
  container-growth violations are all zero around pressured note/render work.

The opt-in extended matrix covers five rates, blocks 16/32/64/128/256/512/1024
and irregular 257, zero through four frozen voices, active replacement plus
three position requests per nonzero-voice cell, and 1000 measured callbacks per
cell. The final run reports worst `P99.9(U)=0.276000` and `max(U)=0.385254`, below the provisional 0.50/0.80
gates, with zero detector violations and zero synthesis underflows. These are
single-machine development measurements, not a whole-engine budget claim.

## Repository gates and freeze

- Focused playback and the extended matrix pass.
- The complete source-matched native suite passes in 12.89 seconds wall /
  11.46 seconds user / 0.86 seconds system with only the existing narrowly
  scoped `baseline.recent-project-exists` macOS TCC waiver.
- Full `verify:non-native` passes, including the two factory benchmark render
  freezes and the production frontend build.
- Embedded-frontend Release `Beat`, `BeatBackendStress`, and
  `BeatAetherBaseline` build. Packaging creates the root app; local
  LaunchServices registration still reports the pre-existing `-10822` warning.
- The final disconnected baseline contains 150 WAVs and retains normalized
  manifest `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.
  Its latest timing-bearing JSON SHA-256 is
  `a3c8efcac3aa3453d47de861061d3de5c7f3ae93023dcf4e39d95c53a63c6cc8`;
  render times were 12.81–15.74 ms (13.45 ms mean), reported peak RSS was
  14,925,824 bytes, deadlines were zero,
  and unchanged queue telemetry of 64 accepted / 16 rejected / 16 overflow.

## Remaining gate

The active-position and active-source-replacement contracts are now implemented
and measured. Replacement-at-every-overlap-phase coverage, sample-offset
note-event alignment, product
latency compensation, managed artifact import, and product live/offline
integration remain open. No baseline is updated to hide those omissions. The
next implementation work may remain on the disconnected engine, but C3F2 must
not be marked closed and C3F3 must not begin until these items are resolved and
reviewed.
