# Aurum Synth

Aurum is Beat's six-operator FM and additive instrument. It takes inspiration from matrix-based FM synthesizers while keeping Beat's own compact editor and data model.

The staged implementation and release gates are tracked in [`aurum-roadmap.md`](aurum-roadmap.md).

## Version 1 scope

- Six independently enabled operators
- Sine, saw, square, triangle, and editable 16-partial additive operator waveforms
- Ratio, coarse, fine, level, phase, wavefold, independent amplitude/pitch/phase ADSRs, and editable velocity/keyboard response curves per operator
- A bipolar 6 x 7 FM/output matrix: six operator destinations plus the audible output
- A separate bipolar 6 x 6 ring/amplitude-modulation matrix
- A bipolar 6 x 3 output matrix for Filter A, Filter B, and Direct sends
- Self-routing for operator feedback
- One-sample-delayed matrix feedback so cyclic routes remain bounded
- Independent operator note-off releases with native voice lifetime governed by the longest enabled operator tail
- One to eight unison voices with detune and stereo spread
- Selectable 1x, 2x, and 4x operator-network quality
- Two independently enabled multimode filters with cutoff, resonance, drive, and Serial/Parallel routing
- Shared Beat amplitude and voice behavior
- Browser audition and native-engine rendering
- Project save/load persistence

## Data model

The frontend stores Aurum configuration under `instrument.aurum`. Native parsing maps the same object to `InstrumentDefinition::AurumConfig`; project persistence writes it back without flattening the matrices, operator harmonic spectra, response curves, or filter modules. Schema version 3 adds 16 normalized harmonic amplitudes per operator; version 4 adds normalized per-operator wavefold; version 5 adds dedicated pitch and phase ADSRs with bipolar semitone and degree depths; version 6 adds five-point velocity and keyboard gain-response curves; version 7 adds the operator-network quality mode; version 8 adds two output filters and Serial/Parallel routing; version 9 adds the 6 x 3 bipolar output-routing matrix; version 10 adds per-operator pan. Older patches migrate with a fundamental-only spectrum, zero wavefold, zero pitch/phase depth, flat response curves, centered operator pan, and 1x quality. Version 7 and earlier patches copy the instrument's shared filter into enabled Filter A, leave Filter B bypassed, and route the legacy `OUT` column into Filter A. Version 8 Serial patches route the legacy `OUT` column into Filter A; Parallel patches route it into both filters to preserve the v8 shared-input sound. New patches default to 2x quality.

FM matrix rows are modulation sources and columns `0..5` target operators 1 through 6. The retained legacy column `6` is migration storage and is no longer a second audible path. RM matrix rows are amplitude-modulation sources and its six columns target operators 1 through 6. At full positive or negative depth the target becomes a ring-modulated signal; intermediate values retain a proportional dry component. Output-routing rows are operators and columns are Filter A, Filter B, and Direct; negative sends invert phase.

## Editor structure

The editor keeps the selected FM, RM, or OUT routing matrix visible while the left workspace switches between Main and OP 1 through OP 6. Main contains shared unison, quality, dual-filter, and Serial/Parallel routing controls. Each filter uses the shared Beat toggle, floating select, and slider components. The OUT matrix uses the shared bipolar knob component for Filter A, Filter B, and Direct columns; the selected operator page mirrors those three sends. Operator pages combine an engine-sampled live waveform scope, phase and wavefold shaping, tuning, level, and bipolar pan controls, plus a compact Amp/Pitch/Phase articulation selector over the operator's three ADSRs. Pitch and phase modes expose their bipolar depth beside the shared envelope controls. A shared Velocity/Key response graph exposes five fixed input positions with draggable, keyboard-adjustable gain points and Flat/Rise/Fall presets. Additive operators expose a drawable 16-bin spectrum with keyboard-adjustable bins and fundamental, odd, and saw presets.

The module strip uses tab semantics with roving focus. Arrow keys cycle through Main and the six operators; Home selects Main and End selects OP 6.

Each operator page exposes shared Beat controls for Init, Copy, Paste, Swap, and Reset. Init restores the selected slot's default parameters while preserving its routing. Copy creates an isolated parameter snapshot and Paste keeps the destination slot's fixed id and name. Swap exchanges both parameter sets and the corresponding FM/RM matrix rows and columns plus output-send rows, preserving the audible topology. Reset initializes the slot and clears all of its inbound FM/RM, outbound FM/RM, and output routes.

The matrix header provides seven routing templates: Single carrier, 2-op stack, 3-op stack, Dual carriers, Dual branches, Feedback pair, and Six carriers. Applying a template replaces FM, RM, and output routing and enables only the operators required by that topology; oscillator, tuning, articulation, level, and pan parameters remain intact. Any manual matrix or output-send edit returns the selector to Custom algorithm.

Existing Beat controls are used for commands, selection, numeric entry, sliders, toggles, and matrix knobs. The waveform scope and routing-cell composition are Aurum-specific because the shared UI kit has no equivalent synthesis visual.

The editor analyzes the signal graph live. Operators with direct bus sends are marked as carriers, operators that reach those carriers through FM or RM are marked as modulators, and enabled operators without an audible path are marked as disconnected. Filter A, Filter B, and Direct show active or idle state; a patch with no active bus is explicitly reported as silent.

For a deterministic browser review, open `?beatDevFixture=aurum-editor`. The fixture loads a three-operator routing example and opens the Aurum editor directly.

## Current boundary

Aurum is an instrument foundation, not a clone of another synthesizer. It does not yet include arbitrary modulation curves or a preset browser. Each output bus normalizes its active bipolar operator sends. Operator pan combines with unison spread only when the operator enters Filter A, Filter B, or Direct, leaving FM and RM topology unchanged. In Serial mode, Filter A's branch joins direct Filter B sends before Filter B; in Parallel mode, Filter A and Filter B remain separate. Direct bypasses both filters, and active output branches are averaged at bounded gain. The resulting Aurum stereo mix enters Beat's existing instrument FX, track FX, and send/return route; Aurum does not duplicate that shared DSP. Disabled filters bypass their assigned signal rather than muting it. Each operator's amplitude release governs its audible note-off tail; pitch and phase releases continue their articulation during that tail without extending an otherwise silent native voice. Velocity and MIDI-note position are evaluated once per voice against each operator's linearly interpolated five-point gain curves; flat curves are neutral. The hidden shared amplitude envelope does not reshape Aurum's operator envelopes. Additive rendering normalizes active partials and suppresses harmonics at or above Nyquist for the current operator frequency. Wavefold is an identity transform at zero and uses a bounded symmetric fold at positive depth.

The quality selector runs the complete operator network, including one-sample feedback, at 1x, 2x, or 4x the project sample rate and averages the internal substeps back to the output rate. Focused gates verify finite bounded output, 2x convergence toward a 4x nonlinear high-frequency reference, and exact 1:2:4 oscillator-work scaling. This is a deterministic quality-policy gate; the separate release-readiness spectral alias benchmark remains outstanding.

The focused native stress gate renders one deterministic additive/FM/RM/unison patch through both the live callback path and 32-bit WAV export at 44.1, 48, and 96 kHz. It verifies repeatable live output, requested stereo WAV metadata, finite bounded samples, and a negligible live/export residual at each rate. This is a path-parity gate, not yet the separate aliasing and perceptual cross-rate benchmark tracked for release readiness.

Native feedback safety is explicit: non-finite route values are ignored, FM and RM route depths remain bipolar within `-1..1`, accumulated FM is limited to the six-source range, RM gain and stored one-sample feedback remain within `-1..1`, and dense cyclic routing is block-invariant. The focused gate covers all FM cells at full bipolar depth, all RM cells at dense bipolar depth, six operators, eight-way unison, the three target sample rates, and block sizes from 1 to 4096 samples. This does not yet replace the release-readiness polyphony and callback-deadline benchmark.
