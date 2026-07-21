# Aurum Synth

Aurum is Beat's six-operator FM and additive instrument. It takes inspiration from matrix-based FM synthesizers while keeping Beat's own compact editor and data model.

The staged implementation and release gates are tracked in [`aurum-roadmap.md`](aurum-roadmap.md).

## Version 1 scope

- Six independently enabled operators
- Sine, saw, square, triangle, and editable 16-partial additive operator waveforms
- Ratio, coarse, fine, level, phase, and ADSR controls per operator
- A bipolar 6 x 7 FM/output matrix: six operator destinations plus the audible output
- A separate bipolar 6 x 6 ring/amplitude-modulation matrix
- Self-routing for operator feedback
- One-sample-delayed matrix feedback so cyclic routes remain bounded
- Independent operator note-off releases with native voice lifetime governed by the longest enabled operator tail
- One to eight unison voices with detune and stereo spread
- Shared Beat filter, resonance, drive, amplitude, and voice behavior
- Browser audition and native-engine rendering
- Project save/load persistence

## Data model

The frontend stores Aurum configuration under `instrument.aurum`. Native parsing maps the same object to `InstrumentDefinition::AurumConfig`; project persistence writes it back without flattening the matrices or operator harmonic spectra. Schema version 3 adds 16 normalized harmonic amplitudes per operator; older patches migrate with a fundamental-only spectrum so their sound does not change.

FM matrix rows are modulation sources. Columns `0..5` target operators 1 through 6, and column `6` routes that source to the audible output. RM matrix rows are amplitude-modulation sources and its six columns target operators 1 through 6. At full positive or negative depth the target becomes a ring-modulated signal; intermediate values retain a proportional dry component.

## Editor structure

The editor keeps the selected FM or RM routing matrix visible while the left workspace switches between Main and OP 1 through OP 6. Main contains shared unison and output-filter controls. Operator pages combine a live waveform scope, tuning and level controls, and the operator amplitude envelope. Additive operators expose a drawable 16-bin spectrum with keyboard-adjustable bins and fundamental, odd, and saw presets.

The module strip uses tab semantics with roving focus. Arrow keys cycle through Main and the six operators; Home selects Main and End selects OP 6.

Existing Beat controls are used for commands, selection, numeric entry, sliders, toggles, and matrix knobs. The waveform scope and routing-cell composition are Aurum-specific because the shared UI kit has no equivalent synthesis visual.

For a deterministic browser review, open `?beatDevFixture=aurum-editor`. The fixture loads a three-operator routing example and opens the Aurum editor directly.

## Current boundary

Aurum is an instrument foundation, not a clone of another synthesizer. It does not yet include per-operator filters, waveshaping editors, keyboard-mapped modulation curves, or a preset browser. Operator releases govern their own note-off tails in browser and native rendering; the hidden shared amplitude envelope does not reshape Aurum's operator envelopes. Additive rendering normalizes active partials and suppresses harmonics at or above Nyquist for the current operator frequency.

The focused native stress gate renders one deterministic additive/FM/RM/unison patch through both the live callback path and 32-bit WAV export at 44.1, 48, and 96 kHz. It verifies repeatable live output, requested stereo WAV metadata, finite bounded samples, and a negligible live/export residual at each rate. This is a path-parity gate, not yet the separate aliasing and perceptual cross-rate benchmark tracked for release readiness.
