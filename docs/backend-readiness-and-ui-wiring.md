# Backend Readiness and UI Wiring

This note tracks backend capabilities that are ready for DAW UI wiring. It is intentionally focused on contracts, IPC, state, and expected interactions; it does not prescribe final visual design.

## Transport and Playback

- Backend surface: `transport.play`, `transport.pause`, `transport.stop`, `transport.seek`, `transport.setSpeed`, `transport.setLoop`, `transport.clearLoop`.
- Frontend state: transport store mirrors playback, position, loop range, and speed.
- Inbound events: position/playback updates should drive timeline cursor, play-state buttons, loop selection, and time readouts.
- UI interactions: transport buttons, timeline click/drag seek, loop-region handles, speed control, and stop-to-start behavior.

## Project Files

- Backend surface: `project.save`, `project.saveFile`, `project.openFile`, `project.new`, `project.recentList`, backup, relink, cleanup, and validation actions.
- Frontend state: document actions own dirty state, current path, recent files, and recovered project payloads.
- UI interactions: app menu Save, right-click Save/Save As menu, Open, Recent Files, recovery prompts, missing-asset relink, and project integrity actions.
- Backend-ready note: file operations should stay routed through native project IPC in packaged/native mode, with browser fallback kept development-only.

## Export and Bounce

- Backend surface: synchronous and async project export, export status, cancel, and track bounce planning/rendering.
- Inbound events: export job progress/status can drive progress bars and cancellation affordances.
- UI interactions: Export dialog, Export Selected Track, Bounce Track to Audio, cancel button, completion reveal, and failure retry.
- Backend-ready note: async job progress exists; the UI should avoid blocking modal-only export flows once progress is surfaced.

## Track Meters

- Backend surface: `engine.levelMeters`.
- Meter payload: aggregate `rms`/`peak`, stereo `leftRms`/`rightRms`/`leftPeak`/`rightPeak`, plus db/true-peak/LUFS fields where available.
- Frontend state: analyzer store persists aggregate and stereo meter fields.
- UI interactions: track-header dual meter bars should read `leftPeak` and `rightPeak`, falling back to aggregate `peak` only when native fields are absent. Inspector/analyzer panels can use rms/db/LUFS fields.
- Backend-ready note: native and local browser preview paths now emit the stereo fields.

## Audio Files and Waveforms

- Backend surface: `audio.import`, `audio.importMany`, `audio.list`, `audio.delete`, `audio.reveal`, and waveform analysis.
- Frontend state: audio file library and timeline audio clips should share imported asset ids.
- UI interactions: audio pane import, drag audio file to track, waveform display, delete/reveal context menu, missing-file relink, and preview.

## Audio Devices and Preferences

- Backend surface: `audio.listDevices`, `audio.selectInputDevice`, input monitoring toggles, and device status events.
- Frontend state: preferences should keep selected input/output ids, sample rate, buffer size, and latency display separate from recording defaults.
- UI interactions: Preferences Audio tab dropdowns for actual devices, sample-rate dropdown, buffer-size dropdown, latency readout, input monitoring default, and arm defaults.
- Backend-ready note: output-device selection should remain a separate UI affordance even where the current host only exposes default output.

## Recording

- Backend surface: recording plan, prepare, start, stop, cancel, status, write WAV, and commit take.
- Frontend state: armed tracks, monitoring state, planned destination, capture status, and take metadata.
- UI interactions: track arm, input monitor, count-in, record transport button, stop-to-commit prompt, cancel take, and waveform insertion into the timeline.
- Backend-ready note: recording should write through native capture and asset registration rather than synthesizing browser-only clips.

## Instrument Preview

- Backend surface: `instrument.renderPreview`.
- Frontend state: instrument rows can request previews and cache preview output by instrument id/version.
- UI interactions: instrument row preview button, drag-to-track, waveform thumbnail, and audition on hover or explicit play.

## DecentSampler

- Backend surface: `instrument.importDecent` parses DS packages, registers samples, maps controls/zones, and creates sampler-backed instruments.
- Frontend state: DS rail lists installed DS packages; dragging a DS package creates a new Instanced Instrument; dragging an instanced instrument reuses the linked instance.
- UI interactions: Import DS File modal, DS rail package list, drag DS to track, Instanced Instruments section, right-click Edit DS Instrument, and DS editor host for package-specific UI.
- Backend-ready note: DS-created instruments must play through DS/sample mappings, not the generic synth editor. UI should treat editor kind as package metadata, not a generic plugin import kind.

## Track Effects and Plugin Host

- Backend surface: track effect defaults, route effects, latency estimation, and placeholder plugin host metadata.
- Frontend state: effect rows and plugin panels should keep effect ids stable for automation and latency display.
- UI interactions: add/remove/reorder effect rows, bypass, parameter edit, plugin open, plugin latency badge, and automation lane binding.

## Training and Generators

- Backend surface: `training.run` and training status events.
- Frontend state: generator requests should preserve seed, mode, target length, and generated artifact type.
- UI interactions: choose instrument, beat loop, melody, bassline, or chord progression; generate one loop/chorus/main idea; regenerate with seed variation; drag result to timeline.
- Backend-ready note: generator UX should combine model calls with deterministic music rules and presets so outputs vary without relying on one monolithic example.

## Diagnostics and Benchmarks

- Backend checks: `BeatBackendStress` covers realtime, wavetable, synth contract, voice, analysis, sequencer, persistence, engine, sample/export, DecentSampler, audio clips/master/routing, and dense churn paths.
- Frontend checks: DAW interaction verifier and dense MIDI benchmark scripts exercise local browser state and high-density MIDI creation.
- UI interactions: developer diagnostics panel can expose benchmark presets, recent stress result, render timing, and dense project generation.

## UI Follow-Up List

- Replace aggregate-only track meters with stereo bars using `leftPeak` and `rightPeak`.
- Surface async export progress and cancel affordances.
- Wire the full recording prepare/start/stop/commit take flow.
- Add Bounce Track to Audio and Export Selected Track context actions.
- Expose project repair, relink, and cleanup from File/Project UI.
- Keep DS import visually simple: choose file plus import action, with DS-specific details in the package list/editor.
