# Beat DAW Comprehensiveness Roadmap

## Objective

Move Beat from a strong prototype/early serious DAW to a comprehensive DAW in one focused buildout pass.

This is not a “more features” list. The goal is to make the existing system feel complete enough that a user can start a project, record/import material, arrange it, edit it, automate it, mix it, export it, recover from mistakes, and trust the file on disk.

Target framing:

- Current state: about `60-70%` DAW-complete depending on whether the benchmark is backend capability or product UX.
- Target state: `100%` for Beat’s intended v1 DAW scope, not “all features every commercial DAW has.”
- Non-goal: true third-party AU/VST hosting in this pass. Plugin intent and adapter metadata should remain safe placeholders until a dedicated crash-isolated host exists.

## Definition Of 100%

Beat reaches v1 DAW comprehensiveness when these workflows are complete end to end:

1. **Create/open/save a project** with durable `.beat` documents, asset packaging, recent projects, backups, and recoverable health reports.
2. **Build an arrangement** with MIDI, drum, audio, sampler, synth, grouped tracks, review loops, selection, editing, snapping, trimming, fades, and reversible destructive operations.
3. **Record audio** with armed tracks, input device/channel selection, monitoring, count-in, latency calibration, take commit/rollback, and take management.
4. **Edit MIDI and drums** with reliable piano roll and drum grid workflows, velocity/pitch/automation editing, reusable components/patterns, and browser-level interaction confidence.
5. **Manage assets** from Home and in-project libraries: audio files, instruments, patterns/components, DecentSampler imports, missing-file relink, deletion, and reference warnings.
6. **Automate sound over time** with visible lanes for track, effect, segment, note, project, and instrument targets, clear conflict rules, curve editing, and parity between live playback/export.
7. **Mix and route** with track effects, sends/returns, group routing UI, master chain, meters, bus semantics, freeze/bounce, stems, and predictable latency handling.
8. **Export with confidence** using full mix, range/review-loop, selected track/stem, format presets, progress/cancel, analysis, and previous-file preservation.
9. **Inspect and repair project health** without hidden state: assets, backups, sidecars, stale IDs, missing files, and deterministic repairs.
10. **Verify the product** through backend stress, pure interaction tests, document roundtrips, design-system checks, and browser smoke for the workflows that can break silently.

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
- Keep `npm run verify:design-system`, `npm run typecheck`, `npm run build`, and `build-native/bin/BeatBackendStress` green.
- Add a single command/script later if useful, but do not block the roadmap on test orchestration.
- Confirm current DAW percentage in `docs/serum-style-synth-roadmap.md` after each major slice.

Exit criteria:

- Clean repository.
- Existing stress/build paths pass.
- Roadmap is explicit enough to split work safely.

## Phase 1: Arrangement Editing Completion

Purpose: make timeline editing feel like a DAW instead of a demo surface.

Current assets:

- Timeline, tracks, segments, marquee, drag/resize, visible fade handles, split/trim/fade metadata, paste/duplicate, rename/color/icon metadata, crossfade commands, review loop, transport actions, grouped history, and pure geometry/interaction verifiers exist.
- `npm run verify:daw` covers edit-command behavior for move, resize, duplicate, paste, delete, rename/color/icon metadata, nudge, quantize, split, trim, fade, crossfade, grouped undo/redo, and timeline geometry.
- `npm run verify:track-interactions` covers free segment drag/resize/fade by default with Shift-based snapping.

Build:

- Edit command policy for group/ungroup.
- Explicit destructive-operation confirmation rules.
- Multi-select command bar or context actions for selected segments.
- Track/body/segment click behavior audit: selection, additive selection, context menu, empty-area click, drag handles, lane drop targets.
- Snap/grid policy surfaced consistently: bar, beat, subdivision, sample/time for audio where relevant.
- Browser-level smoke for marquee, drag, resize, split, fade, crossfade, and loop marker interaction.

Backend/model:

- Ensure crossfades and trims affect live and export paths identically.
- Add stress for fade/crossfade render parity and invalid trim/crossfade repair warnings.

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
- Track channel strips: meter, fader, pan, mute, solo, arm, input, output/group, sends, inserts.
- Return bus UI: create bus, route sends, mute/solo, effects, level.
- Group/folder track UI: create group, assign parent, collapse/expand, group effects/sends.
- Freeze/bounce UI:
  - Freeze selected track.
  - Bounce in place.
  - Export selected track stem.
  - Reversible unfreeze metadata.
  - Clear parent-routing policy in UI.
- Latency reporting per track/effect route.
- Master section: input gain, compressor, EQ, output gain, limiter, loudness/peak readouts.

Backend/model:

- Persist mixer state and grouping UI metadata.
- Add group/return/freeze project-health validation.
- Add stem/freeze parity checks for group and send scenarios.

Acceptance:

- Users can understand and modify where every track goes.
- Freeze/bounce is reversible or explicitly destructive with confirmation.
- Master output is controlled and export-identical.

## Phase 6: Asset Management And Project Portability

Purpose: make Beat projects portable and libraries manageable.

Current assets:

- Home hub, audio/instrument/pattern pages, audio metadata/waveform analysis, DecentSampler import, project asset manifest, sidecar packaging, missing asset relink, Project Health, recent projects, backups, and sidecar cleanup exist.

Build:

- Global audio-file actions: relink, replace, reveal, delete, copy into project, remove unused.
- Instrument actions: duplicate, version, reveal source, repair missing samples, inspect sample zones.
- Explicit velocity/key/round-robin/choke editor for sampler instruments.
- Project asset browser: all assets used by current project, external vs bundled state, missing/unused/managed indicators.
- One-click package project assets for portability.
- Copy-on-save policy surfaced in document UI.
- Safer delete flows with reference counts and affected tracks/segments.

Backend/model:

- Asset reference graph helper shared by Project Health and UI.
- Deterministic asset package/relink tests for audio files, sample URLs, sample maps, plugin adapters, and component references.

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
- Post-export review panel: duration, sample rate, bit depth, peak, true peak, RMS, LUFS, clipping, DC offset, correlation.
- Cancel/failed/success states in one consistent export job panel.
- Batch stem export naming policy.

Backend/model:

- Add all-track stems export helper if not built from repeated single-track calls.
- Add export preset serialization in preferences.
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

- `npm run verify:design-system`
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
