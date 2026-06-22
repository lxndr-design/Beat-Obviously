# Remaining Work Checklist

This is the consolidated working checklist for Beat. The detailed plans remain in:

- `docs/daw-comprehensiveness-roadmap.md` for v1 DAW scope.
- `docs/aether-completion-checklist.md` for Aether-specific burn-down.
- `docs/serum-style-synth-roadmap.md` for product/readiness percentages and long-form progress notes.

Status legend:

- `[x]` done and covered by at least one build, stress, verifier, or runtime proof.
- `[~]` partly done; usable, but not complete enough to close.
- `[ ]` not done or only placeholder-level.

## Immediate Build Queue

1. `[~]` Aether instrument FX rack UI.
   - `[x]` Build dedicated instrument-owned FX rack controls.
   - `[x]` Add add/remove/reorder/bypass affordances.
   - `[x]` Show latency/tail badges.
   - `[x]` Preserve instrument-owned FX through synth patch/instrument roundtrip.
   - `[ ]` Wire preset handoff once preset storage exists.
   - `[~]` Verify with synth roundtrip coverage and live/export parity stress using both instrument FX and track FX; still add browser-level interaction coverage.
2. `[~]` Wavemap drawing and resynthesis refinement.
   - Add richer draw modes beyond mini-waveform and partial lanes.
   - Clarify frame editing constraints.
   - Add additive-vs-freehand editing tools.
   - Add deterministic resynthesis fixtures with stable source metadata.
3. `[ ]` Visible Aether automation lanes.
   - Add lanes for pitch, level, phase, filter, wavetable position, and macro targets.
   - Cover track, segment, and piano-roll note automation entrypoints.
   - Add point drag, curve selection, playback preview, and live/export parity coverage.
4. `[ ]` Aether preset storage and migration.
   - Add named instrument presets and effect presets.
   - Add Save As preset, delete, restore default, and schema-version behavior.
   - Add migration fixtures for older preset/effect defaults.

## DAW Editing

- `[~]` Browser-level smoke for marquee, drag, resize, split, fade, crossfade, and loop marker interactions.
- `[~]` Track/body/segment interaction consistency pass.
- `[~]` Richer destructive-operation policy for undo/redo.
- `[~]` Crossfade UI and visible fade-handle polish across segment types.
- `[~]` Broader renderer-independent selection and drag/resize edge-case tests.

## Recording And Takes

- `[~]` Record-arm UI in track headers/details.
- `[~]` Input device/channel picker with permission and error states.
- `[~]` Per-track input monitoring controls.
- `[~]` Count-in controls in transport or recording preferences.
- `[~]` Recording latency calibration UI with measured/manual/reporting fields.
- `[ ]` Take naming and destination policy.
- `[ ]` Commit/cancel UX after recording.
- `[ ]` Track take list with keep, rename, reveal, remove from project, and remove managed file actions.
- `[ ]` Recording project-health warnings for missing take files and invalid input metadata.

## MIDI, Drum, And Components

- `[~]` Piano roll polish: box select, note edge resize, velocity lane, pitch curve lane, duplicate/nudge/quantize, shortcuts.
- `[~]` Drum grid polish: velocity, accent, lean, probability, row mute/solo, row reorder, sample assignment, fills/variations.
- `[~]` Component workflow: save selected regions, preview, drag into arrangement, edit source, duplicate/version.
- `[~]` Pattern page handoff from passive preview to real pattern browser/editor flow.
- `[ ]` Component provenance/dependency persistence and roundtrip tests.

## Automation

- `[ ]` Track automation lanes in arrangement view.
- `[ ]` Lane chooser for track gain, pan, effect params, instrument params, master params, sends, and macros.
- `[ ]` Automation point add/move/delete, multi-select, copy/paste, quantize, value snapping.
- `[ ]` Curve editing UI using the existing curve types.
- `[ ]` Segment-local automation editor.
- `[ ]` Note automation lanes in piano roll for pitch, velocity/level, filter, wavetable position, and macro targets.
- `[ ]` Automation visibility policy: active lanes, empty lane hiding, pinned favorites.
- `[ ]` Automation conflict rules for project vs segment vs note vs live knob writes.
- `[ ]` Invalid automation repair/warning paths in Project Health.

## Mixer, Routing, Groups, And Freeze

- `[ ]` Mixer panel or expandable mixer view.
- `[ ]` Track channel strips: meter, fader, pan, mute, solo, arm, input, output/group, sends, inserts.
- `[~]` Return bus UI for creating buses, routing sends, mute/solo, effects, and level.
- `[~]` Group/folder track UI for create, assign parent, collapse/expand, group effects/sends.
- `[~]` Freeze/bounce UI with freeze selected track, bounce in place, export stem, reversible unfreeze metadata, and clear parent-routing policy.
- `[~]` Latency reporting per track/effect route.
- `[~]` Master section polish: input gain, compressor, EQ, output gain, limiter, loudness/peak readouts.
- `[ ]` Group/return/freeze Project Health validation and stem/freeze parity for group/send scenarios.

## Asset Management And Project Portability

- `[~]` Global audio-file actions: relink, replace, reveal, delete, copy into project, remove unused.
- `[~]` Instrument actions: duplicate, version, reveal source, repair missing samples, inspect sample zones.
- `[ ]` Velocity/key/round-robin/choke editor for sampler instruments.
- `[ ]` Project asset browser with external/bundled/missing/unused/managed indicators.
- `[ ]` One-click package project assets for portability.
- `[~]` Copy-on-save policy surfaced in document UI.
- `[ ]` Safer delete flows with reference counts and affected tracks/segments.
- `[ ]` Shared asset reference graph helper used by Project Health and UI.

## Export, Review, And Delivery

- `[ ]` Export preset UI for full mix, review range, selected track stem, all stems, and bounce selection.
- `[ ]` Format presets for 44.1/48/96 kHz, 16/24/32-bit, mono/stereo, tail include/exclude.
- `[ ]` Export destination defaults and recent export folder.
- `[ ]` Post-export review panel for duration, sample rate, bit depth, peak, true peak, RMS, LUFS, clipping, DC offset, and correlation.
- `[ ]` Unified export job panel for cancel, failed, and success states.
- `[ ]` Batch stem export naming policy.
- `[ ]` All-track stems export helper if repeated single-track export is not enough.
- `[ ]` Export preset serialization in preferences.
- `[ ]` Null-test or bounded-difference checks where deterministic parity is expected.
- `[ ]` Export formats beyond PCM WAV after render path stability is fully locked.

## Project Health And Recovery

- `[~]` Health dashboard categories for fatal structure, missing media, orphaned sidecars, stale IDs/metadata, recording/input metadata warnings, and export warnings.
- `[~]` Guided repair flows for every deterministic repair.
- `[~]` Backup browser improvements: preview metadata, restore copy vs replace, reveal backup.
- `[~]` Current document path and backup status visible in top/app menu.
- `[ ]` Validate-before-export option, default on.
- `[ ]` Crash/restart recovery story from local autosave vs last saved document.
- `[ ]` Verifier coverage for every Project Health action.

## Aether Synth

- `[ ]` Heavier nonlinear warp experiments after runtime warp oversampling strategy exists.
- `[~]` Browser preview parity for live macro route changes.
- `[~]` Project/document roundtrip fixtures for macro route state.
- `[~]` Visible macro lanes and macro conflict display.
- `[~]` Modulation matrix semantic cleanup: per-target ranges, conflict clarity, disabled routes, source-specific editing.
- `[~]` Deeper envelope visual editing with better loop/curve handles and assignment feedback.
- `[~]` Performance/expression UX for mod wheel, pitch bend, velocity, keytracking, mono/legato, glide, and voice caps.
- `[~]` Reduce one-off controls inside synth surfaces and continue moving controls to Solid UI kit primitives.

## Sampler And Plugin Import Layer

- `[~]` DecentSampler package/copy cleanup and versioning.
- `[ ]` Multisample/keymap editor UI.
- `[ ]` Explicit velocity-layer editor UI.
- `[ ]` Sample trimming, loop markers, crossfade loops, root-note detection helpers.
- `[ ]` Round-robin/choke/exclusive group editor.
- `[ ]` Real plugin-host feasibility pass for AU/VST3 with sandboxing and crash isolation.

## Generation

- `[~]` Measure Aether-aware instrument generation against the current Aether schema.
- `[ ]` Generated pattern structure: sections, fills, rests, density maps, ghost notes, accents.
- `[ ]` Complexity as musical density/variation, not instrument count.
- `[ ]` Drummer-like constraints: limb independence, backbeat anchors, phrase length, fills into transitions.
- `[ ]` Generation provenance and editable "why this pattern" metadata.
- `[ ]` Training/export loops that preserve accepted user edits.
- `[ ]` Generation tests per genre with explicit invariants.

## UI Coherence

- `[~]` Audit every modal footer/action row against shared footer primitives.
- `[~]` Replace one-off selects/dropdowns with shared primitives.
- `[~]` Extract shared asset browser list/table primitives.
- `[~]` Add empty/loading/error states for every panel.
- `[~]` Add consistent keyboard shortcuts and shortcut hints for transport, edit commands, tools, zoom, selection, and modals.
- `[~]` Preferences page for DAW behavior: snap, recording, export defaults, monitoring, autosave, backups.
- `[ ]` Browser smoke for visible hover, selected, disabled, and loading states on critical screens.

## Codebase Organization

- `[~]` Continue backend domain extraction around wavetable, realtime, sampler, effects, analysis, and parameters.
- `[~]` Finish frontend feature-boundary cleanup for DAW, Synth, Mixer, and Library surfaces.
- `[ ]` Move sequencer/transport into `Audio/Sequencing` when the next sequencing-heavy change lands.
- `[ ]` Split `AudioEngine` orchestration from render route/effects/sample voice helpers.
- `[~]` Continue splitting `InstrumentVoice` into smaller DSP modules when touching nearby code.
- `[ ]` Split giant stores into project, transport, document, library, plugin, and analyzer stores.
- `[ ]` Keep IPC schema additive/versioned and remove business logic from bridge code over time.
- `[ ]` Add focused tests near subsystem ownership as modules split.

## Verification Still Needed

- `[ ]` Browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, automation lanes, arrangement editing, export, relink, backup restore, and project health repairs.
- `[ ]` Null-test style live/offline comparisons where deterministic output is expected.
- `[ ]` Crossfade parity stress.
- `[ ]` Automation-heavy parity stress beyond the current dense Aether parity path.
- `[ ]` Group/send stem export stress.
- `[ ]` Recording commit rollback stress.
- `[ ]` Asset package/relink stress.
- `[ ]` Document roundtrip fixtures for mixer groups/returns/sends, automation lanes, freeze/bounce metadata, recording input profiles, export presets, and Aether preset migrations.

## Release Gate

- `[ ]` No known data-loss path.
- `[ ]` No known export-clobber path.
- `[ ]` No silent missing-media path.
- `[ ]` No untested document migration for new persisted fields.
- `[ ]` No backend feature without a stress or verifier path.
- `[ ]` No critical UI workflow without at least one browser or pure interaction smoke.
