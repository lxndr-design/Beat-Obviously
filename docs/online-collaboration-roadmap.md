# Beat online collaboration architecture

## Product goal

Beat should grow from a local native DAW into an online-enabled, multi-editor
music workspace. A project can be edited by several people, while instruments,
patterns, sampler instruments, and related assets can be published, discovered,
versioned, reused, and remixed through the Beat repository.

The native app remains the authoritative real-time audio engine. Network loss
must not interrupt playback, recording, editing, saving, or export.

## Architectural boundaries

### Local audio plane

- Audio callback, instruments, automation evaluation, FX, buses, recording,
  audition, and ordinary export remain local and deterministic.
- The audio thread consumes immutable snapshots prepared outside the callback.
- Network requests, collaborative merging, asset downloads, and database work
  never run on the audio thread.

### Collaborative project plane

- Every track, segment, note, drum hit, automation point, bus, route, effect,
  and instrument reference has a stable globally unique ID.
- User actions become semantic operations such as move segment, resize note,
  change velocity, insert automation point, or route track to bus.
- Related operations are committed as transactions so a grouped move, linked
  stem edit, arpeggiation change, or multi-note edit cannot merge halfway.
- Concurrent operations merge into a canonical project state. The `.beat`
  document remains a portable snapshot and interchange boundary.
- Named versions and checkpoints provide human-readable history; operation logs
  provide synchronization and recovery.

### Asset plane

- Audio and sampler payloads are immutable, content-addressed objects identified
  by cryptographic hash.
- Projects reference exact asset and instrument versions, not mutable library
  names or local paths.
- Downloads use a local cache and continue working offline after acquisition.
- Publishing records author, license, source/provenance, compatible Beat
  version, dependencies, tags, song associations, and preview media.
- Removing or updating a public asset never silently changes an existing song.

### Presence and session plane

- A low-latency session channel carries presence, cursors, selections, focused
  tracks, comments, and committed project operations.
- Presence is ephemeral and never dirties the project.
- Early collaborative playback uses a transport leader and shared musical
  position while every participant renders locally. Sample-accurate remote
  jamming is a separate later problem and is not implied by multi-editor mode.

## Delivery phases

### Phase 0: collaboration-ready local model

1. Inventory stable IDs and replace position/index identity where it remains.
2. Route every mutating editor action through explicit command transactions.
3. Add deterministic operation replay and project-state fingerprint tests.
4. Version asset references independently from project schema versions.
5. Preserve all current offline behavior and beta reliability gates.

### Phase 1: identity, cloud backup, and history

1. Accounts, organizations/workspaces, and project permissions.
2. Encrypted upload/download and single-user multi-device synchronization.
3. Immutable project versions, recovery, and activity history.
4. Content-addressed asset upload, cache, resumable transfer, and quota rules.

### Phase 2: Beat repository

1. Publish and install versioned instruments, patterns, and sampler instruments.
2. Search by role, genre, timbre, song association, author, license, and engine.
3. Dependency resolution, compatibility warnings, update pinning, and offline
   cache management.
4. Fork/remix lineage, attribution, reporting, moderation, and rights controls.

### Phase 3: multi-editor projects

1. Presence, selections, comments, and follow-user navigation.
2. Conflict-safe editing for arrangement, MIDI, drums, automation, routing,
   instrument parameters, and metadata.
3. Transactions for linked/grouped edits and permission-aware undo.
4. Reconnect, offline edits, conflict visualization, and deterministic recovery.

### Phase 4: collaborative playback and publishing

1. Transport-leader review sessions with latency measurement and resync.
2. Shared preview renders and optional canonical server-side exports.
3. Publishable song pages, reusable project templates, and remix workflows.
4. Browser listening/review first; broader browser editing only where it can
   preserve native project and playback semantics.

## Non-goals and safeguards

- Do not replace Beat's project model with shared JSON blobs and last-write-wins
  saving.
- Do not put CRDT/merge logic, sockets, downloads, or authentication in the
  audio callback.
- Do not silently substitute missing or newly updated community assets.
- Do not promise remote sample-accurate live performance as part of ordinary
  multi-editor collaboration.
- Do not make a Beat service account necessary to open or export a local
  `.beat` project.
