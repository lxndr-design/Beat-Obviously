# Aether Serum-class gap matrix

This matrix uses Serum-class instruments as a capability reference, not a source-compatibility promise. Milestone C is blocked until A and B pass their release gates.

| Capability | Current Beat state | Target milestone | Required proof / dependency |
| --- | --- | --- | --- |
| Independent timbre and harmonic-resolution axes | Missing; pitch clamps timbral position | A1 | New immutable frame/mip model; invariance and alias tests |
| Reliable band limiting | Partial | A1 | Offline mip generation, level crossfade, alias thresholds |
| Wavetable construction invariants | Partial | A1 | Validation, DC removal, normalization, phase policy, deterministic hashes |
| Safe table replacement | Partial shared ownership | A1/A2 | Bounded crossfade and non-audio reclamation |
| Parameter-rate taxonomy | Missing | A2 | Central metadata and migration-compatible stable IDs |
| Unified de-click behavior | Partial, subsystem-specific | A2 | Event taxonomy and peak-discontinuity thresholds |
| Deterministic voice allocation | Missing | A3 | Beat-owned state and victim-order tests |
| Callback-safety proof | Partial architecture, no detector | A3 | Allocation/lock/file/deadline instrumentation |
| Explicit hard budgets | Partial voice limits only | A3 | Oscillator, route, modulation and future-source budgets |
| Audible DC removal | Missing | A3 | Placement decision and frequency/DC regression |
| Offline HQ mode | Missing | A4 | Quality enum, interpolation/oversampling policy, timing parity |
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
