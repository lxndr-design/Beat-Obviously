# Aether Serum-class gap matrix

This matrix uses Serum-class instruments as a capability reference, not a source-compatibility promise. Milestone C is blocked until A and B pass their release gates.

| Capability | Current Beat state | Target milestone | Required proof / dependency |
| --- | --- | --- | --- |
| Independent timbre and harmonic-resolution axes | Implemented in A1 foundation | A1 | Position invariance and independent-selection tests pass; final spectral thresholds remain to be ratified |
| Reliable band limiting | Immutable harmonic mips with continuous selection implemented | A1 | Alias measurements captured; release thresholds and offline-HQ policy remain open |
| Wavetable construction invariants | Implemented for generated tables | A1 | Explicit validation, DC removal, common normalization, phase alignment, and deterministic generation tests pass |
| Safe table replacement | Implemented with bounded dual-table playback and one retired owner per stack | A7 | Exact boundary continuity/replacement supersession tests pass; global callback-operation interposer remains separate |
| Parameter-rate taxonomy | Implemented for the 24-entry realtime voice surface | A2 | Central constexpr metadata, stable-ID/range/rate/smoothing/eligibility tests pass; future parameters must enter through the same policy |
| Unified de-click behavior | Deterministic steal bridge implemented; other transitions remain subsystem-specific | A2/A3 | Extend the bounded transition contract to route/effect/source/table replacement and ratify peak thresholds |
| Deterministic voice allocation | Implemented for Beat instrument synthesis | A3 | Released/quietest/oldest/stable-ID ordering and actual steal tests pass; Node-map fallback uses the same selector with generic state |
| Callback-safety proof | Expanded A9 test gate passes: zero allocation, actually blocking mutex, file/stream, lazy-init, or growth violations on the warmed dense device-callback simulation; offline render is excluded | A3/A4/A8/A9 | Preserve the gate as Milestone B graph complexity grows; external product callbacks remain outside Beat's internal guarantee |
| Explicit hard budgets | Queue, event, route, pending-note, sample-voice and clip-voice admission budgets implemented | A3/A4 | Add explicit nonlinear/modulation work ceilings and future-source budgets as those engines are introduced |
| Audible DC removal | Implemented before final limiter | A5 | Sample-rate, constant-input, lifecycle reset, finite-output, and block-continuity tests pass |
| Offline HQ mode | Explicit opt-in mode implemented for wavetable sample interpolation | A6 | Phase/transport parity tests pass; nonlinear oversampling policy and product-facing export selection remain open |
| Two independent main oscillators | Substantially present | B1 | Normalize independence, routing, phase and stable targets |
| Dedicated sub and noise/transient | Present | B1 | Mono/direct/FX routing semantics and tests |
| Per-oscillator unison | Present up to bounded counts | B1 | Tuning modes, performance and transition proof |
| Phase memory/randomization | Partial deterministic reset/jitter | B1 | Explicit modes and preset migration |
| Advanced tuning modes | Missing/partial fine and pitch controls | B2 | Semitone/harmonic/ratio/step contract |
| Dual serial warp stages | Missing | B2 | Prioritized modes, alias and oversampling policy |
| FM/PM/PD/AM/ring modulation | Partial modulation, no complete audio-rate architecture | B2 | Source/destination contracts and spectral tests |
| Four envelopes / ten LFOs / eight macros | Two envelopes, two LFOs, four macros | B3 | Stable IDs, bounded routes, migration and UI follow-up |
| MPE/per-note expression | Partial note automation | B3 | Input capability mapping and deterministic persistence |
| Dual shared filters and source routing | Missing | B4 | Shared filter buses, serial/parallel/direct routing |
| Reorderable insert plus two FX buses | Partial instrument-owned fixed FX | B5 | De-clicked graph replacement and preset migrations |
| Three source slots | Missing | C1 | Narrow source-engine interface after A/B freeze |
| Sample engine | Partial sampler/zone playback | C2 | Slot integration, loops/slicing/tape modulation, RT-safe load |
| Multisample/SFZ | DecentSampler zones only | C3 | sfizz wrapper versus internal subset decision |
| Granular | Missing | C4 | Desktop-native preallocated grain engine and CPU budget |
| Spectral | Missing | C5 | Specialist-reviewed STFT analysis/resynthesis design |

## Mandatory order

1. Make the pinned baseline green and measurable.
2. Implement/test the frame-mipmap data model without changing public preset IDs.
3. Add transition policy, deterministic allocation, callback proof, budgets and DC removal.
4. Add offline HQ only after standard live/offline parity is stable.
5. Complete oscillator/modulation/filter/FX Milestone B in separately gated slices.
6. Start source-slot and hybrid work only after A and B release reports are accepted.

## Stabilized baseline gate

- Non-native verification is green.
- Native verification is green with the single explicit `baseline.recent-project-exists` waiver; all later sections execute.
- The 150-render matrix is deterministic across block sizes.
- The measured sample-rate preparation defect is corrected and frozen before Milestone A: preparation recomputes cached phase increments without resetting phase. Initialization pitch error is now within 0.037 cents at every supported rate, with the expected 20 render changes explicitly recorded.
- High-note alias, DC, discontinuity, timing, RSS, queue overflow, and render hashes are captured in `current-engine-audit.md` and the external baseline artifact directory.
- The user approved Option A on 2026-07-11: sample-rate freeze commit `e74d6d99` is the canonical source baseline. This clears only the source-state gate; all phase, licensing, and upstream-import gates remain independent.

## Explicit non-goals

- No Sytrus-style operator/FM graph.
- No full Serum 2 parity claim.
- No Vital factory content, branding, services, or preset data.
- No granular/spectral release blocker for the first production wavetable milestone.
- No automatic quality degradation under load; use deterministic budgets and user-selected modes.
