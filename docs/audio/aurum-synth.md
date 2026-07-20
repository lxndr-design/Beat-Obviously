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

## Current boundary

Aurum version 1 is an instrument foundation, not a clone of another synthesizer. It does not yet include per-operator filters, waveshaping editors, keyboard-mapped modulation curves, or a preset browser. Operator release values persist with the patch; note-off is currently governed by Beat's shared amplitude release path.
