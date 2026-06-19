# Project Structure Plan

This app is expected to grow into a DAW plus a serious in-app synth. The folder structure should make large features easy to edit without turning central files into catch-all modules.

## Principles

- Organize by product/domain ownership first, not file type.
- Keep reusable UI primitives separate from feature-specific UI.
- Keep real-time audio code isolated from IPC, persistence, and editor state.
- Add new work into the target structure first, then migrate existing code incrementally.
- Avoid large mechanical moves while another agent is actively editing nearby files.
- Every major subsystem should have a narrow public interface and local tests where possible.

## Backend Target Structure

```text
backend/
  Source/
    Audio/
      Engine/
        AudioEngine.h
        AudioEngine.cpp
        AudioRenderContext.h
        RealtimeSafety.h
      Sequencing/
        Sequencer.h
        Sequencer.cpp
        TransportState.h
        MidiEventScheduler.h
      Instruments/
        Synth/
          SynthVoice.h
          SynthVoice.cpp
          SynthVoiceState.h
          SynthParameters.h
        Sampler/
          SampleVoice.h
          SampleVoice.cpp
          SampleZone.h
      Wavetable/
        Wavetable.h
        Wavetable.cpp
        WavetableOscillator.h
        WavetableOscillator.cpp
        WavetableFactory.h
        WavetableFactory.cpp
      Modulation/
        ModulationSource.h
        ModulationTarget.h
        ModulationMatrix.h
        ModulationMatrix.cpp
        Envelope.h
        Envelope.cpp
        Lfo.h
        Lfo.cpp
      Effects/
        MasterEq.h
        MasterEq.cpp
        EffectChain.h
        EffectChain.cpp
        Distortion.h
        Delay.h
        Reverb.h
      Analysis/
        FftAnalyzer.h
        FftAnalyzer.cpp
        LevelMeter.h
      Parameters/
        ParameterIds.h
        ParameterSmoothing.h
        ParameterValue.h
      Realtime/
        LockFreeQueue.h
        AudioMemoryPool.h
        CpuTiming.h
    Ipc/
      MessageBridge.h
      MessageBridge.cpp
      Schema.h
      AudioEvents.h
      SynthEvents.h
    Persistence/
      ProjectSerializer.h
      ProjectSerializer.cpp
      PatchSerializer.h
      PatchSerializer.cpp
      Migration.h
    Model/
      Project.h
      Track.h
      Clip.h
      Patch.h
```

### Backend Ownership Notes

- `Audio/Engine` owns device callbacks, render orchestration, and real-time boundaries.
- `Audio/Sequencing` owns transport, timeline position, loop state, and MIDI/event scheduling.
- `Audio/Instruments` owns playable instruments, but not global engine orchestration.
- `Audio/Wavetable` owns table data and oscillator DSP.
- `Audio/Modulation` owns source evaluation and target routing.
- `Audio/Effects` owns audio processors that can be used by tracks, instruments, or master output.
- `Audio/Analysis` owns FFT, meters, and non-mutating measurement.
- `Audio/Parameters` owns stable parameter IDs, smoothing, normalization, and bounds.
- `Audio/Realtime` owns reusable real-time-safe infrastructure.
- `Ipc` should translate requests/events only. It should not contain synth business logic.
- `Persistence` should serialize/deserialize versioned project and patch state.
- `Model` should hold plain data structures used by persistence, IPC, and audio snapshots.

## Frontend Current Structure

```text
frontend/src/
  App.solid.tsx
  main.solid.tsx
  audio/
    TimelineMidiPlayback.solid.tsx
    audioImport.ts
    synthPreview.ts
    timelineAudio.ts
    analyzerClient.ts
    transportActions.ts
  solid-ui/
    ActionFooter/
    AppDialog/
    Button/
    Block/
    ContextMenu/
    DitheredImage/
    FloatingSelect/
    HoverInfo/
    Icon/
    Knob/
    Modal/
    NumberInput/
    RowItem/
    SectionRibbon/
    Tag/
    TextInput/
    Toggle/
    ...
  design/
    README.md
    SolidUiKitCatalog.solid.tsx
    tokens.css
    layout.css
    surfaces.css
    forms.css
    typography.css
  features/
    EditorHost/
    Tracks/
    TopBar/
    Sidebar/
    HomeHub/
    InstrumentLibrary/
    AudioFiles/
    ComponentLibrary/
    PluginLibrary/
    NodeInstrumentEditor/
    DrumEditor/
    MidiEditor/
    SegmentEditor/
    TrackDetails/
    TrackEffects/
    Eq/
    EqAutomation/
    Synth/
      SynthEditor/
      OscillatorPanel/
      AnalyzerPanel/
      ModulationMatrix/
    Preferences/
    ProjectHealth/
    Startup/
    Training/
    Transport/
    Visualizer/
  hotkeys/
    hotkeys.ts
    contextualHotkeys.ts
  ipc/
    schema.ts
    bridge.ts
  persistence/
    beatDocument.ts
    documentActions.ts
    dexie.ts
  solid-utils/
    contextualHotkeys.solid.ts
    store.ts
  state/
    store.ts
    types.ts
    synthStore.ts
    analyzerStore.ts
```

### Frontend Ownership Notes

- `solid-ui` contains reusable UI primitives only. It should not know about tracks, synths, clips, or transport.
- `App.solid.tsx` owns the current app shell, hydration, native event wiring, startup readiness, and global hosts.
- `features/Tracks`, `features/TopBar`, `features/Sidebar`, and `features/EditorHost` own arrangement, timeline, tracks, transport surface, rail content, and modal/editor dispatch.
- `features/Synth` owns sound-design UI.
- `features/TrackEffects`, `features/Eq`, and `features/EqAutomation` own mixing, effects, EQ, meters, and automation surfaces.
- `features/InstrumentLibrary`, `features/AudioFiles`, `features/ComponentLibrary`, `features/PluginLibrary`, and `features/HomeHub` own browsing/importing assets and instruments.
- `ipc` owns native bridge schemas and event translation.
- `state` owns app-wide stores. Feature-local state should stay inside the feature unless shared globally.
- `audio` owns browser/native audio helper code, not UI components.

## Migration Plan

### Phase 1: Contracts First

- Add `docs/synth-parameter-contract.md`.
- Define stable parameter IDs.
- Define modulation source/target IDs.
- Define patch schema version.
- Define analyzer event shape.

This gives backend and frontend agents a shared target without moving many files.

### Phase 2: Add New Subsystems In Final Homes

New backend work should start in:

- `backend/Source/Audio/Wavetable`
- `backend/Source/Audio/Modulation`
- `backend/Source/Audio/Parameters`
- `backend/Source/Audio/Realtime`

New frontend synth work should start in:

- `frontend/src/features/Synth`
- `frontend/src/state/synthStore.ts`
- `frontend/src/state/analyzerStore.ts`

### Phase 3: Gradual Existing-Code Migration

Move existing files only when there is a functional reason:

- Move `Sequencer.*` when transport/sequencing changes are already being touched.
- Move `InstrumentVoice.*` when voice architecture is being upgraded.
- Move `FftAnalyzer.*` when analyzer IPC/UI integration begins.
- Keep transport UI in the current Solid feature folders unless a functional change justifies a focused extraction.

### Phase 4: Enforce Boundaries

Once folders settle:

- Keep `AudioEngine` as orchestration only.
- Keep `InstrumentVoice` small by pushing oscillator, envelope, LFO, and modulation logic into dedicated classes.
- Keep IPC additive and schema-driven.
- Keep UI panels dumb where possible; stores/selectors should mediate backend state.
- Add tests near each subsystem or in `backend/Tests` with names matching subsystem ownership.

## Suggested Agent Split

### Agent 1: Backend DSP And Real-Time

Owns:

- `backend/Source/Audio/Engine`
- `backend/Source/Audio/Wavetable`
- `backend/Source/Audio/Modulation`
- `backend/Source/Audio/Parameters`
- `backend/Source/Audio/Realtime`
- `backend/Tests`

Avoids:

- large frontend UI changes
- patch schema changes without coordination

### Agent 2: Frontend Synth UX And State

Owns:

- `frontend/src/features/Synth`
- `frontend/src/features/TrackEffects`
- `frontend/src/features/Eq`
- `frontend/src/features/EqAutomation`
- `frontend/src/state`
- `frontend/src/ipc`
- `frontend/src/audio/analyzerClient.ts`

Avoids:

- audio callback logic
- wavetable DSP implementation

### Shared Integration Zone

Coordinate before changing:

- `backend/Source/Audio/AudioEngine.*`
- `backend/Source/Ipc/Schema.h`
- `backend/Source/Ipc/MessageBridge.cpp`
- `frontend/src/ipc/schema.ts`
- project or patch persistence schemas
- central app shell files

## Immediate Recommendation

Do not mass-move the existing app today. Create the target folders as needed while building the next subsystem. The first practical step is:

1. Add the synth parameter contract.
2. Add `backend/Source/Audio/Wavetable`.
3. Add `backend/Source/Audio/Parameters`.
4. Build the wavetable oscillator there.
5. Only then wire it into the existing voice/engine.

That keeps the app cohesive without creating a giant refactor cliff.
