# Remaining Work Checklist

This is the consolidated working checklist for Beat. The detailed plans remain in:

- `docs/daw-comprehensiveness-roadmap.md` for v1 DAW scope.
- `docs/aether-completion-checklist.md` for Aether-specific burn-down.
- `docs/serum-style-synth-roadmap.md` for product/readiness percentages and long-form progress notes.

Status legend:

- `[x]` done and covered by at least one build, stress, verifier, or runtime proof.
- `[~]` partly done; usable, but not complete enough to close.
- `[ ]` not done or only placeholder-level.

## Current Closeout View

Last audited: 2026-06-29.

Use this section as the short working list. The detailed domain lists below remain the full source of truth.

Current implementation focus:

- `[x]` Finish Aether automation point quantize/value snapping across note, segment, and track lanes.
  - Done: shared helpers, Piano Roll controls, Segment Editor controls, Track Details controls, and frontend interaction verifier coverage.
  - Remaining in automation: multi-select/copy-paste, broader browser interaction parity, conflict rules, and invalid automation warnings.

1. `[~]` Browser/runtime proof for critical flows.
   - Done: Aether automation browser fixture coverage for note, segment, and track lane entrypoints.
   - Done: Synth Editor macro browser fixture coverage for visible assignment lanes and overlapping-route conflict rows.
   - Done: Aether automation point-editor browser fixture coverage for Add Point, field editing, Quantize, and Snap Values across note, segment, and track Macro 1 lanes.
   - Done: Aether wavemap editor browser fixture coverage for Details analysis, Additive mode, Odd partials, Manual range, and Smooth interpolation.
   - Add browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, arrangement editing, export, relink, backup restore, and Project Health repairs.
   - Add visible hover, selected, disabled, loading, and migrated-framework smoke coverage on critical screens.
2. `[~]` Automation editing completion.
   - Done: first visible arrangement-view Aether track automation lane preview renders track-scoped automation without taking over timeline drag/drop.
   - Done: arrangement-view Aether track automation points can be dragged with free movement by default and shift-snap to the timeline subdivision.
   - Done: arrangement-view Aether track automation lane controls can add midpoint points and remove the active or last point.
   - Done: point-level add, move, delete helper coverage exists for Aether note, segment, and track lanes.
   - Done: visible note, segment, and track Aether point editors expose point beat/value editing plus add/remove controls.
   - Done: visible note, segment, and track Aether point editors expose quantize and value snapping controls with pure interaction verifier coverage.
   - Done: native IPC maps frontend `track.automation` lanes into backend project automation with track and instrument IDs, and dense Aether live/export stress covers a track-scoped multi-point Aether lane.
   - Add multi-select, copy/paste, and broader drag/browser interaction parity coverage.
   - Define project vs track vs segment vs note vs live-write conflict rules and surface invalid automation warnings.
3. `[~]` DAW editing and recording closeout.
   - Broaden marquee, drag, resize, split, fade, crossfade, loop marker, and selection edge-case tests.
   - Finish visible fade/crossfade UI polish and destructive-operation undo/redo policy.
   - Finish take naming, commit/cancel UX, take-list management, and recording health warnings.
4. `[~]` Mixer, routing, freeze, and export UX.
   - Build the mixer/channel-strip surface with fader, pan, meter, mute, solo, arm, sends, inserts, input, output, and group routing.
   - Finish return-bus, group/folder routing, freeze/bounce UI, reversible unfreeze metadata, and latency reporting.
   - Add export preset UI, export review panel, batch stem naming, export preference serialization, and remaining parity/null-test coverage.
5. `[~]` Asset and sampler management.
   - Finish global relink, replace, reveal, delete, copy-into-project, remove-unused, reference-count, and project-package flows.
   - Add sampler/keymap editors for velocity layers, sample trim, loop markers, crossfade loops, root-note helpers, round-robin, choke, and exclusive groups.
   - Run a real AU/VST3 plugin-host feasibility pass after the protected adapter layer is stable.
6. `[~]` Aether synth maturity.
   - Finish macro live-preview parity, visible macro lanes, deeper macro conflict/precedence display, and modulation matrix semantic cleanup.
   - Improve envelope visual editing, loop/curve handles, expression-source feedback, and remaining one-off synth controls.
   - Curate named Aether instrument/effect preset library UX beyond local Save As lists.
7. `[~]` Generation and musical intelligence.
   - Measure Aether-aware instrument generation against the current Aether schema.
   - Add structured beat/pattern generation with phrase sections, fills, rests, density maps, accents, ghost notes, and editable provenance.
   - Add genre/invariant tests and training/export loops that preserve accepted user edits.
8. `[~]` UI coherence and framework cleanup.
   - Continue replacing one-off selects, dropdowns, modal footers, action rows, asset lists/tables, and feature-local controls with Solid UI kit primitives.
   - Complete happy playback feedback: cyan active playback for segments/nodes/notes, MIDI drag audition, and approved mesh-gradient tint variants.
   - Keep React removed; continue consolidating remaining local controls into `frontend/src/solid-ui`.
9. `[~]` Codebase organization.
   - Continue backend extraction around wavetable, realtime, sampler, effects, analysis, sequencing, and parameters.
   - Split `AudioEngine`, `InstrumentVoice`, giant frontend stores, and feature-boundary modules as related work lands.
   - Keep IPC additive/versioned and add focused tests beside each subsystem split.
10. `[ ]` Release gate.
    - No known data-loss path.
    - No known export-clobber path.
    - No silent missing-media path.
    - No untested document migration for new persisted fields.
    - No backend feature without stress or verifier coverage.
    - No critical UI workflow without browser or pure interaction smoke.

## Immediate Build Queue

1. `[x]` Aether instrument FX rack UI.
   - `[x]` Build dedicated instrument-owned FX rack controls.
   - `[x]` Add add/remove/reorder/bypass affordances.
   - `[x]` Show latency/tail badges.
   - `[x]` Preserve instrument-owned FX through synth patch/instrument roundtrip.
   - `[x]` Wire local effect-chain preset save/load/delete handoff.
   - `[x]` Verify with synth roundtrip coverage, frontend interaction coverage, live/export parity stress using both instrument FX and track FX, and true browser smoke for current FX preset save/load/delete controls.
   - `[x]` Add true browser smoke for older/mixed-era FX preset load/delete with default-filled legacy params.
2. `[x]` Wavemap drawing and resynthesis refinement.
   - `[x]` Add richer draw modes beyond mini-waveform and partial lanes.
   - `[x]` Clarify frame editing constraints.
   - `[x]` Add additive-vs-freehand editing tools.
   - `[x]` Add deterministic browser/native source metadata and frame-analysis fixtures.
   - `[x]` Add deterministic full/transient/sustain/manual imported-audio selection windows, native IPC support, source-range metadata, and Solid import mode controls.
   - `[x]` Add visual/manual range picker polish for imported audio.
   - `[x]` Add deeper analysis display controls with source span, RMS, peak, zero-crossing, roughness, asymmetry, centroid, and dominant harmonic summaries.
3. `[~]` Visible Aether automation lanes.
   - `[x]` Add first visible piano-roll note automation lane selector/badges for pitch, wavemap, filter, amp, and macro targets.
   - `[x]` Add selected-note start/end value editing for visible piano-roll Aether lanes.
   - `[x]` Preserve note automation point timing during note drag/copy/paste and cover the helper behavior.
   - `[x]` Add draggable start/end point handles for visible piano-roll Aether lanes.
   - `[x]` Add editable midpoint values for visible piano-roll Aether lanes.
   - `[x]` Add curve selection for visible piano-roll Aether lanes.
   - `[x]` Add document roundtrip coverage for visible note-lane curve metadata.
   - `[x]` Add browser preview coverage that proves visible note-lane curve metadata changes Aether macro automation output.
   - `[x]` Add first visible Segment Editor Aether segment lanes for wavemap, filter, amp, and macro targets.
   - `[x]` Add segment-lane start/mid/end value editing, curve selection, segment-local beat clipping, and document roundtrip coverage.
   - `[x]` Add first visible Track Details Aether track lanes for wavemap, filter, amp, and macro targets.
   - `[x]` Add track-lane start/mid/end value editing, curve selection, project-timeline beat clipping, and document roundtrip coverage.
   - `[x]` Cover first track, segment, and piano-roll note automation entrypoints.
   - `[x]` Add true browser fixture smoke for Aether track, segment, and selected-note Macro 1 lane entrypoints.
   - `[x]` Add verified point-level add, move, and delete helpers for note, segment, and track Aether lanes.
   - `[x]` Add first visible multi-point editors for Segment Editor and Track Details Aether lanes.
   - `[x]` Add visible selected-note multi-point editing UI.
   - `[x]` Add backend live/export parity coverage for multi-point note, segment, and track-scoped Aether lane edits.
   - `[x]` Add first visible arrangement-view Aether track automation lane preview.
   - `[x]` Add arrangement-view drag editing for existing Aether track automation points.
   - `[x]` Add arrangement-view automation point add/remove controls.
   - `[x]` Add point quantize/value snapping for note, segment, and track Aether automation lanes.
   - Add broader browser interaction parity coverage for multi-point note, segment, and track lane edits.
4. `[x]` Aether preset storage and migration.
   - `[x]` Add schema-versioned local instrument presets with Save As, delete, Restore Init, and legacy normalization.
   - `[x]` Add schema-versioned local instrument-effect chain presets with save/load/delete and legacy normalization.
   - `[x]` Add document roundtrip coverage for preset-grade Aether patches, macro routes, custom wavemap analysis metadata, and instrument-owned FX.
   - `[x]` Add native repository roundtrip coverage for Aether oscillator/sub/noise config, wavemap frame controls/partials, macro values/routes, Env 2, and instrument-owned FX.
   - `[x]` Add JS synth verifier coverage for mixed-era wavemap metadata migration, including legacy-only `customWavetables`, modern `wavemaps` precedence, schema/default backfill, and alias mirroring.
   - `[x]` Add backend stress coverage for native mixed-era wavemap metadata merging so legacy-only custom maps survive while modern duplicate IDs win.
   - `[x]` Add document roundtrip coverage for legacy-only wavemap metadata preservation and dirty fingerprint sensitivity.
   - `[x]` Add frontend interaction smoke for Aether preset Save As/load/delete/Restore Init flows, including mixed-era wavemap user preset loading.
   - `[x]` Add user-preset favorite metadata with editor toggle, favorites-only filtering, favorite-first sorting, and verifier coverage.
   - `[x]` Add true browser smoke for Aether preset-library favorite sort/filter/select/toggle behavior.
   - `[x]` Add true browser smoke for current Aether preset Save As/load/delete flows.
   - `[x]` Add true browser smoke for current Aether FX preset save/load/delete flows.
   - `[x]` Add true browser smoke for older/mixed-era wavemap preset records exposed through the UI.
   - `[x]` Add true browser smoke for older/mixed-era FX preset records exposed through the UI.

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

- `[~]` Track automation lanes: first Track Details Aether lane surface and arrangement-view Aether lane preview/edit controls exist; fuller browser interaction parity and multi-select/copy-paste remain pending.
  - Done: native IPC maps Track Details `track.automation` payloads into backend project automation lanes.
- `[~]` Lane chooser for Aether track/segment/note targets exists; gain, pan, effect params, master params, sends, and broader macros remain pending.
- `[~]` Automation point add/move/delete, multi-select, copy/paste, quantize, value snapping.
  - Done: Aether note/segment/track helper coverage exists for point add, move, delete, beat clamping, value clamping, sorting, and curve preservation.
  - Done: Piano Roll, Segment Editor, and Track Details expose visible point beat/value editing plus add/remove controls for Aether lanes.
  - Done: Aether note/segment/track point quantize and value snapping helpers are exposed in visible editors and covered by the frontend interaction verifier.
  - Done: dense native Aether live/export stress covers multi-point note, segment, project, and track-scoped Aether automation lanes.
  - Remaining: multi-select, copy/paste, and fuller browser/runtime interaction coverage.
- `[ ]` Curve editing UI using the existing curve types.
- `[~]` Segment-local automation editor for Aether targets.
- `[~]` Note automation lanes in piano roll for pitch, velocity/level, filter, wavetable position, and macro targets.
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
- `[x]` Project/document roundtrip fixtures for macro route state.
- `[~]` Visible macro lanes and macro conflict display.
  - Done: first visible macro-card conflict summaries for overlapping modulation targets.
  - Remaining: visible macro automation lanes, browser live-preview parity, and deeper precedence/conflict feedback.
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

- `[~]` Happy playback feedback pass.
  - `[ ]` Segment playback, active beat nodes, and active MIDI notes should use the approved cyan playback accent instead of white-only emphasis.
  - `[ ]` MIDI note drag audition should preview the note currently under the pointer while a single note is dragged.
  - `[~]` Low-opacity tints should use approved mesh-gradient variants instead of one flat white tint; keep playback as the only chromatic product feedback state.
- `[~]` Audit every modal footer/action row against shared footer primitives.
- `[~]` Replace one-off selects/dropdowns with shared primitives.
- `[~]` Extract shared asset browser list/table primitives.
- `[~]` Add empty/loading/error states for every panel.
- `[~]` Add consistent keyboard shortcuts and shortcut hints for transport, edit commands, tools, zoom, selection, and modals.
- `[~]` Preferences page for DAW behavior: snap, recording, export defaults, monitoring, autosave, backups.
- `[ ]` Browser smoke for visible hover, selected, disabled, and loading states on critical screens.

## Frontend Framework Migration

- `[x]` React-to-Solid migration for app entry/root shell, sidebar, top bar, home hub, transport surfaces, track shell, track headers, timeline, playhead, lanes, segments, piano roll, drum sequencer, project health, preferences, plugin/DS surfaces, editor host, node instrument editor, synth editor, segment editor, component editor, EQ, visualizer, debug panels, and shared modal/dialog hosts.
- `[x]` Remove React source, React demos, React bridge folders, `@vitejs/plugin-react`, `react`, `react-dom`, and React-era `zundo` coupling.
- `[x]` Solid UI kit foundation exists under `frontend/src/solid-ui` with demos and design-system verifier coverage.
- `[~]` Continue consolidating feature-local controls into Solid UI kit primitives as surfaces are touched.
- `[ ]` Add broader browser-level smoke for migrated critical flows so the completed framework migration has runtime interaction proof, not only source/design-system proof.

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

- `[~]` Browser-level flow coverage for synth editing, wavemap import/draw, macro assignment, automation lanes, arrangement editing, export, relink, backup restore, and project health repairs.
  - Done: true browser fixture smoke covers Aether track, segment, and selected-note Macro 1 automation lane entrypoints with seeded project data and rendered controls.
- `[ ]` Null-test style live/offline comparisons where deterministic output is expected.
- `[ ]` Crossfade parity stress.
- `[ ]` Automation-heavy parity stress beyond the current dense Aether parity path.
- `[ ]` Group/send stem export stress.
- `[ ]` Recording commit rollback stress.
- `[ ]` Asset package/relink stress.
- `[ ]` Document roundtrip fixtures for mixer groups/returns/sends, automation lanes, freeze/bounce metadata, export presets, and remaining Aether preset migrations not covered by the current document verifier.

## Release Gate

- `[ ]` No known data-loss path.
- `[ ]` No known export-clobber path.
- `[ ]` No silent missing-media path.
- `[ ]` No untested document migration for new persisted fields.
- `[ ]` No backend feature without a stress or verifier path.
- `[ ]` No critical UI workflow without at least one browser or pure interaction smoke.
