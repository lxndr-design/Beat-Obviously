# Aurum Synth

Aurum is Beat's six-operator FM and additive instrument. It takes inspiration from matrix-based FM synthesizers while keeping Beat's own compact editor and data model.

## Version 1 scope

- Six independently enabled operators
- Sine, saw, square, and triangle operator waveforms
- Ratio, coarse, fine, level, phase, and ADSR controls per operator
- A 6 x 7 routing matrix: six operator destinations plus the audible output
- Self-routing for operator feedback
- One-sample-delayed matrix feedback so cyclic routes remain bounded
- One to eight unison voices with detune and stereo spread
- Shared Beat filter, resonance, drive, amplitude, and voice behavior
- Browser audition and native-engine rendering
- Project save/load persistence

## Data model

The frontend stores Aurum configuration under `instrument.aurum`. Native parsing maps the same object to `InstrumentDefinition::AurumConfig`; project persistence writes it back without flattening the matrix.

Matrix rows are modulation sources. Columns `0..5` target operators 1 through 6, and column `6` routes that source to the audible output.

## Editor structure

The editor keeps the routing matrix visible while the left workspace switches between Main and OP 1 through OP 6. Main contains shared unison and output-filter controls. Operator pages combine a live waveform scope, tuning and level controls, and the operator amplitude envelope.

Existing Beat controls are used for commands, selection, numeric entry, sliders, toggles, and matrix knobs. The waveform scope and routing-cell composition are Aurum-specific because the shared UI kit has no equivalent synthesis visual.

For a deterministic browser review, open `?beatDevFixture=aurum-editor`. The fixture loads a three-operator routing example and opens the Aurum editor directly.

## Current boundary

Aurum version 1 is an instrument foundation, not a clone of another synthesizer. It does not yet include per-operator filters, waveshaping editors, keyboard-mapped modulation curves, or a preset browser. Operator release values persist with the patch; note-off is currently governed by Beat's shared amplitude release path.
