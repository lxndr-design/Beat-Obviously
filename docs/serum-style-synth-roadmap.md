# Beat DAW + Aether Roadmap

## Goal

Build Beat into a coherent DAW with a serious native synth/sampler stack. The target is not a quick Serum clone. The target is a trustworthy music system: stable timeline, reliable documents, mathematically sound audio rendering, real-time-safe engine behavior, and an Aether synth that grows from a strong internal architecture instead of a pile of UI controls.

This roadmap replaces the older Serum-style checklist. The focused v1 DAW completion plan lives in `docs/daw-comprehensiveness-roadmap.md`; current low-level audio-engine decisions and verification details live in `docs/audio-engine.md`; folder-structure migration guidance lives in `docs/project-structure.md`; stable synth IDs live in `docs/synth-parameter-contract.md`.

Status legend:

- `[x]` implemented and covered by at least one build or stress path.
- `[~]` partially implemented; usable, but not complete enough to call foundational.
- `[ ]` not implemented or only placeholder-level.

## Current Product Read

- DAW Core: `[~]` roughly early serious-prototype stage. Native transport, segment scheduling, loop clamps, selection, track routing, meters, effects, project IO, and WAV export exist, but recording, deep automation UI, mixer/bus architecture, document UX, and edit invariants still need serious work.
- Audio Engine: `[~]` stronger than the UI. It has immutable project snapshots, SPSC transport commands, route buffers, native synth/sampler/audio-clip rendering, live/export parity stress tests, timing counters, live master dB/true-peak/momentary-LUFS metering, and safer export writes.
- Aether Synth: `[~]` real but not mature. It has multi-osc wavetable controls, unison, two-LFO modulation routing, cached wavetable lookup, analyzer/preview surfaces, preset beginnings, durable wavemap metadata, native/browser audio-import resynthesis with phase-aware harmonic partial extraction, direct mini-waveform sketching, editable frame scan anchors, continuous harmonic-drawing controls with smoothing/clear transforms, Env 1/Env 2 looping, extracted native envelope, LFO, modulation-routing, oscillator, and pure filter-math helpers, and non-AI normalize/evolve helpers from the Solid oscillator editor. It still needs richer wavemap drawing semantics, richer envelope/macro behavior, a proper FX rack, and full modulation UX.
- Sampler/Plugin Imports: `[~]` DecentSampler import, package inspection, protected wrapper UI, and sample-zone playback exist. Plugin hosting is still a protected-adapter/renderer flow, not a true third-party host.
- UI/UX Coherence: `[~]` the visual language is now recognizable, but many surfaces were built opportunistically and still need a system-wide pass for shared component usage, spacing, modal footers, hover/selection states, focus behavior, and asset-page consistency.
  - Frontend Solid migration track: Solid UI kit first, node editor proof, then tracks/lanes/segments. Current state is Solid-owned app entry/root shell, startup splash, app hydration/effects, global hotkeys, native event wiring, dialog/dirty-close hosts, timeline MIDI playback runner, training auto-runner, node instrument editor, top bar/app menu, Home hub shell, Home Audio Files asset page, Home Instruments asset page, Home Patterns asset page, full sidebar rail/resizer/panel switcher/content stack, audio-file library panel, component library panel, instrument library panel, plugin library panel, DecentSampler library panel, plugin/DS import modal, plugin host/DS skin editor, audio grouping/import modal, instrument merge modal, Preferences, Project Health, Track Details, Track Effects modal, raw-Three visualizer, transport time-signature control, MIDI preview transport, Piano Roll, Drum Sequencer, master EQ panel/graph, master EQ automation modal, debug/export utility panels, instrument waveform picker/preview, instrument editor modal, editor-host dispatcher, full synth editor shell with analyzer/oscillator/modulation/LFO/macro/filter controls, component editor shell, segment editor shell, track shell, headers, timeline, playhead, lanes, segments, and track effect automation rows. Shared app dialog/modal-stack hosts, primitive CSS modules, `Block`, and `DitheredImage` now live under `frontend/src/solid-ui`; track components have been flattened into `frontend/src/features/Tracks`; the old `frontend/src/components` and `frontend/src/react-bridge` compatibility folders plus unused `mount*Solid` bridge APIs have been removed. Migrated component, demo, runtime, and prop symbols no longer carry `Solid` suffix names now that `.solid.tsx` is the framework marker, and the design-system verifier guards that convention. React source, React demos, React bridges, `@vitejs/plugin-react`, `react`, `react-dom`, and `zundo` have been removed; app state uses vanilla Zustand plus local undo history. Frontend tooling is on Vite 8 with `esbuild` explicit for verifier scripts and npm audit currently clean. The native C++ core remains responsible for audio graph, DSP, timing, scheduling, persistence, undoable project commands, and file I/O.
- AI Generation: `[~]` beat/instrument generation exists, but must stay subordinate to genre rules, editable musical structure, and deterministic DAW state.
- Codebase Structure: `[~]` forward structure is documented, but several large modules still need careful extraction.

## Buildout Progress Tracker

These percentages are engineering-readiness estimates, not feature-count estimates. They should be updated after each meaningful buildout alongside the next concrete backend/UI steps.

Last updated: 2026-06-19

- DAW core competency: `69%`
  - Recent movement: transport panic/reset path, transport command coalescing for rapid play/pause/seek/restart bursts, non-blocking urgent transport fast path for pause/stop/restart/seek that clears stale queued play commands when the audio lock is available, immediate atomic transport state updates for play/pause/stop/restart/seek/speed/loop requests before the queued audio-thread reset path catches up, backend recording append-take planner, count-in/session planner for record-armed tracks, preallocated native input-recording capture buffer with WAV finalization stress, staged captured-take commit/rollback helper, recording latency-compensated placement, recording latency calibration math, persisted input/calibration profile metadata, default-off native input monitoring path, track-arm-driven monitoring enable/disable, explicit input-capable live-device preparation, track-arm/input metadata roundtrip, native input-device enumeration/selection IPC, local project repository audio-file/clip and sample-instrument roundtrip, shared frontend transport actions for play/pause/stop/restart cleanup, review-loop backend, selection/edit verifier, renderer-independent selection-domain invariants, grouped project-history transactions, pure timeline coordinate/marquee geometry tests, pure frontend interaction runner coverage for segment drag/resize, loop clamps, modal close policy, and marquee clamps, effect rows, MIDI editor interaction pass, first Home hub workflow, local-preview segment drag/resize commit path, backend group/folder routing foundation with integrity checks for bad parent graphs, backend freeze/bounce planner plus `project.bounceTrackWav` IPC that commits a rendered track stem as a playable replacement audio track while preserving the muted source track, explicit freeze/export parent-routing policy for bounced stems, clearer native render timing for route effects, live master dB/true-peak/momentary-LUFS meter publication with backend stress coverage, locked project-apply runtime-boundary stress coverage that prevents stale voices/tails after project swaps, and render-boundary normalization for overlong audio-clip fade pairs.
  - Next steps: richer undo/redo destructive-operation policy, track/body interaction coverage, broader browser interaction coverage for marquee/drag edge cases, group routing UI, freeze/bounce UI and reversible unfreeze metadata, and latency-reporting polish.
- Document/export safety: `99%`
  - Recent movement: `.beat` Save/Save As/Open, LaunchServices document-type registration/package helper hardening for the root `Beat.app`, build-time `.beat` document-type registration in generated macOS app bundles, native document-registration verifier for built `Beat.app` bundle metadata/resources/executable wiring, dirty fingerprints, native WAV export, temp-file writes, temp WAV reader validation before final replacement, cancelled export preservation of previous destination files, document roundtrip verifier, asset manifest, missing-asset warnings/preflight, sidecar asset copy, relative path writing, relative path resolving on open, backend sidecar stress coverage, direct recent-open, native recent-project registry/list/remove/reveal IPC, Home recent-project list/remove/view-in-folder wiring, missing-asset relink before hydration, relink verifier coverage for audio/sample/sample-map references, backend project-integrity verification for missing references/orphaned sidecar files/duplicate IDs/invalid segment graphs/audio-segment trim and fade validity/recording metadata sanity, native Save integrity preflight before overwrite, successful-save integrity report return, frontend document-state retention for integrity reports/cleanup reports/backup paths, Project Health menu/modal surface for retained integrity/missing-asset/cleanup/backup state, on-demand Project Health backend rescan IPC, Project Health relink actions that update the live document and preserve dirty state, native Project Health repair IPC for deterministic asset-manifest rebuilds with backend stress coverage, Project Health copied-sidecar cleanup management UI for detected/deleted/failed orphan files, open integrity reports, fatal structural-integrity rejection before native Open hydration while keeping missing media relinkable, native WAV export analysis diagnostics including bit depth, previous-good project backups before overwrite, backend backup list/restore with stress coverage, backup restore path confinement, fatal-integrity rejection during restore, backup metadata surfacing, menu-driven backup recovery UI, offline export progress/cancel callback foundation, IPC-callable track stem export, IPC-callable beat-range export with stress coverage, app-menu Full Mix/Review Range/Selected Track WAV export wiring, IPC-callable sidecar cleanup helper with orphan cleanup stress coverage, automatic post-save sidecar cleanup reporting, native audio-library metadata repair for older imported files, background full/range/stem export jobs with progress/status/cancel IPC, native export progress/cancel UI wiring, deterministic recent-project repository stress coverage, local project repository audio-file/clip/sample-instrument plus MIDI fractional pitch-curve and per-note automation roundtrip stress coverage, bounded native export format options for sample rate, mono/stereo channels, block size, and 16/24/32-bit WAV depth, and a deterministic repair helper for stale segment container `trackId` metadata.
  - Next steps: small user-facing export preset UI, repair UI for the safe segment-container fix, and strict LaunchServices app-registration verification for Finder double-click `.beat` association.
- Live/export render parity: `72%`
  - Recent movement: native synth/sampler/audio-clip export parity stress, faded audio-clip live/export parity, overlong audio-clip fade normalization stress, dense Aether live/export parity stress, route effects in live/offline path, instrument-owned FX live/export parity and export-tail stress, master limiter, sample-rate matrix, effect-owned automation lane parity, route-gain automation block-size stability stress, fractional native MIDI pitch-curve scheduling, plugin/effect latency metadata with a backend estimator, adapter-capability-derived plugin effect latency, preallocated plugin-latency/route-compensation delay lines with stress coverage, offline range rendering through the same engine path, nonzero-beat range export parity against live playback after seek, review-loop clamp range export parity against live loop playback, and native effect default normalization at engine ingress so live IPC and export prepare the same route state.
  - Next steps: review-loop export IPC/UI cases, crossfade parity, true hosted-plugin latency reports once plugin processing exists.
- Aether synth engine: `93%`
  - Recent movement: cached wavetable/unison math, dense Aether route stress, max-unison polyphony route stress, modulation routing, shared immutable wavetable tables across identical voice configs, analyzer/preview plumbing, native offline instrument-preview render analysis for future Home/instrument-management surfaces, render-timing-visible wavetable cache hit/miss/size counters, low-overhead voice work counters for oscillator/wavetable/filter/modulation/ramp scaling with backend stress assertions, Aether-specific render-slice counters for oscillator A/B/sub/noise work, cached static Aether oscillator/sub pitch-rate math with a timing-visible dynamic-rate recalculation counter, cached dynamic-modulation route-active flags outside the per-sample Aether render loop, cached per-target dynamic modulation activity flags so inactive modulation rows do not execute per-sample offset/filter work, shared per-sample unison detune/spread modulation evaluation across Aether oscillators, reduced static pitch-rate recalculation inside the Aether render loop, base-2 pitch-ratio math switched from generic `pow(2, x)` to direct `exp2(x)`, quantized wavetable frequency/position control updates with stress-visible churn counters, disabled/non-wavetable Aether oscillator setup gating to avoid unnecessary table/bank configuration, legacy wavetable-bank setup skip while Aether mode owns synthesis, zero-drive nonlinear bypass so clean Aether/basic oscillator paths avoid per-sample `tanh()` work, bounded 2x midpoint oversampling for active voice-drive nonlinear stages with warmed bypass state and stress-visible drive work counters, bounded polyBLEP edge correction for built-in saw/square oscillators with voice stress coverage, deeper timing counters for filter drive plus coefficient-update churn, first-class instrument-owned FX chains that render through the same route FX processor before track FX, first-class wavemap metadata with deterministic audio-sample resynthesis plus legacy custom-wavetable compatibility, audio-file wavemap import through the Solid oscillator editor/native IPC bridge, phase-aware harmonic partial extraction during browser/native audio resynthesis, deterministic normalize/evolve wavemap transforms with verifier coverage, per-frame wavemap `skew` harmonic-bias, `tilt` spectral slope, `focus` resonance narrowing, `formant` resonant-band, `notch` harmonic-carve, 16-bin continuous `partials` harmonic-drawing controls with smooth/clear transforms, direct mini-waveform sketching that derives FFT-style partial/frame controls, and editable frame scan anchors that alter browser preview output across Solid UI, browser preview, native wavetable generation, patch parsing, audio-resynthesis metadata, and verifier/stress coverage, wavemap `linear`/`smooth` interpolation plus wavemap-level `morph` scan shaping now change browser preview and native custom table generation with cache-key/parser/stress coverage, a second Aether LFO source wired through Solid controls, browser preview, synth-patch roundtrip, native project persistence/IPC, dynamic voice modulation, and backend stress coverage, normalized LFO 1/2 phase offsets honored by browser preview and native note retrigger, patch-driven LFO retrigger and one-shot toggles covered by JS roundtrip and backend stress, oscillator phase/random-phase controls honored by Solid UI, browser preview, IPC, native patch parsing, and note-on wavetable/built-in oscillator rendering, tempo-synced LFO divisions wired through Solid controls, browser buffer/worklet previews, native IPC/persistence, synth-patch parsing, and native render-time BPM conversion, LFO 1/2 shape smoothing wired through Solid controls, browser/worklet preview, native render, patch parsing, and verifier/stress coverage, LFO 1/2 random phase controls wired through Solid controls, browser/worklet preview offsets, native note-on retrigger offsets, patch parsing, persistence, and verifier/stress coverage, bounded `shape`/`fold`/`pinch` wavetable warp modes wired through Solid controls, browser/worklet previews, native table generation, IPC/persistence, patch parsing, JS verifier coverage, and backend stress, durable macro labels/ranges/curves with visible assignments plus browser/native range-curve route math, filter keytracking across Solid controls, patch contract, browser preview, native parser/persistence, and native render, velocity modulation routed through Solid modulation controls, browser preview/timeline render, native patch parsing, and native voice render stress, Env 2 modulation semantics across the Solid matrix, browser preview, native parser, runtime voice ADSR, and backend stress, Env 2 curve shaping plus Solid envelope controls for mod-envelope timing/curve edits, Env 2 looping across Solid controls, browser preview, synth patch contract, native parser, runtime voice modulation, and verifier/stress coverage, keytrack as a routable modulation source through the Solid matrix, browser preview, native parser, and native voice render stress, mod wheel as a routed global modulation source through Solid controls, browser preview buffers, native patch parsing, MIDI CC1 handling, and backend stress, runtime pitch bend for browser previews plus native Aether/basic voices with backend frequency-ratio stress coverage, linked-note glide timing through browser preview, native MIDI persistence/IPC, sequencer trigger metadata, and native pitch-ramp scheduling, explicit `maxVoices` allocation caps with native note stealing and timing-snapshot stress coverage, and mono/legato performance controls with native voice-retune stress coverage.
  - Next steps: deeper wavemap drawing/resynthesis controls, richer envelope/macro modulation behavior, Aether FX preset/version migration, UI for instrument-owned FX, and heavier nonlinear warp experiments after oversampling strategy is extended to Aether warp stages.
- Sampler/import layer: `77%`
  - Recent movement: DecentSampler import, native-file-path handoff for DS installs when the host exposes a local file path, direct zone path loading, DS package UI metadata parsing, structured DS control geometry/default/range/binding metadata, DS declared lowpass/reverb effect parsing and bridging into Beat sampler instrument-owned FX defaults, package-skin wrapper hotspots plus fallback image-resource detection for packages without explicit `bgImage`, Lorenzo drum-kit package metadata fixture coverage, Lorenzo drum-kit native sampler playback/export stress coverage, DS group-level volume/round-robin/choke metadata inheritance into sample zones, DS instrument-level release control defaults carried into the generated Beat sampler instrument, installed DecentSampler package/renderer adapter registration, DecentSampler rail install/open flow into the protected package wrapper instead of the generic Aether editor, install/import-time creation of Beat-compatible native sampler instruments for MIDI segments without Aether fallback or synth-editor handoff, native persistence of the DS package adapter's hidden sampler `associatedInstrumentId`, project-integrity warnings for DS adapters whose sampler bridge is missing, stale generic synth/bridge DecentSampler adapter migration back into DS package adapters, parsed DS adapters now advertise live sampler-compatible capability metadata instead of rendered-audio fallback, local persistence and de-duping for installed plugin adapters across project transitions, length-aware hit variants, combined velocity + note-length sample-zone stress, DS duration/length/choke metadata preservation in runtime fixture projects, DS sample start/end offset preservation through import, package sidecars, repository roundtrip, native playback/export, and browser preview, choke/exclusive groups with backend stress coverage, explicit plugin adapter capability metadata across frontend/native project models with repository stress coverage, portable sidecar packaging for external sample/audio assets with sample-zone metadata preservation stress, audio-library list-time metadata repair for legacy rows, bounded native audio-library deletion, and Instruments-page sample-structure editing with independent length/volume/hit/pitch variables.
  - Next steps: missing-file relink UI, trim/loop/root-note helpers, explicit velocity-layer editor, round-robin/group editor UX.
- Effects/automation: `63%`
  - Recent movement: track effect rows, effect timepoints, native route automation foundation, native post-fader send/return bus foundation with preallocated return buffers, reverb/delay/saturator/distortion/compressor/chorus/phaser/flanger path, bounded 2x midpoint oversampling for saturator/distortion with block-continuous per-effect state, stateful block-continuous bitcrush, route-effect work counters for total/filter/nonlinear/delay-style FX where nonlinear counts oversampled work, project-owned master-chain input/output gain plus optional compressor before the final limiter, shared effect automation metadata/value helpers, right-click effect timepoint curve editing, frontend curve utilities, bounded native curve checkpoints for hold/linear/quadratic/cubic/ease-in/ease-out/smoothstep automation spans with backend stress coverage, fractional note pitch-curve scheduling, per-note automation persistence, plugin effect latency fallback from adapter capabilities, instrument-owned FX persistence/rendering/tail estimation/project-health validation using the same effect model as track routes, DecentSampler-declared lowpass/reverb metadata mapped into generated sampler instrument FX chains, shared native effect schema/default migration for track, return-bus, and instrument-owned FX, and engine-ingress default normalization for live IPC/export projects.
  - Next steps: bus routing UI, named effect preset library, automation selection browser tests, unified note/segment/track/project/instrument automation UX.
- UI/UX coherence: `54%`
  - Recent movement: shared rail/navigation direction, Home hub, two-column audio/instrument/pattern asset pages, unified tooltip behavior, compact typography tokens, modal footer/button-row cleanup via `ActionFooter`, Recent Projects card grid, shared asset-page shell/ribbon framing, sidebar row hover/scroll treatment, segment/MIDI/effect interaction polish, and repeated use of the black/white ribbon system.
  - Next steps: audit remaining modal footer/action rows, extract shared asset browser table/list primitives, remove one-off dropdown sizing, add interaction snapshots for hover/selected/disabled states, and finish consistency passes for editor, plugin/import, and project-health surfaces.
- AI generation: `30%`
  - Recent movement: genre-guided beat generation, complexity redefinition, uploaded sample preference, local training hooks.
  - Next steps: deterministic generation fixtures per genre, phrase-level musical structure, instrument-role mapping, trainer status/data lifecycle.
- Codebase structure/testing: `81%`
  - Recent movement: docs split, frontend verifier scripts, backend stress expansion, plugin/library folders, shared DecentSampler-to-sampler conversion helper, DecentSampler compatibility modal isolated through the global editor host, DS metadata wrapper parsing plus fallback package-skin detection covered by backend stress, plugin-adapter hydration merge/helper and stale DS adapter migration covered by the frontend interaction verifier, native plugin-adapter sampler-association roundtrip coverage, project-integrity verifier coverage for stale plugin-associated sampler bridges, project asset packaging extracted from IPC into persistence helpers, recent-project persistence extracted into `ProjectRepository`, frontend recent-project metadata/card handling, backend project-integrity verifier coverage, deterministic recent-project and plugin-capability repository stress coverage, shared native effect parser/default migration coverage, native effect defaults extracted into `Audio/Effects/TrackEffectDefaults` for repository, IPC, live engine, and offline export paths, explicit instrument-library loading state, Home asset pages for audio files/instruments/patterns, shared Home asset-page shell/ribbon framing, route-effect timing/work-counter coverage, master-chain compressor/block-continuity stress coverage, native send/return bus routing stress coverage, native group/folder routing and parent-graph integrity stress coverage, native track-bounce planner extracted into `Audio/Rendering` with deterministic stress coverage, native audio-waveform bucket analysis with stress coverage, native document-registration verifier for built `Beat.app` package invariants, shared wavetable table ownership through the backend stress path, backend stress assertions for Aether render-work counters, per-component Aether render-slice counters, and setup-path cache accesses, route nonlinear oversampling counter/continuity stress, frontend use of native waveform/export endpoints, shared effect-automation metadata/curve helpers, frontend interaction runner foundation for editor/modal math, sequencer automation-curve checkpoint stress, route automation block-size stability stress, renderer-independent selection-domain tests, pure timeline geometry extraction for verifier coverage, repository/render stress coverage for instrument-owned FX, and removal of the inactive duplicate sample-render path from `AudioEngine`.
  - Next steps: extract oversized timeline/synth modules, add shared asset browser table/list primitives, and layer browser-level Playwright-style flow coverage on top of the pure interaction runner.

## Priority 1: DAW Core Competency

Purpose: make Beat reliable as a timeline-based audio editor before adding more high-level features.

Checklist:

- `[x]` Native transport requests are queued and drained on the audio thread in order.
- `[x]` Pause/stop/restart/seek use a panic/reset path for voices, sample voices, clip voices, route MIDI, automation, and FX tails.
- `[x]` Review-loop UI exists with draggable start/end clamps.
- `[x]` Review-loop backend does not wrap after a manual seek beyond the endpoint until playback crosses from before the endpoint.
- `[x]` Review-loop scheduling is piecewise inside a block, so MIDI, automation, and audio clips wrap together at the endpoint.
- `[x]` Backend stress covers transport burst, loop crossing, and loop-boundary event scheduling.
- `[~]` Timeline selection, marquee selection, segment drag, resize handles, and context menus exist. A first DAW edit-command verifier covers multi-move, resize clamp, duplicate, delete, split, trim, fade, origin-aware resize invariants, selection-domain exclusivity, grouped history transactions, and pure marquee/timeline coordinate helpers.
- `[~]` Track selection exists, but track/body/segment interactions need continued UI consistency.
- `[~]` Undo/redo exists for project state with explicit grouped-history transactions, but destructive-operation safety is still conservative and incomplete.
- `[~]` Add explicit edit-command model for move, resize, duplicate, delete, paste, nudge, quantize, split, trim, and fade. Next pass should add richer destructive-operation policy and renderer-independent selection tests.
- `[~]` Add deterministic tests for segment selection/edit semantics independent of renderer implementation. Store-level same-type/additive and cross-type exclusivity coverage exists; browser-level marquee/drag interaction coverage remains.
- `[~]` Add timeline ruler/clip coordinate tests for zoom, scroll, resize, and loop marker drag. Pure beat/x conversion, content width, marquee overlap, scroll-offset styling, timeline-zone clamp coverage, segment drag/resize preview coverage, and loop-clamp preview coverage exist; browser-level drag coverage remains.
- `[~]` Add proper recording workflow: backend take-to-audio-segment planning, count-in/session planning, preallocated input capture/write path, staged commit/rollback helper, latency-compensated placement, persisted input/calibration profile metadata, default-off and track-driven input monitoring, explicit input-capable live-device preparation, track-arm metadata, and native input-device enumeration/selection IPC exist; take naming UI and device-selection surface remain.
- `[~]` Add clip split/trim/fade/crossfade model. Split/trim/fade metadata now exists across frontend state, IPC, sequencer events, and audio-clip playback; crossfades and visible fade handles are still pending.
- `[~]` Add latency and compensation model for recording, plugin/render delay, and export alignment. Recording take placement, recording calibration math, persisted calibration profiles, and plugin route compensation exist; device timestamp handling and full export alignment reporting remain.

Done when:

- Rapid transport and edit bursts do not leave the app stuck, split-brained, or visually misleading.
- Timeline edits are deterministic enough to test without the browser.
- Playhead, loop markers, clip events, automation, and export all agree on the same musical time model.

## Priority 2: Documents, Persistence, And Export Safety

Purpose: make user work durable.

Checklist:

- `[x]` `.beat` document schema exists with frontend validation/migration gate.
- `[x]` Native Save/Save As/Open paths exist.
- `[x]` `.beat` saves write temp JSON, validate parseability, then replace the target file.
- `[x]` WAV export renders through an isolated offline engine.
- `[x]` WAV export writes to a sibling temp file, validates output, then replaces the target.
- `[x]` WAV export accepts bounded format options for sample rate, channels, block size, and 16/24/32-bit depth while preserving safe defaults.
- `[x]` Track stem export backend exists through `renderTrackToWav` and is callable through `project.exportTrackWav`.
- `[x]` Beat-range export exists through `renderProjectRangeToWav` and `project.exportRangeWav`, has stress coverage, and is exposed as Review Range WAV in the app menu.
- `[x]` Dirty-state UI is backed by a saved-document fingerprint instead of purely event-based dirty marking.
- `[~]` Local DB autosave exists, but document lifecycle and explicit file lifecycle need clearer user semantics.
- `[~]` Add Open Recent and current-path display. Native recent-project persistence/list/remove/reveal IPC, deterministic backend coverage, and Home recent-project open/remove/view-in-folder wiring exist; current-path display polish is still pending.
- `[~]` Add project package strategy for imported samples: asset manifest, policy tracking, external asset sidecar copy, relative path writing, relative path resolving on open, and missing-file relink UI exist. Copied-asset cleanup/versioning still need work.
- `[x]` Add backend project-integrity verifier for schema support, duplicate/missing IDs, invalid segment references, missing assets, and orphaned sidecar files.
- `[x]` Add backend helper, IPC hook, post-save cleanup reporting, and stress coverage for cleaning unused project sidecar assets after integrity reports identify orphans.
- `[x]` Add Project Health menu/modal surface for retained integrity reports, missing assets, cleanup reports, and last backup path.
- `[x]` Add on-demand Project Health rescan IPC that inspects the current document without saving or mutating files.
- `[x]` Add Project Health missing-asset relink action that updates the live document graph, marks it dirty, and rescans health.
- `[x]` Add native Project Health repair action for rebuilding stale asset manifests without touching musical data.
- `[x]` Add native safe repair command for stale segment container `trackId` metadata without changing timing or payload data.
- `[x]` Add Project Health copied-sidecar cleanup management UI for detected orphan files plus deleted/failed cleanup results.
- `[x]` Run backend project-integrity verification in native Save before temp-file write/replace.
- `[x]` Return backend project-integrity report from native Open before hydration.
- `[x]` Reject fatal structural project-integrity errors during native Open before replacing editor state, while allowing missing media to hydrate for relink/recovery flows.
- `[x]` Return native render analysis from successful WAV export: duration, channels, bit depth, peaks, true peak, RMS, crest factor, DC offset, clipping, stereo correlation, and integrated LUFS.
- `[x]` Add project backup/recovery files. Previous-good overwrite backups, backend backup listing, validated restore, backup metadata surfacing, native recovery browsing/restoration UI, and frontend retention of the last backup path now exist.
- `[x]` Add document roundtrip tests for instruments, components, audio files, plugin adapters, effect automation, and editor-safe migrations.
- `[x]` Add export cancellation and progress reporting. Full-project, beat-range, and track-stem async export jobs now share progress/status/cancel IPC and are reachable from the app menu.
- `[ ]` Add export formats beyond PCM16 WAV when the render path is stable.

Done when:

- A failed save/export does not destroy the last good file.
- A saved project can move machines and reopen with clear missing-asset behavior.
- Save/Open/New/Export cannot silently desync frontend, backend, local DB, and disk.

## Priority 3: Home Asset Management

Purpose: make global assets manageable outside the editor without opening heavy project state.

Checklist:

- `[~]` Home hub exists with Projects, Assets, and a separate AI section.
- `[~]` Audio Files page has navigation, metadata, waveform preview, transport controls, and producer-facing stats. Native builds use cached backend waveform buckets first, with browser decode as a dev fallback.
- `[~]` Instruments page uses the same two-column pattern: left-side instrument navigation, right-side sound preview and instrument detail surface. Native builds use `instrument.renderPreview` for analysis/waveform data and can request compact rendered WAV preview audio for synth/Aether audition.
- `[~]` Patterns page uses the same two-column pattern: left-side pattern navigation, right-side passive segment-style preview, component playback, and an edit handoff into the MIDI or beat editor.
- `[x]` Instrument preview behavior follows engine type at the UI layer: synth/Aether instruments sustain continuously until pause; sample-backed/non-synth instruments play once unless loop is enabled.
- `[~]` Instrument details describe playable behavior rather than source-file stats: engine type, waveform, envelope, filter, sample count, descriptors, loudness, true peak, RMS, preview source, and sampler-associated audio structure are visible. Sampler-associated sample order/grouping can be edited and saved back to instrument metadata; modulation count, plugin fallback status, missing-asset warnings, and deeper velocity/loop editors are still pending.
- `[ ]` Add global asset delete/relink/export flows with predictable project-reference warnings.

Done when:

- Audio files, instruments, patterns, and AI training are manageable as global assets without opening an editor project.
- Preview behavior matches the actual instrument engine instead of pretending every asset is an audio file.

## Priority 4: Live/Export Render Parity

Purpose: make “what I hear” match “what I export.”

Checklist:

- `[x]` Native synth live/export parity stress exists.
- `[x]` Sample-backed instrument live/export parity stress exists.
- `[x]` Mixed synth + sampler + audio-clip live/export parity stress exists.
- `[x]` Effect-owned automation lane live/export parity stress exists.
- `[x]` Route-gain automation has block-size stability stress for 128-sample vs 4096-sample audio-clip-route renders.
- `[x]` Plugin/effect latency model exists as metadata plus a backend estimator, adapter-capability fallback, and route delay compensation stress coverage for plugin-latency placeholders.
- `[x]` Track effects, global mastering EQ, meters, and effect tails are in the native path.
- `[~]` Route automation supports gain, pan, and effect parameters.
- `[~]` Project/segment/note automation are native, but frontend editing surfaces are early.
- `[x]` Add parity tests for looped playback export regions. Native range export length/empty-range coverage, nonzero-start live parity, and review-loop clamp range parity now exist.
- `[ ]` Add parity tests for dense overlapping automation, rapid tempo/speed changes, and high-polyphony Aether patches.
- `[x]` Add sample-rate matrix tests: 44.1k, 48k, 96k.
- `[x]` Add denormal protection and stress tests for long tails near silence.
- `[ ]` Add null-test style comparisons for live/offline paths where deterministic output is expected.
- `[x]` Add master-limiter/headroom policy before playback/export.

Done when:

- Export is not a second engine. It is the same engine driven offline.
- Render differences are either mathematically explained or treated as bugs.

## Priority 5: Mixer, Routing, And Mastering

Purpose: make the DAW feel like a controlled signal-flow environment.

Checklist:

- `[x]` Per-track route buffers exist.
- `[x]` Track gain/pan are applied natively with equal-power pan.
- `[x]` Track meters and master meters exist.
- `[x]` Track effect chains have first native modules: filter, saturation, bitcrush, delay, reverb.
- `[x]` Global Mastering controls the final layer before playback/export through master EQ.
- `[~]` Render timing panel exposes schedule/synth/sample/fx/analyzer/copy cost plus wavetable cache hit/miss/size counters.
- `[x]` Native render timing now separates route effect/plugin-placeholder processing from master FX and sample playback.
- `[~]` Add explicit master chain model: global EQ, neutral input/output gain, optional compressor, final safety limiter, and live master RMS/peak/true-peak/momentary-LUFS diagnostics exist; deeper metering UX, offline integrated-loudness review, and preset migration remain.
- `[~]` Add send/return bus model. Native post-fader sends, project return buses, preallocated return buffers, return effect chains, project persistence, IPC parsing, and backend stress coverage exist; bus UI, latency-reporting polish, and routing UX remain.
- `[~]` Add group tracks and folder routing. Backend `TrackKind::Group`, `parentTrackId`, preallocated group buffers, group effects/sends, stereo-balance group pan, project persistence, IPC parsing, frontend schema support, parent-graph integrity checks, and backend stress coverage exist; group UI, nested-group ordering polish, and full latency reporting remain.
- `[~]` Add per-track freeze/bounce-in-place using `renderTrackToWav`. Backend planner and `project.bounceTrackWav` IPC now validate source/asset IDs, render the selected track to WAV, analyze the rendered stem, preserve the source track muted, create a playable bounced audio track/segment from the stem, and have stress/build coverage. Freeze-style bounces detach the replacement from the source parent group by default to avoid double-processing rendered group FX, while export-style callers can preserve parent routing explicitly. UI wiring, reversible unfreeze metadata, and actual group-track bounce remain pending.
- `[x]` Add plugin-latency compensation slots even before true plugin hosting.
- `[~]` Add peak/RMS/LUFS metering strategy. Offline file/export analysis has integrated LUFS and true peak; live playback now publishes master RMS dBFS, peak dBFS, bounded true-peak dBTP, and preallocated momentary LUFS. Track-level loudness UX and integrated export review remain.

Done when:

- Every audible source passes through one clear route path.
- Track, bus, and master processing are serializable, automatable, and export-identical.

## Priority 6: Aether Synth Core

Purpose: build a serious native synth that belongs inside Beat.

Checklist:

- `[x]` Stable synth parameter contract exists.
- `[x]` Native wavetable data model and oscillator exist.
- `[x]` Wavetable oscillator uses cached frame selection and interpolation.
- `[x]` Basic wavetable factory tables exist.
- `[x]` Aether oscillator A/B, sub, noise, unison, detune, spread, pan, and levels exist.
- `[x]` Cached pan gains reduce avoidable per-sample trig for static pan.
- `[~]` Dynamic modulation routes exist for LFO 1, LFO 2, Env 1, Env 2, velocity, keytrack, and mod wheel sources to oscillator, filter, amp, and unison targets.
- `[~]` Modulation matrix UI exists with target/source selection, but needs deeper semantic cleanup.
- `[~]` Custom frame editor exists with audio import, normalize, evolve helpers, per-frame harmonic-bias controls, editable frame scan anchors, a 16-bin harmonic partial drawing lane, and direct mini-waveform sketching that derives FFT-style partial/frame controls; richer visual semantics and deeper waveform/FFT editing remain.
- `[~]` Extract oscillator, envelope, LFO, modulation, filter, and voice-allocation logic out of `InstrumentVoice`. Native envelope curve shaping, attack/decay loop rendering, LFO shape/routing, dynamic modulation source routing/target offset math, built-in oscillator/polyBLEP, and pure filter math helpers now live in shared native helpers with direct stress coverage; broader modulation orchestration, filter state/drive, and allocation extraction remain.
- `[~]` Add richer envelopes: Env 1 and Env 2 curve shapes now roundtrip through the patch contract, Solid editor, browser preview, native parser, native render shaping, and verifier/stress coverage; Env 1 and Env 2 loop modes now exist across Solid/browser/native/stress, while deeper envelope editing remains.
- `[x]` Add LFO 2+, tempo sync, one-shot mode, smoothing, phase/random controls. LFO 2 now exists as a patch/native/browser modulation source, normalized phase offsets are honored for note retrigger, retrigger/one-shot can be toggled per LFO, synced note divisions now convert from project BPM in browser/native render paths, LFO shape smoothing is implemented for LFO 1/2, and LFO random phase controls are implemented for patch/browser/native paths. Oscillator phase/random-phase controls are implemented separately.
- `[~]` Add macro semantics: named macros, ranges, curves, and visible assignments. Durable macro metadata now supports labels, min/max ranges, response curves, visible assignment summaries, and matching browser/native static-route math; deeper macro assignment UX and per-target range displays remain.
- `[~]` Add wavetable import, morphing, drawing, FFT/resynthesis research lane, and frame normalization rules. Audio-file wavemap import, deterministic frame normalization, seeded non-AI evolution, phase-aware harmonic partial extraction during browser/native resynthesis, per-frame `skew` harmonic-bias editing, per-frame `tilt` spectral-slope editing, per-frame `focus` resonance-band narrowing, per-frame `formant` resonant-band editing, per-frame `notch` harmonic-carve editing, editable frame scan anchors, 16-bin harmonic partial drawing, direct mini-waveform sketching, browser/native `linear` versus `smooth` wavemap interpolation, and wavemap-level `morph` scan shaping now exist; deeper waveform drawing and richer FFT analysis remain.
- `[x]` Add advanced warp modes with bounded CPU cost. Aether now exposes `shape`, `fold`, and `pinch` table-generation modes through Solid controls, browser/worklet preview, native table generation, IPC/persistence, patch parsing, and verifier/stress coverage.
- `[~]` Add oversampling strategy for nonlinear stages. Route saturator/distortion now use bounded 2x midpoint oversampling with block-continuous state and timing counters; Aether nonlinear/warp stages still need their own bounded strategy before exposing heavier modes.
- `[~]` Add proper voice stealing, mono/legato, glide, pitch bend, mod wheel, velocity, keytracking. Filter keytracking, keytrack modulation source routing, mod wheel routing, runtime pitch bend, linked-note glide timing, explicit `maxVoices` caps with native note stealing, mono voice caps, legato voice retune behavior, and initial velocity modulation now exist across patch/browser/native paths; deeper expression UX remains.
- `[x]` Add Aether-specific stress: high polyphony, high unison, dense modulation, rapid parameter edits.

Done when:

- Aether can be edited quickly, sounds consistent between preview/live/export, and has a stable patch schema.
- DSP cost scales predictably with voices, unison, FX, and modulation.

## Priority 7: Sampler And Plugin Import Layer

Purpose: make imported instruments usable without compromising Beat’s native model.

Checklist:

- `[x]` DecentSampler `.dspreset` / `.zip` import baseline exists.
- `[x]` Imported sample zones include key/velocity ranges, root note, gain, pan, tuning, seq position, one-shot, loop metadata, and start/end sample offsets.
- `[x]` Uploaded multi-file instruments default to length-aware hit variants instead of misleading volume lanes.
- `[x]` Sample buffers are deduped during project apply.
- `[x]` Sample-backed instruments render through the same route path as synths and audio clips.
- `[x]` Sample-zone instruments can render from direct zone paths even when top-level sample URL lists are absent.
- `[x]` Sample-zone start/end offsets are honored in native render and browser preview paths.
- `[~]` Plugin library/sidebar and protected plugin modal exist. DecentSampler packages now open in a package-aware wrapper that can show parsed UI skin metadata, structured control hotspots/bindings, sample-zone maps, and create native sampler instruments for MIDI segments; true native DS runtime hosting remains future work.
- `[~]` Aether fallback methodology exists for generic synth-plugin placeholders, but DecentSampler-derived instruments now stay sampler-backed and do not use Aether fallback.
- `[x]` Add explicit plugin adapter capability metadata for instrument/effect/renderer/utility support, realtime/offline availability, fallback mode, and latency, with native repository stress coverage.
- `[ ]` Add multisample/keymap editor UI.
- `[ ]` Add explicit velocity-layer editor UI when we want real volume/dynamic layers instead of hit variants.
- `[ ]` Add sample trimming, loop markers, crossfade loops, root-note detection helpers.
- `[ ]` Add round-robin/choke/exclusive groups.
- `[~]` Add package/copy imported samples into project documents or project asset folders. `.beat` documents now carry a generated asset manifest with bundled/external/plugin policies, external sample/audio assets are copied into a sibling project asset folder on save, and saved paths are rewritten relative to the project file. Missing-file relink UI and copied-asset cleanup/versioning remain.
- `[x]` Define plugin adapter manifest and capability model: synth, effect, renderer, utility.
- `[ ]` Add real plugin-host feasibility pass separately for AU/VST3, including sandboxing and crash isolation.

Done when:

- Imported instruments behave like native Beat instruments in tracks, save/open, live playback, and export.
- Missing plugins or samples degrade predictably instead of breaking the project.

## Priority 8: Automation And Musical Editing

Purpose: let users shape sound over time with DAW-grade precision.

Checklist:

- `[x]` Native note automation can drive per-note pitch and parameter events.
- `[x]` Segment automation and project automation are parsed and emitted.
- `[x]` Route-level automation supports track gain/pan/effect targets.
- `[~]` MIDI “curve to” concept exists, but should generalize beyond pitch.
- `[ ]` Add visible automation lanes in track view.
- `[ ]` Add per-segment automation editor with percent/time anchors.
- `[ ]` Add note-specific modulation timelines for pitch, level, phase, filter, wavetable position, and macros.
- `[~]` Add curve interpolation modes: hold, linear, quadratic, cubic, ease-in, ease-out, and smoothstep are native and control-checkpoint stress-covered; richer exponential/tension editing and stepped-pattern variants remain.
- `[ ]` Add automation capture/write/read modes later.
- `[ ]` Add automation conflict rules: project vs segment vs note vs live knob.

Done when:

- Automation is first-class project data, not hidden modal state.
- Users can see and edit what is changing over time.

## Priority 9: Beat And Instrument Generation

Purpose: keep generation musical, editable, and grounded in DAW state.

Checklist:

- `[x]` Genre-informed drum generation exists.
- `[x]` Complexity has been corrected away from “fill every cell and add instruments.”
- `[~]` Genre rules include rock/pop/rap/trap/drill/breakcore/DnB/house/reggae/funk guidance.
- `[~]` Aether-aware instrument generation exists, but should be measured against the current Aether schema.
- `[ ]` Add generated pattern structure: sections, fills, rests, density maps, ghost notes, accents.
- `[ ]` Add complexity as musical density/variation, not instrument count.
- `[ ]` Add drummer-like constraints: limb independence, backbeat anchors, phrase length, fills into transitions.
- `[ ]` Add generation provenance and editable “why this pattern” metadata.
- `[ ]` Add training/export loops that preserve accepted user edits.
- `[ ]` Add generation tests per genre using explicit expected invariants.

Done when:

- Generated material sounds like a musician’s starting point, not random grid fill.
- Generated data remains ordinary editable DAW data after creation.

## Priority 10: Codebase Organization

Purpose: keep a large app editable as it grows.

Checklist:

- `[x]` Target structure is documented in `docs/project-structure.md`.
- `[~]` New backend domains exist: wavetable, realtime, sampler, effects, analysis, parameters.
- `[~]` Frontend has feature folders, but DAW, Synth, Mixer, Library boundaries are not fully migrated.
- `[ ]` Move sequencer/transport into `Audio/Sequencing` when the next sequencing-heavy change lands.
- `[ ]` Split `AudioEngine` orchestration from render route/effects/sample voice helpers.
- `[ ]` Split `InstrumentVoice` into smaller DSP modules.
- `[ ]` Split giant stores into project, transport, document, library, plugin, analyzer stores.
- `[ ]` Keep IPC schema additive/versioned and remove business logic from bridge code over time.
- `[ ]` Add focused tests near subsystem ownership as modules split.

Done when:

- Agents can work in parallel without constantly touching the same central files.
- The boundaries match how the product is actually reasoned about.

## Research And Math Lane

Purpose: use top-tier DSP/math where it matters, without prematurely academicizing the app.

Topics to evaluate before large rewrites:

- Bandlimited oscillator/wavetable methods: mipmapped tables, minBLEP/polyBLEP, BLIT, oversampling tradeoffs.
- FFT/resynthesis: windowing, phase handling, spectral interpolation, harmonic tracking, frame normalization.
- Time-stretch/pitch-shift: phase vocoder, WSOLA/PSOLA-style approaches, Rubber Band-style integration feasibility.
- Dynamics/mastering: true-peak limiting, oversampled clipping, LUFS/RMS/peak metering.
- Automation smoothing: sample-accurate ramps vs block-rate smoothing, denormal protection, zipper-noise thresholds.
- Scheduling: sample-accurate event queues, tempo maps, loop boundary splitting, latency compensation.

Rule:

- Research becomes code only when tied to a measurable product path: sound quality, CPU budget, latency, determinism, or user workflow.

## Current Execution Queue

1. DAW Core invariants:
   - Add visible fade handles and crossfade commands on top of the split/trim/fade model.
   - Expand selection/drag/resize tests.
   - Clip split/trim/fade model.
2. Document safety:
   - Project asset packaging strategy.
   - Document roundtrip stress.
3. Render parity:
   - Automation-heavy parity stress.
   - Region export once loop/range export UI exists.
4. Aether structure:
   - Split `InstrumentVoice`.
   - Add deeper filter-stage render-slice counters.
   - Design better wavetable/custom-frame workflow.
5. Sampler/plugin:
   - Keymap editor and project asset copying.
   - Round-robin and choke-group editing UX.
   - Plugin adapter manifest.

## Parallel-Agent Guidance

- One agent owns `AudioEngine.*` and `Sequencer.*` at a time.
- One agent owns schema/persistence at a time.
- One agent can work on frontend DAW selection/edit UI if backend sequencing is active.
- One agent can work on Aether UI if synth parameter contracts are not being changed.
- Every backend change needs either an existing stress pass or a new stress case.
- Every file/document change that affects user work must preserve rollback behavior.
