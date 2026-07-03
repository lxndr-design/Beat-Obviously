# Beat DAW Comprehensiveness Roadmap

## Objective

Move Beat from a strong prototype/early serious DAW to a comprehensive DAW in one focused buildout pass.

This is not a “more features” list. The goal is to make the existing system feel complete enough that a user can start a project, record/import material, arrange it, edit it, automate it, mix it, export it, recover from mistakes, and trust the file on disk.

Target framing:

- Current state: about `60-70%` DAW-complete depending on whether the benchmark is backend capability or product UX.
- Target state: `100%` for Beat’s intended v1 DAW scope, not “all features every commercial DAW has.”
- Non-goal: true third-party AU/VST hosting in this pass. Plugin intent and adapter metadata should remain safe placeholders until a dedicated crash-isolated host exists.

## Current Closeout Buckets

These are the remaining product-level workflows that keep Beat from feeling like a release-grade DAW, even though much of the backend is already present.

1. **Mixer and channel strips**
   - Track strips need fader, pan, stereo meter, mute, solo, arm, sends, inserts, input, output, group routing, and latency display in one coherent surface.
   - Current foundation: track headers consume the stereo meter fields (`leftPeak`/`rightPeak`) with aggregate mono fallback, and the global Mixer modal now exposes track channel strips with meters, fader, pan, mute, solo, arm, input monitoring, cycle-safe group output assignment, send enable/level/pan, insert creation, insert bypass/remove/reorder, per-strip and per-insert latency display, freeze/unfreeze for non-group tracks with reversible `freezeSource` metadata, return-bus creation/editing, return insert bypass/remove/reorder, send/insert counts, and master input/output gain. Project Health/native integrity verification now catches malformed sends, missing return-bus targets, duplicate sends, out-of-range send gain/pan, and stale frozen-bounce metadata.
2. **Routing UI**
   - Return buses, group/folder routing, parent assignment, send levels, freeze/bounce, reversible unfreeze metadata, and route-health warnings need visible workflows.
3. **Asset and package management**
   - Audio/instrument/project assets need relink, replace, reveal, delete, copy into project, remove unused, reference counts, missing media repair, and one-click project packaging.
4. **Export review and presets**
   - Export needs user-facing presets for full mix, review range, selected stem, all stems, sample rate, bit depth, channel count, tail policy, destination history, progress/cancel, and post-export analysis.
   - Current foundation: factory export presets, user custom export preset serialization/edit/delete, bounded option normalization, mode-safe preset resolution, persisted recent destination tracking, visible default export folder derivation, persisted validate-before-export preference, post-export metric review, and a visible Export Review modal are wired into existing full-mix, review-range, selected-stem, and native all-stems batch export calls.
   - Remaining: batch stem naming polish and export analysis browser smoke/parity review.
5. **Sampler keymap editing**
   - Sampler instruments need key/velocity zones, root-note helpers, sample trim, loop/crossfade loops, round-robin, choke, exclusive groups, and missing-zone repair UI.
6. **Nodemap modular synth**
   - Nodemap is its own modular synth engine surface, not an Aether UI skin. Native graph schema/evaluation, one-note audition, DAW playback/export, and persistence now exist independently from the temporary frontend Aether compile bridge.
   - Current foundation: protected `Instrument Out`, multi-cable ports, grouped node browser, six proof templates, warnings, persistence, migration/repair, JS compile/preview verification, broad graph semantics, native render timing, linked instance references, live/export WAV parity, and in-app browser replay for create/connect/edit/undo/redo/audition/apply.
   - Remaining: broader save/open browser smoke, realtime allocation/polish hardening, and user-facing node descriptions.
7. **Project Health repair flows**
   - Health reports need deterministic repair actions, validate-before-export, backup restore polish, stale metadata fixes, copied-sidecar cleanup, and clear recovery messaging.
8. **Broad browser/runtime proof**
   - Critical editing surfaces need browser/runtime proof for arrangement editing, recording, mixer/routing, asset relink/package, export, Project Health repairs, and migration-era UI states.

## Definition Of 100%

Beat reaches v1 DAW comprehensiveness when these workflows are complete end to end:

1. **Create/open/save a project** with durable `.beat` documents, asset packaging, recent projects, backups, and recoverable health reports.
2. **Build an arrangement** with MIDI, drum, audio, sampler, synth, grouped tracks, review loops, selection, editing, snapping, trimming, fades, and reversible destructive operations.
3. **Record audio** with armed tracks, input device/channel selection, monitoring, count-in, latency calibration, take commit/rollback, and take management.
4. **Edit MIDI and drums** with reliable piano roll and drum grid workflows, velocity/pitch/automation editing, reusable components/patterns, and browser-level interaction confidence.
5. **Manage assets** from Home and in-project libraries: audio files, instruments, patterns/components, DecentSampler imports, missing-file relink, deletion, and reference warnings.
6. **Build Nodemap instruments** as standalone modular synth patches with protected output, meaningful nodes, one-note audition, linked instance edits, native render/export support, and tested save/open behavior.
7. **Automate sound over time** with visible lanes for track, effect, segment, note, project, and instrument targets, clear conflict rules, curve editing, and parity between live playback/export.
8. **Mix and route** with track effects, sends/returns, group routing UI, master chain, meters, bus semantics, freeze/bounce, stems, and predictable latency handling.
9. **Export with confidence** using full mix, range/review-loop, selected track/stem, format presets, progress/cancel, analysis, and previous-file preservation.
10. **Inspect and repair project health** without hidden state: assets, backups, sidecars, stale IDs, missing files, and deterministic repairs.
11. **Verify the product** through backend stress, pure interaction tests, document roundtrips, design-system checks, and browser smoke for the workflows that can break silently.

## Execution Model

Work in vertical slices. Each slice must ship backend model/API, frontend UX, persistence, tests, and documentation together when applicable.

Rules:

- Do not add UI that is not backed by serializable project state.
- Do not add backend capability without at least one frontend path or explicit verifier.
- Do not add export/playback behavior without live/export parity coverage or a documented reason parity cannot be deterministic.
- Keep plugin hosting out of scope unless it is a safe adapter/import flow.
- Keep the UI kit rules from `frontend/src/design/README.md` enforced while adding surfaces.

## Phase 0: Baseline Lock

Purpose: make sure we do not regress the recovered project while adding a large pass.

Deliverables:

- Add this roadmap.
- Keep `npm run verify:non-native` and `build-native/bin/BeatBackendStress` green.
- Add a single command/script later if useful, but do not block the roadmap on test orchestration.
- Confirm current DAW percentage in `docs/serum-style-synth-roadmap.md` after each major slice.

Exit criteria:

- Clean repository.
- Existing stress/build paths pass.
- Roadmap is explicit enough to split work safely.

## Phase 1: Arrangement Editing Completion

Purpose: make timeline editing feel like a DAW instead of a demo surface.

Current assets:

- Timeline, tracks, segments, marquee, audited click/context-menu selection behavior, drag/resize, visible fade handles, audio sample/time snap policy, split/trim/fade metadata, paste/duplicate, rename/color/icon metadata, segment group/ungroup metadata, multi-select menu actions and command bar, crossfade commands, review loop, transport actions, grouped history, grid-snap preferences, destructive undo guardrails with hotkey confirmation, populated-track and in-project asset delete confirmations, invalid trim/fade warning stress, and pure geometry/interaction/backend parity verifiers exist.
- `npm run verify:daw` covers edit-command behavior for move, resize, duplicate, paste, delete, rename/color/icon metadata, group/ungroup, nudge, quantize, split, trim, fade, crossfade, grouped undo/redo, destructive undo confirmation policy, and timeline geometry.
- `npm run verify:track-interactions` covers free segment drag/resize/fade by default with Shift-based snapping.

Build:

- Browser-level smoke for marquee, drag, resize, split, fade, crossfade, and loop marker interaction.

Backend/model:

- No open backend/model items for Phase 1.

Audio snap policy:

- Audio-bearing segments use the same arrangement edit policy as MIDI/drum segments: body drag, resize, and fade handles are free by default and snap only while Shift is held.
- Free edits preserve exact beat offsets for sample-aligned placement and fade shape. Shift-snap uses the current timeline subdivision for body drag and the current measure/grid step for resize and fades.
- Left trim/resize updates `sourceStartBeat` from the original edit snapshot so repeated preview commits do not compound the sample offset.
- `npm run verify:track-interactions` covers the free/Shift snap math. `npm run verify:daw` covers audio trim/fade metadata and source-offset stability.

Acceptance:

- A user can arrange a song with imported audio, MIDI, and drums without opening specialized modals for every common edit.
- Undo/redo can recover from destructive arrangement operations.
- Segment edit behavior is deterministic across mouse, keyboard, and context menu paths.

## Phase 2: Recording And Take Workflow

Purpose: complete the native recording story.

Current assets:

- Backend capture buffer, WAV finalization, count-in/session planner, latency compensation/calibration, input monitoring, record-arm metadata, device enumeration/selection IPC, and backend stress coverage exist.

Build:

- Record-arm UI in track headers/details.
- Input device/channel picker with permission/error states.
- Input monitoring controls per armed track.
- Count-in controls in transport or recording preferences.
- Recording latency calibration UI with measured/manual/reporting fields.
- Take naming and destination policy.
- Commit/cancel UX after recording.
- Take list for a track: keep, rename, reveal file, remove from project, remove file if managed.
- Punch-in/punch-out planning if it fits the pass; otherwise explicitly defer.

Backend/model:

- Persist selected input profile and track input mapping.
- Verify take commit rollback when file write or model validation fails.
- Add project-health warnings for missing recording files and invalid input metadata.

Acceptance:

- A user can arm a track, hear monitoring, record a take with count-in, save the project, reopen it, and export with the take in place.
- Failed record commit cannot corrupt the project or leave an orphaned committed segment.

## Phase 3: MIDI, Drum, And Component Editing

Purpose: make musical editing deep enough for real projects.

Current assets:

- Piano roll, drum sequencer, component library, pattern/Home pages, MIDI note automation/pitch curves, and component playback exist.

Build:

- Piano roll polish: box select, note edge resize, velocity lane, pitch curve lane, duplicate/nudge/quantize commands, keyboard shortcuts.
- Drum grid polish: velocity/accent/lean/probability editing, row mute/solo, row reorder, sample assignment, fill/variation helpers.
- Component workflow: save selected MIDI/drum/audio regions, preview, drag into arrangement, edit component source, duplicate/version component.
- Pattern page becomes a real pattern browser/editor handoff, not just passive preview.
- Shared editor footer/action behavior via `ActionFooter`.

Backend/model:

- Persist component provenance and dependencies.
- Verify component insertion produces ordinary project segments.
- Add generator fixtures for component/pattern invariants if AI generation touches these paths.

Acceptance:

- A user can create and reuse musical ideas without copy/paste becoming the only workflow.
- MIDI/drum edits remain ordinary DAW data and survive document roundtrip.

## Phase 4: Automation As A First-Class DAW Surface

Purpose: expose the native automation system.

Current assets:

- Native note, segment, project, track route, and effect automation exist. Curves and control checkpoints are stress-covered. Effect rows and curve utilities exist.

Build:

- Track automation lanes in arrangement view.
- Lane chooser for track gain, pan, effect params, instrument params, master params, sends, and macros.
- Automation point add/move/delete, multi-select, copy/paste, quantize, and value snapping.
- Curve editing UI using existing curve types.
- Segment-local automation editor.
- Note automation lanes in piano roll for pitch, velocity/level, filter, wavetable position, macro targets.
- Automation visibility policy: show active lanes, hide empty lanes, pin favorites.
- Automation conflict rules:
  - Note overrides segment for the note lifetime.
  - Segment overrides project for its segment span.
  - Track/effect route automation applies after instrument output.
  - Live knob edits write or preview depending on automation mode.
- Later/deferred: write/read/touch/latch automation recording.

Backend/model:

- Document automation precedence and enforce consistent merge order.
- Add dense automation parity stress for block sizes, loop boundaries, range export, and overlapping segments.
- Add invalid automation repair/warning paths in Project Health.

Acceptance:

- Users can see, edit, and reason about every automated value.
- Live playback, review-loop playback, and export agree on automated changes.

## Phase 5: Mixer, Routing, Groups, And Freeze

Purpose: complete the signal-flow mental model.

Current assets:

- Track route buffers, gain/pan, meters, track effects, sends/returns backend, group routing backend, master chain, limiter, export/stem/bounce backend, timing counters, and stress coverage exist.

Build:

- Mixer panel or expandable mixer view.
  - Current foundation: global Mixer modal opens from the rail and renders channel strips for tracks plus the master output strip.
- Track channel strips: meter, fader, pan, mute, solo, arm, input, output/group, sends, inserts.
  - Current foundation: strip controls edit persisted track gain, pan, mute, solo, record arm, input monitoring, cycle-safe parent group output, send enable/level/pan, insert creation, insert bypass/remove/reorder, and route/insert latency display.
- Return bus UI: create bus, route sends, mute/solo, effects, level.
  - Current foundation: mixer creates/removes return buses, edits return level/pan/mute, adds return inserts, bypasses/removes/reorders return inserts, and routes track sends into return buses. Return solo is not in the native model yet.
- Group/folder track UI: create group, assign parent, collapse/expand, group effects/sends.
- Freeze/bounce UI:
  - Freeze selected track.
    - Current foundation: Mixer exposes Freeze for non-group tracks, mutes the source track, appends the rendered audio track, records `freezeSource`, and selects the frozen bounce.
  - Bounce in place.
    - Current foundation: native `project.bounceTrackWav` returns the audio asset and bounced track used by the Mixer freeze flow.
  - Export selected track stem.
  - Reversible unfreeze metadata.
    - Current foundation: Mixer exposes Unfreeze for frozen bounce tracks, restores source mute/solo state, removes the generated bounce asset/track, and selects the source track.
  - Clear parent-routing policy in UI.
- Latency reporting per track/effect route.
- Master section: input gain, compressor, EQ, output gain, limiter, loudness/peak readouts.

Backend/model:

- Persist mixer state and grouping UI metadata.
- Add group/return/freeze project-health validation.
  - Current foundation: return/send route health is native-verified and backend-stress-covered for malformed send arrays, missing return-bus targets, duplicate sends, and invalid send gain/pan. Frozen-bounce metadata health is native-verified, backend-stress-covered, and document-roundtrip-covered for `freezeSource`.
- Add stem/freeze parity checks for group and send scenarios.

Acceptance:

- Users can understand and modify where every track goes.
- Freeze/bounce is reversible or explicitly destructive with confirmation.
- Master output is controlled and export-identical.

## Phase 6: Asset Management And Project Portability

Purpose: make Beat projects portable and libraries manageable.

Current assets:

- Home hub, audio/instrument/pattern pages, audio metadata/waveform analysis, DecentSampler import, project asset manifest, sidecar packaging, missing asset relink, Project Health, recent projects, backups, and sidecar cleanup exist.
- Current foundation: the shared frontend asset reference graph builds de-duped audio/sample/plugin manifests with reference counts for document repair, packaging, and health flows. Persisted document manifests, relink rebuilds, native manifest repair, and sidecar packaging stress now preserve track/segment/instrument sample-id-aware audio references. The unfinished Home Project Assets browser was removed from the visible app until it can be redesigned as a proper asset-management surface.

Build:

- Global audio-file actions: relink, replace, reveal, delete, copy into project, remove unused.
- Instrument actions: duplicate, version, reveal source, repair missing samples, inspect sample zones.
- Explicit velocity/key/round-robin/choke editor for sampler instruments.
- Project asset browser: all assets used by current project, external vs bundled state, missing/unused/managed indicators.
  - Current foundation: shared reference rows can describe current project dependencies with kind, path, track/segment/instrument sample-id-aware reference count, policy/state, and affected references, but the visible browser is deferred.
- One-click package project assets for portability.
  - Current foundation: Save & Package forces the native save/package pass even when the document is already clean, so external assets are copied into the project sidecar folder before integrity verification.
- Copy-on-save policy surfaced in document UI.
- Safer delete flows with reference counts and affected tracks/segments.
  - Current foundation: Clean Sidecar confirms before deleting unused copied sidecar files, stores the native cleanup report, and refreshes the asset scan. Audio Files splits unused library-entry removal from native-only disk deletion and blocks both paths for referenced track/segment/instrument audio IDs. Backend stress covers the native destructive delete policy: managed library files can be physically deleted, external files are preserved, remove-entry mode leaves disk files intact, and missing IDs are reported.

Backend/model:

- Asset reference graph helper shared by Project Health and UI.
  - Current foundation: frontend manifest/reference helper is shared by document save/migration and future asset-management UI, including audio library, track, segment, and instrument sample-id references. Native manifest repair mirrors those references, while native integrity verification still owns filesystem existence checks.
- Deterministic asset package/relink tests for audio files, sample URLs, sample maps, plugin adapters, and component references.
  - Current foundation: backend stress covers audio/sample sidecar packaging, plugin package manifest references, track/segment/instrument sample-id-aware audio references, and destructive audio delete policy; document roundtrip covers relink manifest rebuilds, and frontend interaction verification covers sequential missing-asset relink source wiring. Native chooser-level missing-asset relink harnesses remain.

Acceptance:

- Moving a project to another machine has a predictable story.
- Deleting or relinking assets never silently breaks tracks.

## Phase 7: Export, Review, And Delivery

Purpose: complete delivery workflows.

Current assets:

- Full mix, range, selected track/stem export IPC; async progress/cancel; format bounds; native analysis; previous-file preservation; range/review-loop parity stress.

Build:

- Export preset UI:
  - Full Mix WAV.
  - Review Range WAV.
  - Selected Track Stem.
  - Stems All Tracks.
  - Bounce Selection.
- Format presets: 44.1/48/96 kHz, 16/24/32-bit, mono/stereo, tail include/exclude.
- Export destination defaults and recent export folder.
  - Current foundation: completed exports persist recent destinations, Export Review can reveal/remove/clear recent export paths, and the default export folder is displayed from the most recent destination.
- Post-export review panel: duration, sample rate, bit depth, peak, true peak, RMS, LUFS, clipping, DC offset, correlation.
- Cancel/failed/success states in one consistent export job panel.
- Batch stem export naming policy.

Backend/model:

- Add all-track stems export helper if not built from repeated single-track calls.
- Add export preset serialization in preferences.
  - Current foundation: custom export presets, recent destinations, and validate-before-export preference persist locally.
- Add null-test or bounded-difference checks where deterministic parity is expected.

Acceptance:

- Users can export common deliverables without knowing backend render options.
- Failed/cancelled export cannot destroy a previous successful file.

## Phase 8: Project Health, Recovery, And Trust

Purpose: make failure states visible and repairable.

Current assets:

- Integrity verifier, Project Health modal, backup list/restore, missing asset relink, manifest repair, sidecar cleanup, fatal open rejection, safe repairs, export analysis.

Build:

- Project Health dashboard categories:
  - Fatal structure.
  - Missing media.
  - Orphaned sidecar files.
  - Stale IDs/metadata.
  - Recording/input metadata warnings.
  - Export warnings.
- Guided repair flows for every deterministic repair.
- Backup browser improvements: preview metadata, restore copy vs replace, reveal backup.
- Current document path and backup status visible in top/app menu.
- “Validate project before export” option, default on.
  - Current foundation: shared export runner preflights Project Health with `project.inspectDocument`, blocks export on integrity errors or missing media, allows warning-only exports, stores validation state, and surfaces status in Export Review.
- Crash/restart recovery story from last local autosave vs last saved document.

Backend/model:

- Keep repairs narrow and deterministic.
- Add verifier coverage for every Project Health action.

Acceptance:

- A damaged or moved project gives a precise diagnosis.
- User can repair safe issues without guessing what the app did.

## Phase 9: UI Coherence And Workflow Ergonomics

Purpose: make the product feel designed, not assembled.

Current assets:

- Strict UI kit, shared components, component demos, Home hub, top bar/app menu, modal stack, hover info, asset page shell.

Build:

- Audit every modal footer/action row against `ActionFooter`.
- Replace one-off selects/dropdowns with `FloatingSelect` or a new shared primitive.
- Extract shared asset browser list/table primitives.
- Add empty/loading/error states for every panel.
- Add consistent keyboard shortcuts and shortcut hints:
  - Transport.
  - Edit commands.
  - Tools.
  - Zoom.
  - Selection.
  - Modal commit/cancel.
- Add preferences page for DAW behavior: snap, recording, export defaults, monitoring, autosave/backups.
- Browser smoke for visible hover/selected/disabled/loading states on critical screens.

Acceptance:

- Common workflows are discoverable and fast.
- New UI work has a clear component to reuse or extend.
- Visual drift is caught by the UI kit verifier and catalog.

## Phase 10: Testing And Release Gate

Purpose: make “100%” defensible.

Required verification:

- `npm run verify:non-native` for the full Node/Vite/Solid gate.
- `npm run verify:design-system`
- `npm run verify:version`
- `npm run verify:audio-boundary`
- `npm run typecheck`
- `npm run build`
- `npm run verify:daw`
- `npm run verify:documents`
- `npm run verify:interactions`
- `npm run verify:synth`
- `npm run verify:native-doc`
- `cmake --build build-native`
- `build-native/bin/BeatBackendStress`

Add or expand:

- Browser smoke for:
  - New project to save/open.
  - Import audio and arrange.
  - Record a take using synthetic/offline input path where possible.
  - Edit MIDI and drum segment.
  - Add automation lane.
  - Add track effect and send.
  - Bounce/freeze/export.
  - Relink missing asset.
  - Restore backup.
- Backend stress for:
  - Crossfade parity.
  - Automation-heavy parity.
  - Group/send stem export.
  - Recording commit rollback.
  - Asset package/relink.
- Document roundtrip for:
  - Mixer groups/returns/sends.
  - Automation lanes.
  - Freeze/bounce metadata.
  - Recording input profile.
  - Export presets.

Release gate:

- No known data-loss path.
- No known export-clobber path.
- No silent missing-media path.
- No untested document migration for new persisted fields.
- No backend feature without a stress or verifier path.
- No critical UI workflow without at least one browser or pure interaction smoke.

## Suggested Build Order

The fastest path to perceived DAW completeness is:

1. Arrangement editing completion.
2. Recording and take workflow.
3. Automation lanes.
4. Mixer/group/send/freeze UI.
5. Asset/reference management polish.
6. Export preset/review UI.
7. Project Health/recovery polish.
8. Final UI coherence and browser regression pass.

This order works because each stage makes the next stage usable:

- Editing needs to be trustworthy before recording and automation feel safe.
- Recording creates assets, so asset management follows.
- Automation and mixer need shared route semantics before export presets are meaningful.
- Export and Project Health are the trust layer at the end.

## Explicit Deferrals

These are not part of the 100% v1 DAW pass:

- True AU/VST3 hosting.
- Elastic audio/time-stretch with commercial-grade quality.
- Full score editor.
- Surround/immersive mixing.
- Collaborative cloud sync.
- Mobile/tablet UI.
- Deep AI training productization beyond deterministic, editable generation fixtures.

Deferring these keeps the target honest: Beat can be a complete v1 DAW without trying to match every mature DAW category.

## Progress Update Template

After each slice, update this section and `docs/serum-style-synth-roadmap.md`.

```text
Slice:
Date:
Changed:
Verification:
Remaining risk:
DAW completeness estimate:
Next slice:
```
