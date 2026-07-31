# Export audit — 2026-07-27

## Current pipeline

Beat exports through one offline native renderer shared by full-project, review-range,
selected-track, all-stems, and bounce-in-place workflows. Export settings support
44.1/48/88.2/96/192 kHz, 16/24/32-bit integer PCM, mono or stereo, five offline block
sizes, standard or offline-HQ processing, optional effect tails, progress, and
cancellation. Completed single-file exports receive peak, true-peak, RMS, LUFS,
clipping, DC-offset, and stereo-correlation analysis.

## Defects corrected in this audit

- `Include effect tail` now reaches project, selected-track, all-stems, and bounce
  exports instead of affecting review-range export only.
- Mono Reference now renders the stereo signal graph and performs a post-master
  `(L + R) / 2` fold-down. It no longer changes stereo DSP topology by preparing the
  engine as one-channel audio.
- A selected child-track stem keeps its ancestor group path active, including group
  gain and processing. Direct export of a group track is rejected until a defined
  group-stem policy exists.
- Stem filenames avoid both duplicates within a batch and existing WAV files in the
  target directory.
- Cancelled or failed all-stems batches remove files created earlier by that batch.
- Job status distinguishes cancellation from failure. Pending, failed, and cancelled
  paths do not enter Recent Destinations.
- A stale blocked Project Health result can be retried and revalidated instead of
  permanently disabling the Export button.
- The last successful single-file analysis remains available in Export Review after
  the transient export-status panel is dismissed.

## Verification performed

- Full `BeatBackendStress`, including offline export, tail duration, 32-bit stereo to
  mono fold equality, grouped child-stem gain/routing, and group-track rejection.
- Frontend TypeScript build plus DAW-core, interaction, audio-boundary, and document
  round-trip verifiers.
- Visible Export Review inspection in the app browser for presets, render controls,
  tail toggle, destination/history, Project Health, mono selection, and range
  readiness behavior.
- Native `Beat` and `BeatBackendStress` targets rebuilt after the changes.

## Known capability limits

- Output is RIFF/WAV only. There is no AIFF, FLAC, BWF metadata, or RF64 path.
- RIFF chunk sizes are 32-bit, so exports exceeding the classic WAV size limit are
  rejected with `Export is too long for this WAV writer.`
- Integer PCM conversion rounds and clamps directly. It does not currently apply
  configurable dither or noise shaping; this should be a deliberate render option,
  not an implicit behavior change.
- All-stems export has per-file renderer validation but no aggregate post-export
  analysis summary for the folder.
- Automated tests cover the frontend contract and native renderer independently;
  the macOS save-panel interaction itself remains a manual integration boundary.

## Recommended next tranche

1. Add explicit dither policy (`Off`, `TPDF`) for 16/24-bit delivery renders, with
   deterministic test seeds and silence/noise-floor assertions.
2. Add RF64 or a segmented-safe long-export strategy before advertising 192 kHz
   archival renders for long projects.
3. Add an all-stems completion manifest with file-by-file duration, format, peak,
   failure, and cancellation results.
4. Define whether group export means post-group bus audio, child stems through group
   processing, or both; then expose separate, unambiguous modes.
