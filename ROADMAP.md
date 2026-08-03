# Beat Roadmap

> Update this file only from direct user input or after the user explicitly approves a specific plan. A query by itself never authorizes a roadmap write.

## Now

- Beta stabilization: freeze large feature work while the release gates below
  are brought to green.
- Project safety: prove save/load migration, backup/recovery, missing-asset
  relinking, and failure-safe document handling.
- Playback parity: prove editor audition, arrangement playback, solo/mute, and
  offline export agree for MIDI, drums, samples, instruments, automation, FX,
  and buses.
- Overload safety: replace freezes or project-threatening failure with bounded
  voice limiting, actionable warnings, cancellation, or stopped playback.
- Release verification: provide one repeatable command covering frontend,
  native audio stress, document integrity, packaging, signing, and bundle
  contents.
- Private beta soak: complete representative create/edit/save/reopen/export
  sessions on clean supported Macs with no data-loss, crash, or silent-audio
  blocker.

## Next

- Prepare the project model for online use without changing offline behavior:
  stable IDs for every collaboratively editable object, explicit edit
  operations, transaction boundaries, deterministic migrations, and versioned
  asset references.
- Add single-user accounts, encrypted cloud backup/sync, device handoff, and
  project history before multi-editor mutation is enabled.
- Establish a Beat repository for versioned instruments, patterns, sampler
  instruments, and sample-dependent assets with authorship, song/source tags,
  licensing, compatibility, dependencies, and content hashes.

## Later

- Online-enabled multi-editor projects with presence, selections, comments,
  permissions, named versions, and conflict-safe concurrent editing, following
  the local-to-collaborative product transition exemplified by Figma and
  Sketch.
- Community discovery, publishing, remix/fork lineage, ratings, collections,
  and updates for user-made instruments, patterns, sampler instruments, and
  other reusable musical assets.
- Collaborative transport and review sessions. Each client renders audio
  locally; network state must never enter Beat's real-time audio callback.
- Optional cloud rendering, previews, and project publishing after local
  playback/export parity and asset licensing are enforceable.

## Decisions

- Beat's current feature set is sufficient for beta. Beta readiness is defined
  by reliability, project safety, playback/export consistency, graceful
  overload behavior, diagnostics, and clean-machine distribution rather than
  additional headline features.
- Full AU/VST3 hosting and unrestricted custom scripting are not beta gates.
  Keep current safe plugin-adapter and sampler-import behavior during the
  stabilization milestone.
- Beat remains offline-capable and `.beat` remains a portable project format.
  Online collaboration augments the native DAW rather than making playback,
  editing, saving, or export dependent on a service connection.
- Collaboration synchronizes semantic edit operations and immutable asset
  references, never audio-thread state or raw per-sample DSP execution.

## Deferred

- Live AU/VST3 execution: deferred until after the beta foundation because
  scanning, sandboxing, state recall, missing-plugin fallback, UI hosting, and
  offline-render parity materially expand the crash and compatibility surface.
- General custom scripting: deferred until a constrained, deterministic Beat
  Actions API can be designed without filesystem or real-time audio-thread
  execution hazards.
