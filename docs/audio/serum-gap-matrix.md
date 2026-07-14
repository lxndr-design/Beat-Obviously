# Aether Serum-class gap matrix

This matrix uses Serum-class instruments as a capability reference, not a source-compatibility promise. Milestones A and B have passed their release gates.

Milestone B implementation, automated verification, bounded-transition policy,
and mode-specific spectral policy are accepted. Milestone C may proceed through
independently gated Beat-owned slices; licensing, upstream-import, and external
dependency approvals remain separate.

| Capability | Current Beat state | Target milestone | Required proof / dependency |
| --- | --- | --- | --- |
| Independent timbre and harmonic-resolution axes | Implemented in A1 foundation | A1 | Position invariance and independent-selection tests pass; final spectral thresholds remain to be ratified |
| Reliable band limiting | Immutable harmonic mips with continuous selection implemented | A1 | Alias measurements captured; release thresholds and offline-HQ policy remain open |
| Wavetable construction invariants | Implemented for generated tables | A1 | Explicit validation, DC removal, common normalization, phase alignment, and deterministic generation tests pass |
| Safe table replacement | Implemented with bounded dual-table playback and one retired owner per stack | A7 | Exact boundary continuity/replacement supersession tests pass; global callback-operation interposer remains separate |
| Parameter-rate taxonomy | Implemented for the 28-entry realtime voice surface, including eight macros | A2/B9 | Central constexpr metadata, stable-ID/range/rate/smoothing/eligibility tests pass; future parameters must enter through the same policy |
| Unified de-click behavior | Deterministic steal/table bridges and bounded instrument/group/return effect-graph bridges implemented; source/preset transitions remain subsystem-specific | A2/A3/B17 | Extend the bounded transition contract to remaining source/preset replacements, decide whether effect-tail overlap is required, and ratify peak thresholds |
| Deterministic voice allocation | Implemented for Beat instrument synthesis | A3 | Released/quietest/oldest/stable-ID ordering and actual steal tests pass; Node-map fallback uses the same selector with generic state |
| Callback-safety proof | Expanded A9 test gate passes: zero allocation, actually blocking mutex, file/stream, lazy-init, or growth violations on the warmed dense device-callback simulation; offline render is excluded | A3/A4/A8/A9 | Preserve the gate as Milestone B graph complexity grows; external product callbacks remain outside Beat's internal guarantee |
| Explicit hard budgets | Queue, event, route, pending-note, sample-voice and clip-voice admission budgets plus fixed-graph modulation/nonlinear voice-work ceilings implemented | A3/A4/B12 | Preserve negative detector tests; add independently reviewed budgets when later effect buses or hybrid source engines expand callback work |
| Audible DC removal | Implemented before final limiter | A5 | Sample-rate, constant-input, lifecycle reset, finite-output, and block-continuity tests pass |
| Offline HQ mode | Explicit opt-in wavetable interpolation mode is product-selectable per export preset; missing/invalid values preserve Standard, while interaction oversampling uses the same measured fixed 2x policy in both modes | A6/B27/B28 | Phase/transport, default-compatibility, finite/distinct HQ, and full export-path tests pass; preserve setup-only selection and deterministic timing |
| Factory preset breadth | Two user-supplied string benchmarks are structurally adapted into schema-idempotent, audible Beat factory patches with exact-name/ID and FX-order coverage | B29 | Aether currently caps per-oscillator unison at 8 and lacks dynamic FX/envelope-time/LFO-depth targets; retain these limitations in provenance until those targets are independently implemented |
| Two independent main oscillators | Source/table, tuning, phase/randomization, static unison, unison modulation, level and pan are independent; legacy shared unison migrates compatibly | B1/B2 | Add per-source filter/direct/FX routing and later audio-rate cross-modulation |
| Dedicated sub and noise/transient | Present with independent shared-filter/direct routing and two fixed shared FX sends | B1/B6/B16 | Add broader transition/audible preset fixtures |
| Per-oscillator unison | Present up to bounded counts | B1 | Tuning modes, performance and transition proof |
| Phase memory/randomization | Independent A/B retrigger and memory modes implemented with product controls; retrigger retains deterministic random-depth behavior; memory/steal and legato-retune lifecycle fixtures pass | B4/B24/B25 | Extend audible fixtures only when new lifecycle modes or oscillator replacement paths are added |
| Advanced tuning modes | Implemented and product-editable independently for A/B: semitone, harmonic, ratio, and equal-division step modes plus fine cents | B3/B24 | Add broader preset-library coverage without changing stable IDs |
| Dual serial warp stages | Implemented with independent stable fields and the bounded fold/pinch/mirror/shape set | B8 | Ratify measured alias/stop-band thresholds for the existing oversampling policy |
| FM/PM/PD/AM/ring modulation | Bounded A-by-B AM and ring modes use fixed 2x source-rate rendering and a prepared sixth-order downsampler; measured production AM/ring alias cases are below 0.005, off/zero is exact, and callback safety/work budgets pass; FM/PM/PD remain absent | B13/B26/B27 | Add modes only with independent alias, phase, gain, transition, and budget evidence; do not expand into an operator graph |
| Four envelopes / ten LFOs / eight macros | Four envelopes, ten LFOs with free/tempo-synced rates, and eight macros | B9/B10/B11/B15 | Add broader routed audible/preset fixtures and preserve the fixed-work gate as assignments grow |
| MPE/per-note expression | Independent mod wheel, poly/channel pressure, CC74 timbre, additive manager/member pitch paths, per-channel RPN 0,0 ranges, product controls for a versioned persisted contiguous zone, and legacy lower/upper RPN 0,6 negotiation with 2/48-semitone defaults; fixed channel caches initialize Aether voices deterministically and survive cross-channel steals | B3/B14/B18/B19/B20/B21/B22/B23 | Add MIDI-CI/profile negotiation, simultaneous-zone policy, and non-Aether initialization before claiming MPE completeness |
| Dual shared filters and source routing | Two shared filters with serial/parallel topology and per-source both/Filter-1/Filter-2/direct destinations plus two fixed source FX sends implemented | B5/B6/B7/B16 | Add transition automation and broader audible routing fixtures |
| Reorderable insert plus two FX buses | Instrument inserts remain reorderable; two fixed Aether source buses feed project-owned shared return effect chains; same-project instrument/group/return reorder and bypass edits receive a bounded output bridge | B5/B16/B17 | Product-ratified transition ceiling, optional old-tail overlap decision, and broader mixed-era audible preset fixtures |
| Three source slots | Fixed three-slot interface exists; Slot 1 is product-connected with a fixed eight-zone map and Slots 2-3 are reserved | C1/C2A/C2B/C2C | Preserve the interface while each later source receives its own lifecycle, budget, persistence, and transition gate |
| Sample engine | Slot 1 reuses Beat's decoded project-asset cache; schema-v5/v4 migration adds normalized slicing, click-bounded forward looping, eight fixed key/velocity zones, deterministic two-zone equal-power overlap blending, per-zone editing, and two fixed shared-FX sends; a disconnected Beat-owned double-bank page-cache foundation passes bounded queue, concurrency, telemetry, and callback-safety gates | C1/C2A/C2B/C2C/C2D/C2E/C2F/C2G-foundation | Connect one shared background reader only after explicit live/offline ownership, attack/loop preload, and bounded underflow-fade tests pass; add round-robin only with a separate policy |
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
