# Lumus Architecture

## Foundation boundary

```text
Beat instrument
  synthPatch.instrumentType
    wavetable-synth       -> Aether identity -> frozen Aether contract
    lumus-hybrid-synth    -> Lumus identity  -> Lumus versioned contract

Lumus v10 adapter
  Lumus patch/namespace
    -> fixed source identities A / B / C
    -> A/B through the frozen Aether renderer
    -> A/B/C own independent sample asset and playback metadata
    -> A/B/C through Lumus-owned wavetable/sample/multisample/granular mode selection
    -> Lumus arpeggiator transforms route MIDI before the shared renderer, with optional pair-preserving swing and key/scale quantization
    -> mutually exclusive Lumus clip mode transforms a held trigger through a bounded 1-32-step relative-note sequence
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

- `frontend/src/state/synthStore.ts`: current type/namespace identity, initial draft factory, stable Slot C modulation target IDs, and the v10 A/B/C source, arpeggiator, and bounded clip schema; later this should delegate Lumus-owned schema work to `frontend/src/state/lumusStore.ts`.
- `frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx`: shared oscillator layout, knobs, and `FloatingSelect` routing control used unchanged by Aether and Lumus.
- `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`: Lumus-only arpeggiator and clip controls composed from Beat's existing section, button, selector, knob, and number-input components.
- `frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx`: explicit Create Lumus entry.
- `frontend/src/features/EditorHost/EditorHost.solid.tsx`: Lumus editor identity and modal lifecycle.
- `backend/Source/Audio/Parameters/ParameterIds.h`: stable native instrument type.
- `backend/Source/Audio/Parameters/SynthPatchContract.cpp`: validated v1 migration and v2 A/B/C contract.
- `backend/Source/Audio/TrackModel.h`: engine identity and Lumus-owned A/B/C sample state retained independently of Aether.
- `backend/Source/Audio/Midi/LumusArpeggiator.h`: fixed-capacity held-note state, deterministic sample-offset note transformation, alternating long/short swing intervals whose pair duration equals two straight steps, and fixed-mask scale quantization before note ordering. It owns no transport clock.
- `backend/Source/Audio/Midi/LumusClipSequencer.h`: fixed-capacity latest-held trigger state and a maximum 32-step monophonic sequence with bounded relative pitch, length, velocity, rests, and pair-preserving swing. It allocates only during preparation and owns no transport clock.
- `backend/Source/Audio/AudioEngine.cpp`: prepares the mutually exclusive transforms off the callback, derives step length from the active sample rate plus Sequencer tempo/speed, and inserts transformed MIDI immediately before the Lumus route synth render.
- `backend/Source/Audio/InstrumentVoice.{h,cpp}`: prepared fixed-capacity A/B/C sample and granular state plus Slot C wavetable state, routing, and bounded modulation evaluation; these branches are unreachable for Aether.
- `backend/Source/Persistence/ProjectRepository.cpp`: persists and strictly reconstructs Lumus engine identity plus the bounded rack, Slot C, sample/granular modes, arpeggiator, clip, source-bus targets, and ordered instrument inserts. Older records without `synthEngine` retain their established Aether inference.

## Effects and routing contract

Each A/B/C source independently selects Shared Filter, Filter 1, Filter 2, Direct, or None. Its two send amounts branch to two explicitly selected Beat return buses before the serial instrument-insert chain. Missing return-bus identifiers are intentionally silent and never fall back to Master. Instrument inserts process the main Lumus route in stored order, before track inserts; bypass and reorder state are persisted. Return buses then process their own stored-order effects before their configured downstream output. Live callback and offline rendering use this same graph and timing order.

The native renderer continues to store the two fixed source-bus identifiers in the shared internal Aether renderer adapter. This is an implementation boundary, not an Aether product identity: the Lumus editor labels the controls as Lumus, Lumus project identity is serialized separately, and no Aether patch or default changes when Lumus routing is edited.

## Non-negotiable compatibility rules

1. Loading, normalizing, saving, or rendering Aether cannot produce Lumus state implicitly.
2. Loading, normalizing, or saving Lumus cannot collapse its type or namespace into Aether.
3. Any future Aether-to-Lumus action is explicit, one-way, and clone-based; it never mutates the source instrument.
4. Unknown Lumus versions and malformed Lumus data fail deterministically before playback preparation.
5. Shared DSP primitives may be reused, but Lumus feature policy and persistence remain behind Lumus-owned interfaces.
