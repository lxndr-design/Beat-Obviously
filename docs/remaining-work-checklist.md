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

Last audited: 2026-07-01.

Use this section as the short working list. The detailed domain lists below remain the full source of truth.

Current implementation focus:

- `[~]` Aether closeout: move from technically complete synth to musically trustworthy instrument.
  - Improve preset quality with named instrument families, stronger defaults, and explicit genre/use-case coverage.
  - Add auditioning passes for every factory Aether preset and generated default, including rendered preview checks plus subjective listening notes.
  - Keep all future Beat-created synth instruments on the Aether/wavetable path; sampler and DecentSampler instruments remain source-backed exceptions.
  - Reduce editor rough edges: consolidate remaining one-off controls, tighten preset navigation, improve fast-edit affordances, and keep all new controls on the Solid UI kit.
  - Add verifier/browser coverage for preset load/audition/regenerate flows whenever preset or editor behavior changes.
- `[~]` Nodemap closeout: polish the now-testable modular synth engine surface.
  - Keep exactly one protected `Instrument Out` node; empty graphs are valid and intentionally silent.
  - Treat every visual node as an engine contract: source, control, routing, effect, metadata-only, or explicitly deferred.
  - Product decision: Nodemap is a separate modular synth engine. Native schema/evaluation, one-note audition, save/load, linked instance references, large graph timing, and DAW live/export parity now have backend stress coverage.
  - Remaining Nodemap closeout is mostly realtime allocation/polish hardening, user-facing node descriptions, and editor ergonomics.
  - Track details in `docs/nodemap-engine-checklist.md`.
- `[~]` Beat DAW closeout: finish the release-grade workflows around the strong backend.
  - Mixer/channel strips: fader, pan, stereo meter, mute, solo, arm, sends, inserts, input/output, and group routing.
  - Routing UI: returns, group/folder routing, parent assignment, and complete freeze/bounce policy.
  - Asset/package management: relink, replace, reveal, delete, copy into project, remove unused, reference counts, missing media repair, and one-click project packaging.
  - Export review/presets: full mix, review range, selected stem, all stems, sample-rate/bit-depth presets, progress/cancel, analysis panel, and destination history.
  - Sampler keymap editing: velocity layers, key ranges, root-note helpers, sample trim, loop/crossfade loops, round-robin, choke, and exclusive groups.
  - Project Health repair flows: deterministic repair UI for safe fixes, backup restore polish, validate-before-export, and explicit recovery messaging.
  - Broad browser/runtime proof: arrangement editing, recording, mixer, asset relink/package, export, Project Health repairs, and migration-era UI states.

- `[x]` Finish Aether automation point quantize/value snapping across note, segment, and track lanes.
  - Done: shared helpers, Piano Roll controls, Segment Editor controls, Track Details controls, and frontend interaction verifier coverage.
  - Remaining in automation: multi-select/copy-paste, broader browser interaction parity, conflict rules, and invalid automation warnings.

1. `[~]` Browser/runtime proof for critical flows.
   - Done: Aether automation browser fixture coverage for note, segment, and track lane entrypoints.
   - Done: Synth Editor macro browser fixture coverage for visible assignment lanes and overlapping-route conflict rows.
   - Done: Aether automation point-editor browser fixture coverage for Add Point, field editing, Quantize, and Snap Values across note, segment, and track Macro 1 lanes.
   - Done: Aether wavemap editor browser fixture coverage for Details analysis, Additive mode, Odd partials, Manual range, and Smooth interpolation.
   - Done: Aether wavemap Freehand pointer-draw browser fixture coverage, including changed frame data and changed rendered waveform path.
   - Done: Aether wavemap Import Audio browser fixture coverage, including deterministic browser audio, imported source provenance, manual range preservation, and generated frame analysis.
   - Done: Aether selected-note Macro 1 and Filter Cutoff automation handle-drag true browser fixture coverage for start/mid/end values through real pointer events.
   - Done: Aether Segment Editor Macro 1 and Filter Cutoff automation handle-drag true browser fixture coverage for start/mid/end values through real pointer events.
   - Done: Aether Track Details Macro 1 and Filter Cutoff automation handle-drag true browser fixture coverage for start/mid/end values through real pointer events.
   - Done: Aether Synth Editor Env 1 direct ADSR handle-drag and rail curve-cycle browser fixture coverage for attack, decay/sustain, release, and curve shapes through real pointer/click events.
   - Done: Synth Editor macro assignment fixture coverage for Modulation Matrix Add route, source selection, target menu selection, strength edit, and enable/disable controls.
   - Done: arrangement-view Aether automation drag fixture coverage for free point dragging and shift-snap point dragging.
   - Add browser-level flow coverage for broader synth editing, wavemap import/draw, arrangement editing, export, relink, backup restore, and Project Health repairs.
   - Add visible hover, selected, disabled, loading, and migrated-framework smoke coverage on critical screens.
2. `[~]` Automation editing completion.
   - Done: first visible arrangement-view Aether track automation lane preview renders track-scoped automation without taking over timeline drag/drop.
   - Done: arrangement-view Aether track automation points can be dragged with free movement by default and shift-snap to the timeline subdivision.
   - Done: arrangement-view Aether track automation lane controls can add midpoint points and remove the active or last point.
   - Done: point-level add, move, delete helper coverage exists for Aether note, segment, and track lanes.
   - Done: visible note, segment, and track Aether point editors expose point beat/value editing plus add/remove controls.
   - Done: visible note, segment, and track Aether point editors expose quantize and value snapping controls with pure interaction verifier coverage.
   - Done: arrangement-view Aether automation point drag is covered in a true browser fixture, including free movement and shift snapping.
   - Done: selected-note Aether automation value handles are covered in true browser fixture smoke for Macro 1 and Filter Cutoff start/mid/end drag edits, with changed fixture marker values.
   - Done: Segment Editor Aether automation value handles are covered in true browser fixture smoke for Macro 1 and Filter Cutoff start/mid/end drag edits, with changed fixture marker values.
   - Done: Track Details Aether automation value handles are covered in true browser fixture smoke for Macro 1 and Filter Cutoff start/mid/end drag edits, with changed fixture marker values.
   - Done: native IPC maps frontend `track.automation` lanes into backend project automation with track and instrument IDs, and dense Aether live/export stress covers a track-scoped multi-point Aether lane.
   - Add multi-select, copy/paste, and broader drag/browser interaction parity coverage.
   - Define project vs track vs segment vs note vs live-write conflict rules and surface invalid automation warnings.
3. `[~]` DAW editing and recording closeout.
   - Broaden marquee, drag, resize, split, fade, crossfade, loop marker, and selection edge-case tests.
   - Finish visible fade/crossfade UI polish and destructive-operation undo/redo policy.
   - Finish take naming, commit/cancel UX, take-list management, and recording health warnings.
4. `[~]` Mixer, routing, freeze, and export UX.
   - Done: track headers now render stereo meter lanes from live left/right meter fields with aggregate fallback.
   - Done: global Mixer modal now exposes track channel strips with stereo meters, fader, pan, mute, solo, arm, input monitoring, output/group assignment, send/insert counts, insert creation, and master input/output gain.
   - Done: Mixer now creates return buses, edits return level/pan/mute, adds return inserts, and edits per-track send enable/level/pan with store-level verifier coverage.
   - Done: Mixer insert rows can bypass, remove, and move track/return inserts with store-level verifier coverage.
   - Done: Project Health/native integrity verification now catches malformed sends, missing return-bus targets, duplicate sends, and out-of-range send gain/pan, with backend stress coverage.
   - Done: Mixer now reports per-strip summed insert latency and per-insert latency badges from persisted effect latency metadata.
   - Done: Mixer exposes a Freeze action for non-group tracks, backed by native `project.bounceTrackWav`; the source track is muted, the returned audio asset and bounced track are appended and selected, and reversible `freezeSource` metadata is recorded.
   - Done: Frozen bounce tracks expose Unfreeze, restoring source mute/solo state, removing the generated bounce asset/track, and selecting the original source.
   - Done: Project Health/native integrity verification catches malformed/stale frozen-bounce metadata, with backend stress coverage; document roundtrip preserves `freezeSource`.
   - Done: Mixer output routing disables group-parent choices that would create a group routing cycle.
   - Done: export presets have a visible Export Review modal, mode-safe options, recent destination tracking, and shared full/range/stem export runner wiring.
   - Done: export runner now validates Project Health before export by default, blocks integrity errors or missing media, allows warning-only exports, and surfaces the preflight state in Export Review.
   - Done: Export Review recent destinations can be revealed in Finder through existing native IPC, removed individually, or cleared as a history list.
   - Done: Export Review persists recent destination history and the validate-before-export preference, and derives a visible default export folder from the most recent destination.
   - Done: Export Review exposes an All Stems preset with renderable-track readiness and a native batch-stem IPC.
   - Done: Export Review supports local custom export presets with Save As, editable render settings, tail policy, and delete.
   - Done: Export Review shows post-export analysis metrics for duration, format, peak, true peak, RMS, LUFS, clipping, DC offset, and correlation when render analysis exists.
   - Finish group-track freeze policy, explicit bounce destination/policy controls, and browser interaction smoke.
   - Add batch stem naming polish, export analysis browser smoke, and remaining parity/null-test coverage.
5. `[~]` Asset and sampler management.
   - Done: Shared asset reference graph now builds de-duped audio/sample/plugin manifests with reference counts and policy/state classification.
   - Done: Project asset reference counts now distinguish library registration from track/segment/instrument sample-id audio usage, enabling safer cleanup decisions.
   - Done: Audio Files separates non-destructive unused library-entry removal from native-only disk deletion and blocks both paths for track/segment/instrument-referenced audio IDs.
   - Done: persisted project manifests, relink rebuilds, native manifest repair, and sidecar packaging stress now preserve track/segment/instrument sample-id-aware audio references.
   - Deferred: visible project asset browser was removed until it can be redesigned with the shared UI kit and folded cleanly into Audio Files / Project Health flows.
   - Finish global replace, copy-into-project polish, visible project asset-management design, and native chooser-level missing-asset relink harness coverage.
   - Add sampler/keymap editors for velocity layers, sample trim, loop markers, crossfade loops, root-note helpers, round-robin, choke, and exclusive groups.
   - Run a real AU/VST3 plugin-host feasibility pass after the protected adapter layer is stable.
6. `[~]` Aether synth maturity.
   - Finish macro live-preview parity, visible macro lanes, deeper macro conflict/precedence display, and modulation matrix semantic cleanup.
   - Improve expression-source feedback and remaining one-off synth controls; envelope visual editing is complete for the current schema.
   - Curate named Aether instrument/effect preset library UX beyond local Save As lists.
7. `[~]` Nodemap engine maturity.
   - Done: graph contract, editor protections, proof templates, document roundtrip/repair fixtures, JS compile/preview verification, native graph schema/evaluator, native one-note audition, DAW playback/export path, persisted `nodeGraph`, linked instrument references, large graph timing, silent/cyclic graph handling, and live/export WAV parity are covered by `BeatBackendStress`.
   - Done: in-app browser replay now covers node creation, cable routing, warning transitions, parameter editing, undo/redo, play/audition, and apply through `?beatDevFixture=node-interaction`.
   - Continue realtime allocation/polish hardening, user-facing node descriptions, editor ergonomics, and broader save/open browser smoke.
8. `[~]` Generation and musical intelligence.
   - Measure Aether-aware instrument generation against the current Aether schema.
   - Add structured beat/pattern generation with phrase sections, fills, rests, density maps, accents, ghost notes, and editable provenance.
   - Add genre/invariant tests and training/export loops that preserve accepted user edits.
9. `[~]` UI coherence and framework cleanup.
   - Continue replacing one-off selects, dropdowns, modal footers, action rows, asset lists/tables, and feature-local controls with Solid UI kit primitives.
   - Complete happy playback feedback: monochrome active playback for segments/nodes/notes, MIDI drag audition, and approved grayscale mesh-tint variants.
   - Keep React removed; continue consolidating remaining local controls into `frontend/src/solid-ui`.
10. `[~]` Codebase organization.
   - Continue backend extraction around wavetable, realtime, sampler, effects, analysis, sequencing, and parameters.
   - Split `AudioEngine`, `InstrumentVoice`, giant frontend stores, and feature-boundary modules as related work lands.
   - Keep IPC additive/versioned and add focused tests beside each subsystem split.
11. `[ ]` Release gate.
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
   - `[x]` Add opt-in runtime nonlinear Aether stack warp with shape/fold/pinch/mirror curves, browser preview proof, native repository roundtrip, and native rendered-output stress.
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

- `[~]` Mixer panel or expandable mixer view.
  - Done: global Mixer modal opens from the rail and renders one strip per track plus a master strip.
  - Remaining: dockable/expandable arrangement integration and browser fixture coverage.
- `[~]` Track channel strips: meter, fader, pan, mute, solo, arm, input, output/group, sends, inserts.
  - Done: strip controls edit persisted track gain, pan, mute, solo, record arm, input monitoring, parent group output, send enable/level/pan, insert creation, insert bypass/remove/reorder, and route/insert latency display.
  - Done: output/group selector disables parent choices that would create group-routing cycles.
  - Remaining: broader browser interaction smoke.
- `[~]` Return bus UI for creating buses, routing sends, mute/solo, effects, and level.
  - Done: mixer can create/remove return buses, edit return level/pan/mute, add return inserts, route sends from tracks, and bypass/remove/reorder return inserts.
  - Done: Project Health/native integrity verification reports malformed send arrays, empty/missing return bus targets, duplicate sends, and out-of-range send gain/pan; backend stress covers the invalid route cases.
  - Remaining: return solo is not in the native model, browser smoke remains open, and detailed return-effect parameter editing still happens through future expanded insert controls.
- `[~]` Group/folder track UI for create, assign parent, collapse/expand, group effects/sends.
- `[~]` Freeze/bounce UI with freeze selected track, bounce in place, export stem, reversible unfreeze metadata, and clear parent-routing policy.
  - Done: Mixer exposes Freeze for non-group tracks, using the native bounce IPC, appending the returned bounced audio track, muting the source, and recording reversible `freezeSource` metadata.
  - Done: Mixer exposes Unfreeze for frozen bounce tracks, restoring source mute/solo state, removing the generated bounce asset/track, and selecting the original source.
  - Done: document roundtrip preserves `freezeSource`; Project Health/native stress validates malformed, stale, and missing frozen-bounce references.
  - Remaining: explicit bounce destination/policy controls, browser smoke, and group-track freeze/bounce policy.
- `[~]` Latency reporting per track/effect route.
  - Done: Mixer displays summed route insert latency and individual insert latency badges from persisted effect metadata.
  - Remaining: live measured route-delay display and browser smoke.
- `[~]` Master section polish: input gain, compressor, EQ, output gain, limiter, loudness/peak readouts.
- `[~]` Group/return/freeze Project Health validation and stem/freeze parity for group/send scenarios.
  - Done: return/send route integrity catches invalid/missing/duplicate return sends.
  - Done: freeze metadata health catches invalid/missing frozen-bounce source/audio/segment links.
  - Remaining: group/folder routing health and stem/freeze parity for group/send scenarios.

## Asset Management And Project Portability

- `[~]` Global audio-file actions: relink, replace, reveal, delete, copy into project, remove unused.
  - Done: Audio Files splits Remove Entry from destructive Delete Files, keeps disk deletion native-only, and blocks referenced track/segment/instrument sample-id audio IDs.
  - Remaining: global replace wording/polish, copy-into-project polish, and native chooser-level missing-asset relink harness coverage.
- `[~]` Instrument actions: duplicate, version, reveal source, repair missing samples, inspect sample zones.
- `[ ]` Velocity/key/round-robin/choke editor for sampler instruments.
- `[~]` Project asset browser with external/bundled/missing/unused/managed indicators.
  - Done: shared project dependency row model with track/segment/instrument sample-id-aware reference counts, external/bundled/plugin/missing state, and affected references.
  - Deferred: visible browser removed until it can be redesigned with proper UI-kit structure and placed without duplicating Audio Files / Project Health.
  - Remaining: visible asset browser design, richer sampler/plugin affected-reference previews.
- `[~]` One-click package project assets for portability.
  - Done: native backend stress covers manifest repair plus sidecar packaging for audio files, sample URLs, sample maps, plugin package references, bundled samples, and track/segment/instrument sample-id audio references; document roundtrip covers relinked track/segment/instrument-aware audio references.
  - Remaining: visible copy/package action, native chooser-level missing/relinked asset harness fixtures.
- `[~]` Remove unused copied sidecar assets.
  - Done: native `project.cleanupAssets` exists and returns a retained cleanup report.
  - Remaining: visible cleanup entrypoint, browser smoke for cleanup failure/success states, and richer unused-library indicators outside sidecar files.
- `[~]` Copy-on-save policy surfaced in document UI.
- `[~]` Safer delete flows with reference counts and affected tracks/segments.
  - Done: audio asset rows include audio library, track, segment, and instrument sample-id references; unused audio entries can be removed from the library without deleting disk files; destructive audio-file deletion is a separate native-only action and refuses referenced track/segment/instrument audio.
  - Done: backend stress covers destructive audio deletion policy: managed library files can be physically deleted, external files are preserved, remove-entry mode leaves disk files intact, and missing IDs are reported.
  - Remaining: broader affected-reference previews for sampler/plugin assets.
- `[~]` Shared asset reference graph helper used by Project Health and UI.
  - Done: shared frontend reference graph used by document manifests and future asset-management UI, including audio library, track, segment, and instrument sample-id usage references; native manifest repair mirrors those references for saved/repaired documents.
  - Remaining: align Project Health category rendering directly onto the shared row model after native scan output is refreshed.

## Export, Review, And Delivery

- `[ ]` Export preset UI for full mix, review range, selected track stem, all stems, and bounce selection.
- `[ ]` Format presets for 44.1/48/96 kHz, 16/24/32-bit, mono/stereo, tail include/exclude.
- `[~]` Export destination defaults and recent export folder.
  - Done: Export Review persists recent destinations, displays the default folder from the most recent destination, and keeps reveal/remove/clear history controls.
  - Remaining: explicit destination chooser/default-folder override before export.
- `[ ]` Post-export review panel for duration, sample rate, bit depth, peak, true peak, RMS, LUFS, clipping, DC offset, and correlation.
- `[ ]` Unified export job panel for cancel, failed, and success states.
- `[ ]` Batch stem export naming policy.
- `[ ]` All-track stems export helper if repeated single-track export is not enough.
- `[~]` Export preset serialization in preferences.
  - Done: custom export presets, recent destinations, and validate-before-export preference persist locally.
  - Remaining: move these into the broader Preferences UI once the export-defaults panel lands.
- `[~]` Null-test or bounded-difference checks where deterministic parity is expected.
  - Done: Aether deterministic null-export stress covers dense, max-unison, mono-legato/glide, and group/return routed families with repeated live-render and 32-bit export-prefix residual thresholds.
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

- `[~]` Heavier nonlinear warp experiments.
  - Done: bounded table-generation `mirror` warp mode across editor/browser/native/persistence/test surfaces; opt-in runtime warp mode/amount across editor, browser preview, native render, persistence, browser fixture coverage, and deterministic native null-export stress.
  - Remaining: runtime warp oversampling/performance strategy for heavier nonlinear settings.
- `[x]` Browser preview parity for live macro route changes.
  - Done: synth verifier covers dynamic macro-route offsets, confirms macro routes stay live instead of baking into base preview values, and renders distinct audio for full-amount, edited-amount, and disabled macro routes.
- `[x]` Project/document roundtrip fixtures for macro route state.
- `[~]` Visible macro lanes and macro conflict display.
  - Done: first visible macro-card conflict summaries for overlapping modulation targets.
  - Remaining: visible macro automation lanes and deeper precedence/conflict feedback.
- `[~]` Modulation matrix semantic cleanup: per-target ranges, conflict clarity, disabled routes, source-specific editing.
- `[x]` Deeper envelope visual editing with ADSR drag handles, direct rail curve controls, loop state, and assignment feedback.
- `[x]` Performance/expression UX for mod wheel, pitch bend, velocity, keytracking, mono/legato, glide, and voice caps.
  - Done: browser timeline, browser Web MIDI, and native JUCE MIDI input all publish into the same synth expression activity contract for Aether/compatible synth instruments.
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
  - `[ ]` Segment playback, active beat nodes, and active MIDI notes should use approved monochrome emphasis without introducing hue.
  - `[ ]` MIDI note drag audition should preview the note currently under the pointer while a single note is dragged.
  - `[~]` Low-opacity tints should use approved grayscale mesh-gradient variants instead of one flat white tint; playback must also stay monochrome.
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

- `[~]` Browser-level flow coverage for broader synth editing, wavemap import/draw, automation lanes, arrangement editing, export, relink, backup restore, and project health repairs.
  - Done: true browser fixture smoke covers Aether track, segment, and selected-note Macro 1 automation lane entrypoints with seeded project data and rendered controls; 22-flow Aether fixture sweep covers current synth editing, preset restore/save-delete, macro assignment, wavemap editor, wavemap pointer draw/import, envelope handles, amp/filter, LFO, performance, note/segment/track automation entrypoints, point editors, direct point editing, arrangement dragging, and note/segment/track handle dragging.
- `[~]` Null-test style live/offline comparisons where deterministic output is expected.
  - Done: Aether deterministic null-export stress covers dense, max-unison, runtime-warp, mono-legato/glide, group/return routed, and FX-heavy instrument/track-effect families with repeated live-render and 32-bit export-prefix residual thresholds.
- `[ ]` Crossfade parity stress.
- `[ ]` Automation-heavy parity stress beyond the current dense Aether parity path.
- `[ ]` Group/send stem export stress.
- `[ ]` Recording commit rollback stress.
- `[~]` Asset package/relink stress.
  - Done: backend stress covers audio/sample sidecar packaging, plugin package manifest references, track/segment/instrument sample-id-aware audio references, and destructive audio delete policy; document roundtrip covers relink manifest rebuilds, and the frontend interaction verifier covers sequential missing-asset relink source wiring.
  - Remaining: native chooser-level missing-asset relink harness.
- `[~]` Document roundtrip fixtures for mixer groups/returns/sends, automation lanes, freeze/bounce metadata, export presets, and remaining Aether preset migrations not covered by the current document verifier.
  - Done: freeze/bounce `freezeSource` metadata roundtrip fixture.
  - Remaining: richer mixer group/return/send and export-preset fixtures.

## Release Gate

- `[ ]` No known data-loss path.
- `[ ]` No known export-clobber path.
- `[ ]` No silent missing-media path.
- `[ ]` No untested document migration for new persisted fields.
- `[ ]` No backend feature without a stress or verifier path.
- `[ ]` No critical UI workflow without at least one browser or pure interaction smoke.
