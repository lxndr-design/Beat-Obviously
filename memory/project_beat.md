---
name: project-beat
description: Beat is a beat sequencing DAW the user is building from scratch in /Users/alexcheng/beat. Hybrid architecture chosen after deliberation.
metadata:
  type: project
---

Beat is a from-scratch beat sequencing app being built at `/Users/alexcheng/beat`.

**Architecture (decided 2026-05-23):**
- Backend: JUCE 8 / C++20, CMake, macOS-first (CoreAudio + Metal)
- Frontend: Solid + TypeScript + Vite, served inside JUCE's embedded WKWebView
- IPC: JUCE 8 native message passing (`WebBrowserComponent::evaluateJavascript` + JS→C++ message handlers)
- Persistence: SQLite (via JUCE) on the backend, Dexie/IndexedDB as a frontend cache mirror
- Visualizer: Three.js / WebGL behind a `Visualizer` interface so openFrameworks could plug in later
- AI: stubbed `AiService` interface, no live Anthropic calls in v1

**Scope decisions:**
- macOS only for v1; cross-platform later via JUCE
- Standalone app only, no VST3/AU hosting or plugin builds in v1
- Single .app bundle output (frontend built into JUCE BinaryData)

**Why:** User explicitly chose JUCE/C++ + web UI hybrid over Tauri or pure web because they want a serious DAW-grade audio engine while keeping the CSS-based design system they specified. They want long-term expandable architecture.

**How to apply:** New features should respect the boundary — audio/timing/DSP/MIDI/file IO live in C++, all UI lives in Solid. Cross-cutting changes need both sides updated and the IPC schema (`backend/Source/Ipc/Schema.h` + `frontend/src/ipc/schema.ts`) kept in sync. See also [[feedback-design-system]].

**Current frontend checkpoint (2026-06-18):**
- Beat's frontend has migrated from React to Solid. App entry, shell, Home hub, sidebar, modal/editor hosts, node instrument editor, synth/editor surfaces, MIDI/drum editors, track list/lane/segment surfaces, shared UI kit, and design-system demos are now `.solid.tsx`.
- Removed compatibility folders and bridge-era concepts include `frontend/src/components`, `frontend/src/react-bridge`, feature-local `solid/` subfolders, `mount*Solid` bridge APIs, React demos, React dependencies/plugins, and migration-era `Solid` suffix component/hook names.
- `npm run verify:design-system` guards the current Solid boundary: no React-era package/plugin return, no legacy JSX under `frontend/src`, no migration suffix identifiers, and no removed compatibility namespaces.

**Current implementation checkpoint (2026-05-31):**
- Beat has a working Solid/Vite UI preview and a JUCE standalone build in `build-native`.
- Recent major additions include drum sequencer, MIDI editor improvements, instrument/audio/component libraries, project persistence, sample imports, round-robin grouped sampler imports, local Qwen/Ollama generation hooks, training checkpoint UI, and native app packaging work.
- A new `wavetable` / **Aether WT** instrument type exists in the frontend model and instrument editor. It exposes Bank, WT Pos, Warp, Unison, Spread, and Blend controls.
- Frontend preview playback renders Aether WT through `frontend/src/audio/synthPreview.ts` using band-limited harmonic generation, Hermite frame morphing, basic unison detune, and the existing filter/drive path.
- Decent Sampler direction: `.dspreset` is XML describing sample assets/zones; `.dslibrary` is packaged library form. Beat should import/parse Decent-style sample maps into native Beat sampler instruments, not host Decent Sampler as a plugin.
- The native-engine foundation wires `engine.applyProject`: the Solid frontend sends the current project model to JUCE, and `backend/Source/Ipc/MessageBridge.cpp` parses frontend project JSON into native `Project`, `Track`, `Segment`, MIDI notes, transpose, time signature, and EQ automation.
- `TopBar` sends `engine.applyProject` before native play/restart so standalone transport has a real project snapshot.
- Verified after that fix: frontend typecheck passed, frontend production build passed, native build passed with `cmake --build build-native --config Release`, and browser play toggled without console errors.
- Follow-up native stabilization: backend now parses drum payloads into native triggerable note events, native sequencer supports `SegmentPayloadKind::Drum`, note-off timing no longer hardcodes 120 BPM, note-offs are queued across audio blocks, and native pause/stop clears active notes.
- Native sampler foundation: `engine.applyProject` now sends instrument definitions from the Solid frontend to JUCE; backend stores instrument sample URLs, resolves bundled `/samples/...` paths inside the app resources, preloads sample buffers, carries instrument IDs through trigger events, and plays sample instruments through a simple native round-robin sample voice path before falling back to the synth voice.
- Native per-instrument synth foundation: JUCE now parses frontend instrument knobs/envelopes/waveform/Aether WT settings, builds separate synth voice pools per instrument ID, and routes timeline/drum MIDI events to the matching native synth when no sampler voice is used. Aether WT now has a first native oscillator path with band-limited harmonic frames, Hermite morphing, and unison detune.
- Verification after that change: native Release build passed, frontend `tsc -b --noEmit` passed, production Vite build passed, browser preview loaded with no console errors, main play/pause toggled, instrument preview play/pause toggled, and the Aether WT editor path/control block was reachable.
- Decent Sampler import foundation: the native app can choose a `.dspreset`, parse its XML `<sample>` entries, resolve relative sample paths, save valid referenced audio files to the audio database, and return a Beat sampler instrument payload. The import modal now exposes `Import Decent` next to `Add WAVs` and creates a source-preserving sampler instrument from the preset samples.
- Verification after Decent import wiring: native Release build passed, frontend typecheck/build passed, and the browser import modal exposed both `Add WAVs` and `Import Decent` with no console errors.
- Preview pitch correction: synth-style sidebar/editor previews now use a neutral C4 baseline instead of A2/sub-octave auditioning; both paths share `previewFrequency()` in `frontend/src/audio/synthPreview.ts`.
- Sampler zone foundation: Decent sample metadata is retained on imported instruments as `sampleMap`; frontend preview and native JUCE playback can select samples by note zone, use root note/tuning for playback rate, and use per-zone volume. Native sample path resolution now only remaps bundled `/samples/...` assets, leaving absolute imported file paths intact.
- Aether WT editor/preview foundation: frontend model now has an `aether` oscillator stack with Osc A, Osc B, Sub, and Noise modules. The instrument editor exposes those as separate Aether Engines, and the WebAudio preview mixes the enabled modules with per-oscillator wavetable bank/position/warp/tuning/level controls.
- Verification after Aether Engines work: frontend typecheck passed, native build had no work/errors, frontend production build passed, browser editor showed Aether Engines with Osc A/Osc B/Sub/Noise/Aether Global, waveform preview play/stop worked, and console errors were empty.
- Native Aether Engines sync: JUCE `InstrumentDefinition` and `InstrumentVoice::Params` now carry the Aether Osc A/Osc B/Sub/Noise stack. `MessageBridge` parses the frontend `aether` object, `AudioEngine` maps it into per-instrument synth voices, and native wavetable rendering can mix the same module stack instead of only the legacy single wavetable oscillator.
- Verification after native Aether sync: native Release build passed, frontend typecheck/build passed, browser Aether WT editor still showed Aether Engines with Osc A/Osc B/Sub/Noise, waveform preview play/stop worked, and browser console errors were empty.
- Aether stability/LFO pass: the confusing Unison control is now labeled Voices, capped at 8 voices across UI, frontend preview, saved/imported configs, and native parsing/rendering. Aether Global wavetable changes now apply to Osc A and Osc B. LFO pitch, LFO filter, and envelope-to-filter modulation now affect both frontend waveform/live preview and native JUCE playback.
- Verification after Aether stability/LFO pass: native Release build passed, frontend `tsc -b --noEmit` passed, production Vite build passed after using the Homebrew Node path, browser Aether editor survived dragging Voices to 3 and LFO Depth/Pitch/Filter controls, waveform preview play/stop worked, and browser console errors were empty.
- Aether oscillator shape fix: the visible Oscillator shape row now controls Aether source mode. `Wavetable` uses Osc A/Osc B wavetable banks; sine/saw/square/triangle/noise now render as Aether oscillator source shapes in both frontend preview and native JUCE playback.
- Aether UI/performance pass: New Instrument now has a sticky top row with waveform preview and name/type details split half-width, Generate moved into the modal ribbon as a compact input/action, generic Oscillator controls are hidden for Aether, and Osc A/Osc B now have independent waveform pickers. Aether Osc A/B use 5-column knob grids, Aether Global uses 6, compact Sub/Noise blocks use 3, and off modules dim their controls. Preview/native Aether rendering also got cheaper caps/caches: 32-harmonic wavetable limit, no per-sample Aether oscillator array allocation, cheaper native per-voice noise, and less frequent native filter cutoff updates.
- Verification after Aether UI/performance pass: frontend `tsc -b --noEmit` passed, native Release build passed, production Vite build passed, browser New Instrument/Aether layout showed the split sticky row and ribbon Generate, Osc A waveform switching worked, waveform preview play/stop worked, and browser console errors were empty.

**Outstanding implementation order:**
1. Stabilize current Beat core: playback responsiveness, editor-local undo/copy/paste/delete, drum/MIDI/audio/component/timeline QA.
2. Move instrument audio to native/JUCE: native sampler playback, round-robin samples, per-instrument params, native Aether WT rendering, native drums.
3. Aether WT v1: improve wavetable banks/frames, add proper stereo spread/pan, wavetable visualization, and performance profiling.
4. Sampler v1: continue improving parsed `.dspreset` metadata playback (velocity layers, sequence position groups, pan, release/loop modes), then support `.dslibrary`.
5. Instrument editor UI upgrade around Synth, Aether WT, Sampler, Hybrid with dense but Beat-native controls.
6. Modulation system: matrix, assignable LFOs, drawable MSEG envelopes, macros that affect playback.
7. AI generation: less formulaic beat generation, MIDI/song generation UI, richer instrument metadata, feedback/rating training every 20 signals.
8. Persistence/project format: save instruments, samples, components, loops, AI feedback, sampler maps; version migrations.
9. Standalone app polish: packaging, app chrome, app/dock icon, native file menu.
10. Performance/QA: playback regression tests, sample import tests, hotkey tests, native audio stress tests, CPU/block timing.
