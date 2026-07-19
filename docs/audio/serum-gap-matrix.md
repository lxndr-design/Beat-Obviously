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
| Sample engine | Slot 1 has normalized slicing, click-bounded forward looping, eight fixed key/velocity zones, deterministic two-zone overlap blending, per-zone editing, two FX sends, and conservative live streaming for Aether-only files >= 8 s; one shared worker, fixed double-bank caches, attack/loop preloads, 64-sample underflow/recovery fades, aggregate telemetry, decoded shared-asset fallback, explicit full-decode offline mode, 64-failure/128-page starvation recovery, and 16-voice non-sequential loop/cache-churn proof pass | C1/C2A/C2B/C2C/C2D/C2E/C2F/C2G/C2H/C2I | Preserve current eligibility/page budgets; add round-robin only with a separately approved selection policy, then resolve the SFZ strategy gate |
| Multisample/SFZ | Disconnected Beat-owned C3A–C3D1 path now covers parsing, secure resolution, descriptor-verified bounded decoding, and a dedicated indexed source slot; two-bank voice-pinned publication, deferred control-thread retirement, 32-candidate note-on work, 16 active voices, overlap blending, tuning/slice/loop/one-shot playback, five-rate and exact block tests pass without upstream code or a dependency | C3A/C3B/C3C1/C3C2/C3D1 | Define product routing/import and an explicit active-source replacement policy; release-trigger/group/off-by and sequence/round-robin remain rejected until separately designed and approved |
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

## Milestone C3D2 update — 2026-07-15

The first bounded hybrid source is product-reachable: a saved Beat project can transactionally import the approved internal SFZ subset into a content-addressed project asset, persist and relocate all provenance paths, verify and decode it off-thread, and route it through Aether Sample Slot 1. Active replacement is bounded: new notes use the newly verified instrument while previous voices tail from pinned immutable data, with destruction deferred to a control-side rebuild. Tamper, traversal, symlink, rollback, packaging, persistence, routing, repeat-determinism, and callback-boundary coverage is green.

This closes the Sample Slot 1 import/routing and active-replacement row only for the explicitly supported attack-trigger subset. It is not broad SFZ compatibility. Sequence/round-robin/random selection, release-trigger regions, group/off-by choking, unsupported opcodes, external relinking, sample editing, Slots 2–3, granular playback, and spectral playback remain open. No upstream implementation or dependency was approved or used. The 150 default-off renders remain byte-identical, and the only suite waiver remains `baseline.recent-project-exists`.

## Milestone C3E1 update — 2026-07-15

The granular row now has a disconnected bounded engine foundation: immutable finite stereo input, deterministic scheduling, eight emitters, 32 grains, fixed parameter/source limits, five-rate and exact block tests, pool-pressure telemetry, and a clean callback-safety probe. It is compiled but unreachable from product rendering. Product routing, schema/UI, source import, replacement, modulation, audible review, and presets remain open and require the next approval; spectral work remains untouched.

## Milestone C3E2 update — 2026-07-15

Granular Slot 2 is product-reachable through a content-addressed, project-owned managed audio asset or the deterministic Beat-owned benchmark source. Persistence, relocation, tamper/path/symlink rejection, bounded decoding, stable parameters, editor controls, main/filter/direct routing, FX sends, active replacement tails, and an audible factory benchmark are covered. This closes the bounded desktop granular foundation/product-path row only: there is no realtime granular modulation, automatic source analysis, external relinking, sample editing, transient detection, tempo warping, spectral processing, or Slot 3 implementation. The isolated 150 default-off renders remain byte-identical, and the only suite waiver remains `baseline.recent-project-exists`.

## Milestone C3F review update — 2026-07-15

Slot 3 remains unimplemented. An AI technical DSP review accepted bounded STFT frame-bank Option B with revisions but did not provide specialist sign-off. The proposal now specifies exact WOLA reconstruction, identity phase locking and transient resets, independent L/R storage with shared analysis decisions, canonical-rate resampling targets, bounded position, resource/deadline accounting, validation constraints, and separate latency quantities. Pitch implementation constants, flux/refractory values, filter geometry, minimum-machine budget, and final alignment model still require human specialist confirmation. No source, schema, dependency, preset, factory asset, callback, or baseline changed.

## Milestone C3G non-spectral closeout update — 2026-07-16

Sample Slot 1 and Granular Slot 2 now fail visibly on malformed or future persistence instead of silently truncating, dropping, or disabling unknown data. Cleanup is fail-closed and retains complete referenced managed bundles. Slot controls expose keyboard navigation, focus restoration, labels, live source state, and disabled reasons. The two factory string benchmarks have repeat-deterministic finite/audible/DC/discontinuity/hash coverage at 44.1/48/96 kHz. Full native/non-native gates pass with only the existing `baseline.recent-project-exists` waiver, and the 150-render manifest remains `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.

This completes the non-spectral hybrid foundation for Slots 1 and 2 only. It does not close Milestone C, spectral processing, Slot 3, C3F1–C3F3, realtime granular modulation, general SFZ compatibility, automatic relinking, or sample editing. The C3F contracts and reserved Slot 3 boundary are unchanged.

## Milestone C3F1 update — 2026-07-16

The project owner waived the specialist-credential prerequisite and authorized only the disconnected analyzer/artifact-validator slice. Beat now has deterministic bounded 48 kHz STFT analysis, independent L/R magnitude/phase-residual storage, shared peaks/transients, payload hashing, Parseval and structural validation, cancellation-without-publication, complete 48 MiB accounting, and raw WOLA proof across seven signal classes. This changes the Spectral row from `Missing` to `Disconnected analysis foundation`; it does not implement Slot 3 playback, product import/schema/UI, pitch shifting, output resampling, realtime position/freeze, latency compensation, or a callback path. The measured float32 phase-residual artifact reconstruction is -91.7453 dB, so C3F2 must address accumulated phase precision before playback quality can be accepted.

Full native/non-native gates and all Release targets pass with only the existing TCC waiver. The 150-render normalized manifest remains `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`, with zero deadline overruns and unchanged queue telemetry. C3F2 and C3F3 remain incomplete and separately gated.

## Milestone C3F2 representation update — 2026-07-16

The disconnected spectral row now has artifact schema v2: deterministic one-to-one peak identities, float64 per-peak L/R phase evolution, float32 per-bin phase relative to the assigned peak, exact versioned serialization, bounded decoding, and fail-closed validation. Across stationary, multi-tone, harmonic, transient, noise, mono, stereo, and transition cases, v2 measures -138.468 to -140.310 dB and improves independently encoded float32 all-bin residuals by 9.99–33.80 dB while remaining within 0.208 dB of independently encoded float64 all-bin results. The unchanged 48 MiB cap guarantees 19.397333 seconds under worst-case 255-peak frames. Spectral playback, product reachability, pitch/position/freeze, host-rate conversion, latency, and realtime deadlines remain open.

All Release/native/non-native gates pass with only the existing TCC waiver. The 150-render manifest remains `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`, with zero deadline overruns and unchanged queue telemetry. Fixed-capacity spectral playback has not begun.

## Serum 1 integration update — 2026-07-19

The audio-bus and Aether histories are reconciled and the two benchmark factory identities now have one canonical, schema-idempotent definition each. Browser audition hashes, six reviewed C4/rate hashes, exact native full-chain metrics, stereo-unison evidence, cache/work counters, and Release deadline data are frozen on the integrated branch. Callback string slicing found during integration is removed and the focused realtime detector is green.

The browser oscillator probe's former `-6.878 dB` / `-6.424 dB` values were filter-contaminated: changing the persisted flag after preview construction never bypassed the preview filter. An explicit backward-compatible runtime bypass, common full-band wavetable normalization, a sharper 513-tap reference decimator, and gain/correlation diagnostics now produce `-26.180 dB` / `-26.333 dB` with approximately `0.999` correlation and unit fitted gain. The band split measures lower-band residuals of `-60.497 / -68.529 dB` below 8 kHz and `-51.190 / -56.706 dB` from 8–16 kHz; more than 99.9% of the remaining energy is confined to 16–24 kHz. The remaining Serum 1 decisions are the Nyquist-edge brightness/taper policy and the fixed eight-voice unison capacity while the supplied Future Bass description requested nine. Serum 2 comparison work remains deferred until those choices are explicitly accepted or changed.
