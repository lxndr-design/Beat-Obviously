# Changelog

All notable Beat changes are tracked here. Dates use local project dates.

## 0.2.0 - 2026-07-04

### Added

- Added a user-guide documentation page with table-of-contents navigation for
  project setup, tracks, instruments, Aether, Nodemap, MIDI/drum editing,
  recording, export, preferences, and project health.
- Added a plugin help page with compatibility status, DecentSampler import
  workflow, plugin adapter expectations, and future hosting boundaries.
- Added Aether factory preset bank data and expanded Aether/Nodemap verifier
  coverage.
- Added initial audio recording modal files for device selection, record/stop,
  waveform review, and trimming workflow.

### Changed

- Hardened the Aether editor layout, controls, patch naming, modulation matrix,
  macro controls, waveform previews, LFO/envelope controls, and factory preset
  handling.
- Hardened the Nodemap editor around protected Instrument Out behavior, preview
  display, connector geometry, cable validation, node metadata, and instrument
  editor footer behavior.
- Refined MIDI, drum, track, segment, export, preferences, and instrument
  library workflows as part of the Solid UI closeout.
- Updated plugin adapter handling so DecentSampler imports remain sampler-backed
  package adapters rather than falling back to generic synth editing.

### Fixed

- Fixed multiple slider and knob drag affordance issues across Aether controls.
- Fixed playback/audition focus boundaries so instrument editor hotkeys do not
  accidentally trigger global transport playback.
- Fixed default instrument naming to avoid duplicate generic Aether/Nodemap
  names.
- Fixed several document and browser-verifier regressions around Nodemap,
  Aether, DAW editing, and audio boundary behavior.

### Known Gaps

- AU/VST3 execution is not a supported live plugin host yet. Beat can preserve
  placeholder metadata, but third-party binary plugin execution remains a
  future protected-host feature.
- DecentSampler compatibility is implemented as an import adapter plus Beat
  sampler bridge, not as the official DecentSampler runtime.
- The DAW is still pre-1.0; mixer/routing, sampler keymap editing, asset repair,
  export polish, and broad browser/runtime proof remain active closeout areas.
