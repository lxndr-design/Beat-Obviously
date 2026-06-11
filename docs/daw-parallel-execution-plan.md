# Beat DAW Parallel Execution Plan

## Objective

Move the DAW-comprehensiveness pass forward with multiple workers while keeping shared contracts, persistence, and engine files single-owner.

This plan complements `docs/daw-comprehensiveness-roadmap.md`. The roadmap defines the product target; this file defines how to split implementation without causing avoidable merge conflicts or half-wired features.

## Current Coordination State

- Repository was clean before this execution split.
- Parallel work is safe only for feature-local UI, pure verification, and documentation.
- Contract work must be serialized when it touches project state, IPC, persistence, or backend render behavior.
- Crossfade v1 should remain paired segment fades unless a later contract pass intentionally introduces a persisted crossfade object.
- True AU/VST execution remains out of scope for this pass; plugin UI should continue to show safe placeholders and DecentSampler-first behavior.

## File Locks

Only one worker should edit each group at a time.

| Lock | Files | Reason |
| --- | --- | --- |
| Frontend project model | `frontend/src/state/types.ts`, `frontend/src/state/store.ts`, `frontend/src/state/selectors.ts` | Track, segment, recording, routing, automation, selection, and document actions converge here. |
| Frontend IPC | `frontend/src/ipc/schema.ts`, `frontend/src/ipc/bridge.ts` | Must stay in sync with backend IPC names and response shapes. |
| App shell | `frontend/src/App.tsx`, `frontend/src/features/EditorHost/EditorHost.tsx`, `frontend/src/features/TopBar/AppMenuButton.tsx` | Central hydration, dirty state, export calls, modal routing, and app commands. |
| Backend IPC | `backend/Source/Ipc/Schema.h`, `backend/Source/Ipc/MessageBridge.cpp` | One switch owns project, export, recording, asset, device, and repair requests. |
| Backend project model | `backend/Source/Audio/TrackModel.h`, `backend/Source/Persistence/ProjectRepository.cpp`, `backend/Source/Persistence/ProjectIntegrityVerifier.cpp` | Persisted DAW data must roundtrip and validate deterministically. |
| Backend audio engine | `backend/Source/Audio/AudioEngine.cpp`, `backend/Source/Audio/AudioEngine.h` | Recording, routing, automation, monitoring, render, bounce, and meters share realtime boundaries. |
| Backend stress | `backend/Tests/BackendStress.cpp` | Every backend lane wants coverage here; append tests in one coordinated pass or split helpers first. |
| UI kit registry | `frontend/src/components/index.ts`, `frontend/src/design/UiKitCatalog.tsx`, `frontend/src/design/tokens.css` | New primitives, demos, and tokens affect all feature lanes. |

## Parallel Wave 1

These tasks can run now in separate worktrees.

### Arrangement Interaction

Owned files:

- `frontend/src/features/Tracks/Segment.tsx`
- `frontend/src/features/Tracks/Segment.module.css`
- `frontend/src/features/Tracks/TrackLane.tsx`
- `frontend/src/features/Tracks/TrackList.tsx`
- `frontend/src/features/Tracks/Timeline.tsx`
- `frontend/src/features/Tracks/geometry.ts`
- `frontend/src/testing/interactionRunner.ts`
- `scripts/verify-frontend-interactions.mjs`
- `scripts/verify-daw-core.mjs`

Scope:

- Add visible fade handles using existing `fadeInBeats` and `fadeOutBeats`.
- Improve segment click, handle drag, marquee, and snap coverage.
- Keep crossfade as paired fades for this wave.

Avoid:

- New persisted crossfade shape.
- Broad edits in `frontend/src/state/store.ts`.
- Backend render changes.

### UI Kit And Design Verification

Owned files:

- `scripts/verify-design-system.mjs`
- Existing `frontend/src/components/*/*.demo.tsx` files when a demo-only correction is needed.

Scope:

- Extend verification beyond component demos into practical feature CSS and TSX drift checks.
- Prefer clear allowlists for current intentional exceptions over broad suppression.
- Keep `npm run verify:design-system` passing.

Avoid:

- Token changes.
- Feature implementation rewrites.
- Catalog/barrel edits unless a component demo is intentionally added in a serialized follow-up.

### Project Health UI

Owned files:

- `frontend/src/features/ProjectHealth/ProjectHealthModal.tsx`
- `frontend/src/features/ProjectHealth/ProjectHealthModal.module.css`

Scope:

- Categorize existing reports into fatal structure, missing media, sidecars, stale metadata, recording/input warnings, export warnings, and general warnings.
- Surface existing safe repairs already supported by current IPC.
- Improve empty/loading/error states.

Avoid:

- New repair request kinds.
- Backup browser rewrites.
- `documentActions.ts`, IPC, backend, or app-shell edits.

### Home Asset UI

Owned files:

- `frontend/src/features/HomeHub/AudioFilesPage.tsx`
- `frontend/src/features/HomeHub/AudioFilesPage.module.css`
- `frontend/src/features/HomeHub/InstrumentsPage.tsx`
- `frontend/src/features/HomeHub/InstrumentsPage.module.css`
- `frontend/src/features/HomeHub/PatternsPage.tsx`
- `frontend/src/features/HomeHub/AssetPageShell.tsx`

Scope:

- Improve existing asset-list clarity, empty states, and action affordances.
- Show managed/external/missing/reference warnings only from data that already exists.
- Keep actions backed by current APIs.

Avoid:

- New asset graph schema.
- `App.tsx`, `store.ts`, IPC, backend, and document action changes.

## Serial Contract Lane

These decisions should land before deeper workers branch.

### Recording Contract

Current mismatch:

- Backend `Track` already has `recordArmed`, `inputMonitoring`, `inputDeviceId`, `inputChannelStart`, `inputChannelCount`, and `recordGainDb`.
- Backend `Project` already has `recordingInput`.
- Frontend `Track` and `Project` do not yet type those fields.
- IPC currently exposes only `audio.listDevices` and `audio.selectInputDevice`.

Required contract:

- Add frontend project and track recording fields.
- Define recording lifecycle IPC: prepare/session plan, start, stop, cancel, commit, status, and error shape.
- Define count-in and take-destination policy.
- Define how a stopped recording becomes a managed audio file and segment.

Single-owner files:

- `frontend/src/state/types.ts`
- `frontend/src/state/store.ts`
- `frontend/src/persistence/beatDocument.ts`
- `frontend/src/ipc/schema.ts`
- `frontend/src/ipc/bridge.ts`
- `backend/Source/Ipc/Schema.h`
- `backend/Source/Ipc/MessageBridge.cpp`
- `backend/Source/Audio/AudioEngine.*`
- `backend/Source/Audio/Recording/*`
- `backend/Tests/BackendStress.cpp`

### Mixer, Routing, Automation, Freeze Contract

Current mismatch:

- Frontend has track effects, sends, return buses, 7-band master EQ automation, and synth modulation surfaces.
- Backend has route buffers, effects, sends/returns, group routing, master chain, 4-band EQ persistence, and bounce helpers.
- Effect metadata/defaults are duplicated across frontend and backend.
- Bounce exists through IPC, but freeze/unfreeze is not a persisted first-class workflow.

Required contract:

- Choose canonical effect metadata/default source.
- Decide whether master EQ remains 7-band end to end or maps explicitly to backend bands.
- Define send automation target IDs and engine application.
- Define return bus and group route cycle rules.
- Define freeze metadata: source track, rendered asset, stale criteria, unfreeze behavior, and destructive confirmation.
- Define bounce insertion policy for the frontend.

Single-owner files:

- `frontend/src/state/types.ts`
- `frontend/src/state/store.ts`
- `frontend/src/automation/*`
- `frontend/src/ipc/schema.ts`
- `backend/Source/Audio/TrackModel.h`
- `backend/Source/Audio/AudioEngine.*`
- `backend/Source/Audio/Effects/TrackEffectDefaults.*`
- `backend/Source/Audio/Rendering/*`
- `backend/Source/Ipc/Schema.h`
- `backend/Source/Ipc/MessageBridge.cpp`
- `backend/Tests/BackendStress.cpp`

### Asset, Export, And Recovery Contract

Current mismatch:

- Project Health and Home asset pages can show existing reports but do not have a shared asset reference graph.
- Export has async status, cancel, range, track, bounce, and analysis, but no preset/review UI contract.
- Asset manifest generation exists in frontend document building and backend packaging/verification.

Required contract:

- Define a shared asset reference graph response or helper.
- Define export preset serialization and recent export destination policy.
- Define all-track stem export as backend helper or frontend queue.
- Define pre-export validation behavior and blocking severity.
- Define backup restore copy vs replace semantics.

Single-owner files:

- `frontend/src/ipc/schema.ts`
- `frontend/src/state/exportStore.ts`
- `frontend/src/persistence/beatDocument.ts`
- `frontend/src/persistence/documentActions.ts`
- `backend/Source/Persistence/ProjectAssetPackage.*`
- `backend/Source/Persistence/ProjectDocumentBackup.*`
- `backend/Source/Persistence/ProjectIntegrityVerifier.*`
- `backend/Source/Ipc/MessageBridge.cpp`
- `backend/Tests/BackendStress.cpp`

## Integration Order

1. Land Wave 1 feature-local UI and verifier changes.
2. Run `npm run verify:design-system`, `npm run verify:interactions`, `npm run verify:daw`, `npm run typecheck`, and `npm run build`.
3. Land recording frontend model fields and document roundtrip coverage.
4. Land recording IPC lifecycle and backend workflow.
5. Land recording UI surfaces: Preferences, Track Header/Details, Transport, Take Review.
6. Land mixer/automation contract.
7. Land automation lane UI and mixer/routing UI in separate frontend lanes.
8. Land backend routing/send/freeze/export parity and stress coverage.
9. Land asset graph/export preset/project health recovery contracts.
10. Run the full release gate from `docs/daw-comprehensiveness-roadmap.md`.

## Verification Matrix

| Lane | Minimum checks |
| --- | --- |
| Arrangement interaction | `npm run verify:interactions`, `npm run verify:daw`, `npm run typecheck` |
| UI kit verifier | `npm run verify:design-system`, `npm run typecheck` |
| Project Health UI | `npm run typecheck`, `npm run build` |
| Home asset UI | `npm run typecheck`, `npm run build` |
| Recording contract/backend | `npm run verify:documents`, `npm run typecheck`, `cmake --build build-native --target BeatBackendStress`, `build-native/bin/BeatBackendStress` |
| Mixer/routing/freeze backend | `npm run verify:daw`, `npm run verify:documents`, `cmake --build build-native --target BeatBackendStress`, `build-native/bin/BeatBackendStress` |
| Export/recovery | `npm run verify:documents`, `npm run verify:native-doc`, `npm run typecheck`, `build-native/bin/BeatBackendStress` |

## Handoff Rule

Every worker should finish with:

```text
Changed:
Verification:
Touched shared locks:
Known risks:
Next safe follow-up:
```

If a task needs a locked file, stop and hand off the required contract change instead of editing through the lock.
