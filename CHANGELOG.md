# Changelog

All notable Beat changes are tracked here. Dates use local project dates.

## Unreleased

### Added

- Added Split Lanes to Tracks for Drum Sequencer and Drumpad segments, creating
  one routed child track per lane with linked move, trim, and loop editing until
  the split clips are ungrouped.
- Added native-compatible right-click menus across library and arrangement
  surfaces, including macOS Control-click and keyboard menu access, plus direct
  New Track actions for audio files and reusable MIDI/drum components.
- Added an instrument context-menu action that creates a bound track and an
  empty MIDI or mapped drum-loop segment according to the instrument type.
- Reworked instrument taxonomy editing into Category and Subcategory controls,
  with searchable user-defined Tags beside them.
- Added descriptive information popovers beside core ribbon titles, including
  accessible multi-page Back/Next guides for workflows that need more than one
  concise explanation.
- Added nondestructive Tune To controls for audio/sample segments, with
  searchable MIDI pitch selection, matching editor/arrangement/export
  playback, project persistence, tune-aware trim/split behavior, and a compact
  pitch badge at the segment end.

### Changed

- Unified MIDI notes, drum steps, and drumpad hits behind a cached 960-tick
  sorted event compiler shared by browser playback, native playback, bounce,
  and export, with binary-search scheduling for the active time window.
- Simplified the Drum Sequencer grid by labeling beat starts instead of every
  subdivision, collapsing per-hit pitch, volume, and lean decorations into one
  quiet customization marker, and reducing playback and cell-border emphasis.
- Retired Aether from user-facing instrument workflows: Lumen is now the
  exposed synth and plugin-fallback engine, while legacy Aether instruments
  remain playback-compatible but cannot be browsed, selected, created, or
  opened for editing.
- Separated audio-bus Sends into its own channel section, added explicit Add
  and Remove routing controls to Inputs, and changed instrument repository rows
  to audition on double-click without a per-row play button.
- Reduced the empty-timeline context menu to Create MIDI, Create Drum
  Sequencer, and Create Drumpad, removing engine-specific segment types and
  replacing Aether-specific segment automation wording with Instrument.

## 0.3.2 - 2026-08-03

### Added

- Added MusicXML and PDF/image score import with Audiveris primary recognition,
  homr page recovery, retained review artifacts, orchestral track mapping, and
  high-definition factory score samplers.
- Added collaboration-ready project and library metadata, beta-readiness gates,
  deterministic packaging checks, and dense native/project stress fixtures.
- Added standards-corpus indexing, improved generated bass and drum
  accompaniment, MIDI remix support, and saved sheet-to-song test projects.

### Changed

- Added Almarai typography, light/dark/mellow theme contrast behavior, refined
  asset-library layouts, and expanded loading feedback across the app.
- Made release dependency installation reproducible with `npm ci`, pinned
  Python audio/OMR runtime locks, and weekly npm, PyPI, and JUCE freshness
  checks; updated compatible frontend packages without crossing major-version
  boundaries.
- Moved npm, Vite, CMake, JUCE, app-bundle, and release-archive output outside
  the source workspace while retaining lightweight compatibility paths for
  existing developer commands.

### Fixed

- Matched the native window header, controls, border, and startup surface to
  the selected Dark, Light, or Mellow theme, with native theme persistence
  across launches.
- Expanded the arrangement lane viewport to the full available track-panel
  height so its horizontal scrollbar remains docked to the bottom edge.
- Changed untinted segment bodies to a true white surface in Light mode while
  retaining black note and waveform detail.
- Changed the shared Beat logo to black throughout Light mode, including
  project cards, editor branding, menus, and startup surfaces.
- Reduced the arrangement instrument browser scrollbar to a flush 2px rail
  without a reserved outer gutter.
- Compressed MIDI segment identity, loop, repeat, color, and instrument controls
  into one header row with a direct Loop toggle.
- Fixed piano-roll length resizing compounding while dragged, note moves
  recentering the viewport, and unclear Light-mode marquee/tool/note selection.
- Fixed native arrangement playback omitting MIDI instruments selected by
  individual segments or drum rows when they differ from the track instrument.
- Fixed a macOS 26 CoreAudio buffer-size mismatch that could corrupt memory and
  crash Beat during startup or the first instrument audition.
- Fixed mono and not-yet-active output layouts preparing fewer master-effect
  channels than Beat's stereo mix bus requires.

## 0.3.1 - 2026-08-02

### Changed

- Redesigned native and in-app startup feedback around Beat's timeline visual
  language and added shared loading indicators and skeletons for Recent
  Projects, asset libraries, waveform decoding, preset browsing, and plugin
  refreshes, including reduced-motion behavior.

## 0.3.0 - 2026-08-01

### Added

- Added Timeline Jumping, a sampler mode that maps independent source-audio
  timeline slices to MIDI notes without pitch-shifting the recording.
- Added a velocity-layered, multisampled Salamander grand piano instrument.
- Added role-aware song generation with configurable speed, genre, and
  randomness, plus saved generation fixtures.
- Added Transkun-led piano transcription, multi-instrument transcription
  routing, repeated-pattern detection, and saved MP3 translation fixtures.
- Added editable track automation lanes and nondestructive grouped-note
  arpeggiation in the timeline and MIDI editor.

### Changed

- Improved MIDI selection, quantization, note-property editing, grid hierarchy,
  segment coloring, cross-track drag previews, and instrument-editor controls.
- Simplified track recording, export review, audio-bus controls, and automation
  editing while extending browser/native playback parity.

### Fixed

- Fixed strict sampler pitch mapping so unassigned Timeline Jumping keys remain
  silent rather than falling back to an unrelated sample or synth voice.
- Fixed sample-zone offsets, sampler audition pitch, MIDI velocity visibility,
  context-menu selection, and stable drag interaction across DAW controls.

## 0.2.2 - 2026-07-29

### Added

- Added a global diagnostic log with per-session clear and snapshot-save actions.
- Added project-local recovery autosave capture alongside validated timestamped
  `.beat` backups.
- Added expanded Lumen and Aurum instruments, modulation, preview, performance,
  and stress-test coverage.
- Added shared per-route Linear, Ease In, Ease Out, and S-Curve modulation
  remapping for Lumen and Aurum with prepared native evaluation.
- Added five Lumen-only prepared harmonic-domain wavetable warps with cached
  native tables, browser preview parity, schema-gated persistence, and factory
  patch coverage.
- Added block-prepared Legacy, Aether, Lumen, and Aurum scalar render kernels
  with compact active-source indices and route-lane masks.
- Added a native-SIMD accumulation path for full 16-voice Lumen wavetable
  unison, with an exact scalar fallback for smaller unison widths.
- Added Lumen v16 per-LFO octave-rate keytracking with exact zero-default
  migration, browser/native parity, project persistence, and factory coverage.
- Added Aurum browser-audition expression snapshots and a verified deterministic
  precedence contract across manual values, direct automation, macros, and
  pressure/modulation routes.
- Added a real audio-segment waveform and transport editor with source-trim
  seeking, fades, gain, looping, and project-engine preview routing.
- Added deterministic sample-level editor/project playback parity coverage for
  expressive Lumen MIDI clips and trimmed audio clips with track effects.
- Added per-slot Lumen audio-library wavemap resynthesis with Full, Transient,
  Sustain, and bounded Manual analysis windows.
- Added an independently editable Aurum Macro 2 source with browser/native
  operator-destination coverage.
- Added reproducible two-minute piano-rock and disco-funk cover-study projects
  reconstructed from user-supplied recordings, with editable Lumen MIDI,
  sample drums, source-matched harmony/forms, and review WAVs.

### Changed

- Consolidated compatible Nodemap CV sources into one CV Source picker while
  preserving node identity, connections, and shared parameters when switching
  types.
- Limited the generic import workflow to supported audio files and labeled it
  explicitly as `Import Audio`.
- Refined Home recents, audio and instrument libraries, export review, timeline
  automation, segment looping, recording, mixer controls, and startup feedback.
- Renamed the Lumus product surface and active engine terminology to Lumen.

### Fixed

- Fixed project opening from Finder and Recent Projects across cold and warm app
  launches, including queued native document-open delivery.
- Fixed severe Aurum voice-render bottlenecks caused by repeated inner-loop
  envelope, tuning, panning, and inactive-routing calculations.
- Hardened export rendering and project recovery around structural validation,
  atomic file replacement, missing assets, and recoverable backups.
- Fixed sampler audition and waveform-preview routing, audio-preview resets,
  automation-point selection and dragging, and shared knob/slider interaction.
- Hardened MIDI note selection and aligned MIDI, drum, and drumpad editor
  playback with the project engine, including sampler routing, note curves,
  automation, gain, transpose, looping, and global-transport exclusivity.
- Fixed native one-shot preview lifecycle cleanup so synth release tails and
  sampler auditions return automatically to paused safety silence.
- Added rectangular and additive drum-grid selection with modifier dragging,
  select-all, Escape clearing, and accessible selected-cell state.
- Updated DAW and Nodemap verification for the Lumen v16 capability bank and
  the consolidated CV Source picker compatibility aliases.

### Removed

- Removed AI training controls, automatic runners, native training IPC, and
  runtime training events until the feature is intentionally redesigned.

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
- Restyled the static user guide and plugin help pages to use Beat's compact
  monochrome app surface rather than generic article styling.
- Compiled user-guide, plugin-help, compatibility, how-to, and version-history
  material into one app-styled documentation webpage.

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
