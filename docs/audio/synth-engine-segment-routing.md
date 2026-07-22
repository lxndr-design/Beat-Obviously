# Beat synth-engine segment routing

Beat exposes Aether, Aurum, and Lumus as independent instrument engines. They share the track, segment, project, and editor-host infrastructure, but each engine retains its own instrument state and render dispatch.

## Creation paths

The track-lane context menu provides three explicit actions:

- `Create Aether Segment` creates a MIDI segment backed by a new Aether instrument.
- `Create Aurum Segment` creates a MIDI segment backed by a new Aurum instrument.
- `Create Lumus Segment` creates a MIDI segment backed by a new Lumus instrument.

Each action creates a distinct instrument record, assigns it to the new segment, selects the segment, and opens the matching editor. The general instrument library also exposes separate Aether, Aurum, and Lumus creation controls.

## Engine ownership

- Aether owns its wavetable and hybrid-source configuration.
- Aurum owns its operator matrix, additive/ring/FM paths, filters, and related state.
- Lumus owns its Lumus configuration and editor state while retaining compatible shared synthesizer foundations where explicitly modeled.

The frontend snapshot stores Aurum and Lumus state alongside the existing Aether-compatible instrument fields. Native project persistence records the selected engine discriminator and restores Aurum state without converting it to Aether or Lumus. Native rendering dispatches Aurum through its dedicated voice parameters; Aether and Lumus continue through their existing paths.

## Verification

The interaction verifier checks that all three menu labels are present and that each action calls its distinct engine constructor. Engine-specific frontend verifiers cover Aurum and Lumus configuration/render behavior, while the synth and benchmark verifiers cover Aether. Native stress coverage includes Aurum rendering and persistence in addition to the existing Aether/Lumus paths.
