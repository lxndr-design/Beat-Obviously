# Lumen Architecture

## Foundation boundary

```text
Beat instrument
  synthPatch.instrumentType
    wavetable-synth       -> Aether identity -> frozen Aether contract
    lumen-hybrid-synth    -> Lumen identity  -> versioned Lumen contract

Lumen v16 adapter
  canonical Lumen patch/namespace
    -> fixed source identities A / B / C
    -> A/B through the frozen Aether renderer
    -> Lumen-only prepared harmonic-domain wavetable warps generate immutable cached tables; Aether and v1-v14 migrations remain on the legacy modes
    -> A/B/C own independent sample asset and playback metadata
    -> Sample mode adds bounded direction/rate, forward or ping-pong loop traversal, a 1-2000 ms release tail, and up to 16 stable-ID manual slices per slot; Multisample retains its established neutral policy
    -> A/B/C through Lumen-owned wavetable/sample/multisample/granular mode selection
    -> Lumen arpeggiator transforms route MIDI before the shared renderer, with optional pair-preserving swing and key/scale quantization
    -> Lumen-only per-LFO rate keytracking is evaluated once per voice block around C4; zero preserves the prior rate exactly
    -> mutually exclusive Lumen clip mode transforms a held trigger through a bounded 1-32-step, 64-note relative polyphonic sequence
    -> A/B/C own independent bounded granular state and assets
    -> identical initial output while C is disabled

Current Lumen renderer
  three fixed source slots
    -> one prepared Lumen kernel selected at block scope, retaining the scalar oscillator state machine
    -> fixed-capacity active sample/granular source indices and route-lane mask
    -> native-SIMD prepared-lane accumulation only at full 16-voice wavetable unison; exact scalar fallback below 16
    -> source-mode interface
    -> per-source routing and sends
    -> shared modulation policy
    -> filters / FX busses / main / direct
```

The adapter is an intentional bootstrap boundary. It lets Lumen start audible and fully measured while Aether remains the regression oracle. New documents use the canonical `lumen-hybrid-synth` type, `lumen` namespace, `lumen.*` parameter IDs, and `lumen` native project object. A read-only compatibility adapter accepts the former Lumus spellings and canonicalizes them in memory before validation; new saves never emit those deprecated keys. New Lumen-only fields must not be added under `aether.*`, and new source behavior must not be switched on by an Aether default or migration.

Two persisted library identifiers deliberately retain their former string values: the `lumus-test` set ID and `factory.lumus-*` instrument record IDs. They are opaque foreign keys referenced by existing project libraries, not engine/type/parameter identities. Renaming them in place would orphan those references; their code symbols and all visible labels are Lumen.

## Ownership

- `frontend/src/state/synthStore.ts`: current type/namespace identity, initial draft factory, stable Slot C modulation target IDs, the v15 A/B/C prepared spectral-warp contract, and the v16 per-LFO rate-keytracking contract; later this should delegate Lumen-owned schema work to `frontend/src/state/lumenStore.ts`.
- `frontend/src/features/Synth/lumenClipPianoRoll.ts`: pure conversion between Lumen relative clip notes and the shared MIDI-note editor model; it bounds clips to 32 steps, 64 notes, and -48 through +48 semitones.
- `frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx`: shared oscillator layout, knobs, and `FloatingSelect` routing control used unchanged by Aether and Lumen.
- `frontend/src/features/Synth/SynthEditor/SynthEditor.solid.tsx`: Lumen-only Sample direction/rate/loop/release-tail and bounded slice selection/direct-bound editing, plus arpeggiator and clip controls composed from Beat's existing section, button, selector, knob, and number-input components.
- `frontend/src/features/Synth/OscillatorPanel/OscillatorPanel.solid.tsx`: per-slot audio-library wavemap resynthesis with Full, Transient, Sustain, and bounded Manual selection; generated wavemaps enter the existing editable frame and analysis workflow.
- `frontend/src/features/InstrumentLibrary/InstrumentLibraryPanel.solid.tsx`: explicit Create Lumen entry.
- `frontend/src/features/EditorHost/EditorHost.solid.tsx`: Lumen editor identity and modal lifecycle.
- `backend/Source/Audio/Parameters/ParameterIds.h`: stable native instrument type.
- `backend/Source/Audio/Parameters/SynthPatchContract.cpp`: validated v1-v16 migration boundary and current A/B/C contract, including strict slice IDs/ranges, Sample-only selection, the Lumen-only spectral-warp gate, and v16 LFO-rate keytracking.
- `backend/Source/Audio/Wavetable/WavetableFactory.cpp`: independently designed harmonic-domain deformation during immutable mipmapped table preparation; playback reuses the existing bounded `WavetableVoiceCache`.
- `backend/Source/Audio/TrackModel.h`: engine identity and Lumen-owned A/B/C sample state retained independently of Aether.
- `backend/Source/Audio/Midi/LumenArpeggiator.h`: fixed-capacity held-note state, deterministic sample-offset note transformation, alternating long/short swing intervals whose pair duration equals two straight steps, and fixed-mask scale quantization before note ordering. It owns no transport clock.
- `backend/Source/Audio/Midi/LumenClipSequencer.h`: fixed-capacity latest-held trigger state and a maximum 32-step, 64-note polyphonic sequence with bounded relative pitch, length, velocity, chords, rests, and pair-preserving swing. Active notes have independent exact note-offs; same-pitch/channel retriggers retire the older active entry first. It allocates only during preparation and owns no transport clock.
- `backend/Source/Audio/AudioEngine.cpp`: prepares the mutually exclusive transforms off the callback, derives step length from the active sample rate plus Sequencer tempo/speed, and inserts transformed MIDI immediately before the Lumen route synth render.
- `backend/Source/Audio/InstrumentVoice.{h,cpp}`: block-scope selection of independently compiled Legacy, Aether, Lumen, and Aurum kernels; a prepared four-lane routing mask; compact active Lumen sample/granular indices; fixed-capacity A/B/C source state; bounded modulation evaluation; and one block-scope LFO-rate keytracking calculation per active LFO. The Lumen specialization enables a native-SIMD accumulation path only for full 16-voice wavetable unison; smaller widths and all Aether rendering retain the exact scalar path. Lumen-only sample and LFO-keytracking controls remain forced to the established neutral policy on Aether paths.
- `backend/Source/Persistence/ProjectRepository.cpp`: persists and strictly reconstructs Lumen engine identity plus the bounded rack, Slot C, prepared warp mode, sample playback/slices and granular modes, arpeggiator, clip, per-LFO keytracked rates, source-bus targets, and ordered instrument inserts. Older records without `synthEngine` retain their established Aether inference; v11 migrates to forward/1x Sample playback, v12 migrates to forward loops with the existing 4 ms anti-click tail, v13 migrates to empty unselected slice lists, v14 remains on the established four-mode warp contract, and v1-v15 receive zero LFO-rate keytracking.

## Effects and routing contract

Each A/B/C source independently selects Shared Filter, Filter 1, Filter 2, Direct, or None. Its two send amounts branch to two explicitly selected Beat return buses before the serial instrument-insert chain. Missing return-bus identifiers are intentionally silent and never fall back to Master. Instrument inserts process the main Lumen route in stored order, before track inserts; bypass and reorder state are persisted. Return buses then process their own stored-order effects before their configured downstream output. Live callback and offline rendering use this same graph and timing order.

The native renderer continues to store the two fixed source-bus identifiers in the shared internal Aether renderer adapter. This is an implementation boundary, not an Aether product identity: the Lumen editor labels the controls as Lumen, Lumen project identity is serialized separately, and no Aether patch or default changes when Lumen routing is edited.

## Non-negotiable compatibility rules

1. Loading, normalizing, saving, or rendering Aether cannot produce Lumen state implicitly.
2. Loading, normalizing, or saving Lumen cannot collapse its type or namespace into Aether.
3. Any future Aether-to-Lumen action is explicit, one-way, and clone-based; it never mutates the source instrument.
4. Unknown Lumen versions and malformed Lumen data fail deterministically before playback preparation.
5. Shared DSP primitives may be reused, but Lumen feature policy and persistence remain behind Lumen-owned interfaces.
6. Pre-Lumen Lumus documents are accepted only at read boundaries and must normalize to canonical Lumen before editing, rendering, or the next save.
