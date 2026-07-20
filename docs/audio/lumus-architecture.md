# Lumus Architecture

## Foundation boundary

```text
Beat instrument
  synthPatch.instrumentType
    wavetable-synth       -> Aether identity -> frozen Aether contract
    lumus-hybrid-synth    -> Lumus identity  -> Lumus versioned contract

Lumus v1 adapter
  Lumus patch/namespace
    -> validated shared foundational parameters
    -> existing prepared Aether renderer
    -> identical initial output

Future Lumus renderer
  three fixed source slots
    -> source-mode interface
    -> per-source routing and sends
    -> shared modulation policy
    -> filters / FX busses / main / direct
```

The adapter is an intentional bootstrap boundary. It lets Lumus start audible and fully measured while Aether remains the regression oracle. New Lumus-only fields must not be added under `aether.*`, and new source behavior must not be switched on by an Aether default or migration.

## Ownership

- `frontend/src/state/synthStore.ts`: current type/namespace identity and initial draft factory; later this should delegate Lumus-owned schema work to `frontend/src/state/lumusStore.ts`.
- `frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx`: explicit Create Lumus entry.
- `frontend/src/features/EditorHost/EditorHost.solid.tsx`: Lumus editor identity and modal lifecycle.
- `backend/Source/Audio/Parameters/ParameterIds.h`: stable native instrument type.
- `backend/Source/Audio/Parameters/SynthPatchContract.cpp`: validated v1 adapter into the existing renderer.
- `backend/Source/Audio/TrackModel.h`: engine identity retained independently of the shared foundational DSP state.

## Non-negotiable compatibility rules

1. Loading, normalizing, saving, or rendering Aether cannot produce Lumus state implicitly.
2. Loading, normalizing, or saving Lumus cannot collapse its type or namespace into Aether.
3. Any future Aether-to-Lumus action is explicit, one-way, and clone-based; it never mutates the source instrument.
4. Unknown Lumus versions and malformed Lumus data fail deterministically before playback preparation.
5. Shared DSP primitives may be reused, but Lumus feature policy and persistence remain behind Lumus-owned interfaces.
