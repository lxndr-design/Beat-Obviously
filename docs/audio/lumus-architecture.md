# Lumus Architecture

## Foundation boundary

```text
Beat instrument
  synthPatch.instrumentType
    wavetable-synth       -> Aether identity -> frozen Aether contract
    lumus-hybrid-synth    -> Lumus identity  -> Lumus versioned contract

Lumus v8 adapter
  Lumus patch/namespace
    -> fixed source identities A / B / C
    -> A/B through the frozen Aether renderer
    -> A/B/C own independent sample asset and playback metadata
    -> A/B/C through Lumus-owned wavetable/sample/multisample/granular mode selection
    -> Lumus arpeggiator transforms route MIDI before the shared renderer, with optional pair-preserving swing
    -> A/B/C own independent bounded granular state and assets
    -> identical initial output while C is disabled

Current Lumus renderer
  three fixed source slots
    -> source-mode interface
    -> per-source routing and sends
    -> shared modulation policy
    -> filters / FX busses / main / direct
```

The adapter is an intentional bootstrap boundary. It lets Lumus start audible and fully measured while Aether remains the regression oracle. New Lumus-only fields must not be added under `aether.*`, and new source behavior must not be switched on by an Aether default or migration.

## Ownership

- `frontend/src/state/synthStore.ts`: current type/namespace identity, initial draft factory, stable Slot C modulation target IDs, and the v8 A/B/C source plus arpeggiator/swing schema; later this should delegate Lumus-owned schema work to `frontend/src/state/lumusStore.ts`.
- `frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx`: shared oscillator layout, knobs, and `FloatingSelect` routing control used unchanged by Aether and Lumus.
- `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`: Lumus-only arpeggiator controls composed from Beat's existing section, button, toggle, knob, and number-input components.
- `frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx`: explicit Create Lumus entry.
- `frontend/src/features/EditorHost/EditorHost.solid.tsx`: Lumus editor identity and modal lifecycle.
- `backend/Source/Audio/Parameters/ParameterIds.h`: stable native instrument type.
- `backend/Source/Audio/Parameters/SynthPatchContract.cpp`: validated v1 migration and v2 A/B/C contract.
- `backend/Source/Audio/TrackModel.h`: engine identity and Lumus-owned A/B/C sample state retained independently of Aether.
- `backend/Source/Audio/Midi/LumusArpeggiator.h`: fixed-capacity held-note state, deterministic sample-offset note transformation, and alternating long/short swing intervals whose pair duration equals two straight steps. It owns no transport clock.
- `backend/Source/Audio/AudioEngine.cpp`: prepares the transform off the callback, derives step length from the active sample rate plus Sequencer tempo/speed, and inserts transformed MIDI immediately before the Lumus route synth render.
- `backend/Source/Audio/InstrumentVoice.{h,cpp}`: prepared fixed-capacity A/B/C sample and granular state plus Slot C wavetable state, routing, and bounded modulation evaluation; these branches are unreachable for Aether.

## Non-negotiable compatibility rules

1. Loading, normalizing, saving, or rendering Aether cannot produce Lumus state implicitly.
2. Loading, normalizing, or saving Lumus cannot collapse its type or namespace into Aether.
3. Any future Aether-to-Lumus action is explicit, one-way, and clone-based; it never mutates the source instrument.
4. Unknown Lumus versions and malformed Lumus data fail deterministically before playback preparation.
5. Shared DSP primitives may be reused, but Lumus feature policy and persistence remain behind Lumus-owned interfaces.
