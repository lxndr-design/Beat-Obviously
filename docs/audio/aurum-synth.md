# Aurum Synth

Aurum is Beat's six-operator FM and additive instrument. It takes inspiration from matrix-based FM synthesizers while keeping Beat's own compact editor and data model.

The staged implementation and release gates are tracked in [`aurum-roadmap.md`](aurum-roadmap.md).

## Version 1 scope

- Six independently enabled operators
- Sine, saw, square, triangle, and editable 16-partial additive operator waveforms
- Ratio, coarse, fine, level, phase, wavefold, independent amplitude/pitch/phase ADSRs, and editable velocity/keyboard response curves per operator
- A bipolar 6 x 7 FM/output matrix: six operator destinations plus the audible output
- A separate bipolar 6 x 6 ring/amplitude-modulation matrix
- Self-routing for operator feedback
- One-sample-delayed matrix feedback so cyclic routes remain bounded
- Independent operator note-off releases with native voice lifetime governed by the longest enabled operator tail
- One to eight unison voices with detune and stereo spread
- Selectable 1x, 2x, and 4x operator-network quality
- Shared Beat filter, resonance, drive, amplitude, and voice behavior
- Browser audition and native-engine rendering
- Project save/load persistence

## Data model

The frontend stores Aurum configuration under `instrument.aurum`. Native parsing maps the same object to `InstrumentDefinition::AurumConfig`; project persistence writes it back without flattening the matrices, operator harmonic spectra, or response curves. Schema version 3 adds 16 normalized harmonic amplitudes per operator; version 4 adds normalized per-operator wavefold; version 5 adds dedicated pitch and phase ADSRs with bipolar semitone and degree depths; version 6 adds five-point velocity and keyboard gain-response curves; version 7 adds the operator-network quality mode. Older patches migrate with a fundamental-only spectrum, zero wavefold, zero pitch/phase depth, flat response curves, and 1x quality so their sound does not change. New patches default to 2x.

FM matrix rows are modulation sources. Columns `0..5` target operators 1 through 6, and column `6` routes that source to the audible output. RM matrix rows are amplitude-modulation sources and its six columns target operators 1 through 6. At full positive or negative depth the target becomes a ring-modulated signal; intermediate values retain a proportional dry component.

## Editor structure

The editor keeps the selected FM or RM routing matrix visible while the left workspace switches between Main and OP 1 through OP 6. Main contains shared unison and output-filter controls. Operator pages combine an engine-sampled live waveform scope, phase and wavefold shaping, tuning and level controls, and a compact Amp/Pitch/Phase articulation selector over the operator's three ADSRs. Pitch and phase modes expose their bipolar depth beside the shared envelope controls. A shared Velocity/Key response graph exposes five fixed input positions with draggable, keyboard-adjustable gain points and Flat/Rise/Fall presets. Additive operators expose a drawable 16-bin spectrum with keyboard-adjustable bins and fundamental, odd, and saw presets.

The module strip uses tab semantics with roving focus. Arrow keys cycle through Main and the six operators; Home selects Main and End selects OP 6.

Existing Beat controls are used for commands, selection, numeric entry, sliders, toggles, and matrix knobs. The waveform scope and routing-cell composition are Aurum-specific because the shared UI kit has no equivalent synthesis visual.

For a deterministic browser review, open `?beatDevFixture=aurum-editor`. The fixture loads a three-operator routing example and opens the Aurum editor directly.

## Current boundary

Aurum is an instrument foundation, not a clone of another synthesizer. It does not yet include per-operator filters, arbitrary modulation curves, or a preset browser. Each operator's amplitude release governs its audible note-off tail; pitch and phase releases continue their articulation during that tail without extending an otherwise silent native voice. Velocity and MIDI-note position are evaluated once per voice against each operator's linearly interpolated five-point gain curves; flat curves are neutral. The hidden shared amplitude envelope does not reshape Aurum's operator envelopes. Additive rendering normalizes active partials and suppresses harmonics at or above Nyquist for the current operator frequency. Wavefold is an identity transform at zero and uses a bounded symmetric fold at positive depth.

The quality selector runs the complete operator network, including one-sample feedback, at 1x, 2x, or 4x the project sample rate and averages the internal substeps back to the output rate. Focused gates verify finite bounded output, 2x convergence toward a 4x nonlinear high-frequency reference, and exact 1:2:4 oscillator-work scaling. This is a deterministic quality-policy gate; the separate release-readiness spectral alias benchmark remains outstanding.

The focused native stress gate renders one deterministic additive/FM/RM/unison patch through both the live callback path and 32-bit WAV export at 44.1, 48, and 96 kHz. It verifies repeatable live output, requested stereo WAV metadata, finite bounded samples, and a negligible live/export residual at each rate. This is a path-parity gate, not yet the separate aliasing and perceptual cross-rate benchmark tracked for release readiness.

Native feedback safety is explicit: non-finite route values are ignored, FM and RM route depths remain bipolar within `-1..1`, accumulated FM is limited to the six-source range, RM gain and stored one-sample feedback remain within `-1..1`, and dense cyclic routing is block-invariant. The focused gate covers all FM cells at full bipolar depth, all RM cells at dense bipolar depth, six operators, eight-way unison, the three target sample rates, and block sizes from 1 to 4096 samples. This does not yet replace the release-readiness polyphony and callback-deadline benchmark.
