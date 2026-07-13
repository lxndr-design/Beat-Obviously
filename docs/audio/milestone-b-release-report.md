# Milestone B release review

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> share with testers or collaborators, sell, or convey source or binaries.

Date: 2026-07-13  
Branch: `codex/aether-serum-foundation`  
Reviewed implementation head: `b463dbe9`

## Outcome

Milestone B implementation, automated verification, and the two required
product/DSP policy decisions are accepted. The phase is **declared released**
for this private build. Milestone C may proceed through its independently gated
slices.

No upstream implementation, factory content, branding, service integration, or
new runtime dependency was imported or executed during Milestone B.

## Verified release gates

| Gate | Evidence | Status |
| --- | --- | --- |
| Independent oscillators | Separate A/B source, table, tuning, phase, unison, level/pan, modulation, routing, and fixed FX-send state; stable persistence and frontend roundtrips | Pass |
| Source stack | Dedicated sub and noise plus both/filter-1/filter-2/direct destinations and two fixed source sends | Pass |
| Tuning and phase lifecycle | Semitone, harmonic, ratio, equal-division, retrigger, memory, random phase, legato retune, hard stop, and deterministic steal fixtures | Pass |
| Nonlinear modes | Two bounded serial warp stages plus AM/ring; finite/bounded output, exact work accounting, fixed oversampling policy, and interaction alias gate | Pass with threshold decision below |
| Modulation | Four envelopes, ten LFOs, eight macros, stable deterministic routes, rate-policy metadata, and fixed work ceilings | Pass |
| Performance expression | Per-member pressure, timbre, mod wheel, additive manager/member pitch, RPN 0,0 ranges, saved zones, legacy RPN 0,6 negotiation, and product controls | Pass as the documented limited MPE surface; no MIDI-CI/full-MPE claim |
| Filters and effects | Two shared filters, serial/parallel topology, source/direct routing, reorderable inserts, two source buses, migrations, and bounded graph bridges | Pass with transition decision below |
| Offline HQ | Optional per-export Standard/Offline-HQ selection through project, range, track, stems, and bounce paths; Standard remains default and bit-identical | Pass |
| Real-time safety | Warmed production callback reports zero heap, blocking-lock, file/stream, lazy-init, or container-growth violations; offline render excluded | Pass |
| Determinism and compatibility | Full native stress, full non-native verification, production build, migrations, automation roundtrips, live/export null families, and 150-render freeze | Pass |
| Provenance | Four audit documents and external-source ledger current; no Vital-derived or other external-derived Milestone B file | Pass |

## Final automated baseline

- Complete native stress: pass with only the existing
  `baseline.recent-project-exists` macOS TCC waiver.
- Complete `verify:non-native`: pass.
- Production `Beat`, `BeatBackendStress`, and `BeatAetherBaseline`: build.
- Default/Standard matrix: 150 WAVs, byte-identical to B27/B25.
- Established normalized render manifest:
  `f3d8c2fce88a0607d4f3c3043fef273617f999d9c38f1b1147327fbf73b8bba1`.
- B28 timing-bearing JSON:
  `2e6444b4fc2d4965547554e07117541afa01d0fb61a0b99b0026ff80c88b52fc`.
- Matrix resources: 2.50 s wall / 2.18 s user / 0.04 s system;
  15,482,880-byte process maximum RSS; zero deadlines; queue 64 accepted /
  16 rejected / 16 overflow.
- Production interaction alias at 44.1 kHz: AM `0.0000102953`, ring
  `0.0000448392`; both below the current `0.005` regression gate.

## Approved decisions

The user explicitly approved both policies on 2026-07-13.

### 1. Transition policy

Current behavior uses bounded bridges for steals, table replacement, and
same-project instrument/group/return effect reorder or bypass. The measured
effect-graph boundary step is `0.000371158`; the current conservative regression
ceiling is `0.2`. Old effect processors are not retained to render overlapping
decay tails after a graph replacement.

Recommended decision: accept the bounded bridge and no-old-tail-overlap policy
for Milestone B, while treating `0.2` only as a fail-safe regression ceiling,
not a psychoacoustic inaudibility claim. Tail overlap can remain a later
opt-in architecture change because it expands ownership and callback work.

Decision: **approved as recommended**.

### 2. Spectral threshold policy

The release suite has exact continuity, DC, pitch, sample-rate, mip-selection,
finite-output, deterministic-generation, high-note, and interaction alias
measurements. AM/ring has a ratified executable `0.005` gate. Wavetable and
runtime-warp measurements are recorded, but the project has not adopted one
universal alias-energy ceiling for all musical/complex scenarios; the baseline
harness's broad-band ratios are not equivalent to isolated unwanted-alias
energy and must not be mislabeled as such.

Recommended decision: accept the current mode-specific gates for Milestone B
and require every future nonlinear mode to add its own isolated spectral test.
Do not adopt a single global threshold from the broad-band scenario metric.

Decision: **approved as recommended**.

## Remaining non-release claims

- The recent-project existence probe remains the sole explicit TCC waiver.
- External host/plugin callbacks are outside Beat's internal callback proof.
- MIDI-CI MPE Profile negotiation, simultaneous lower and upper zones, and
  non-Aether Nodemap expression initialization are not implemented.
- Old effect-tail overlap is not implemented.
- Component isolation does not exempt the combined private build from GPLv3
  constraints if Vital-derived code is introduced later.

## Release decision

Milestone B is accepted. This approval does not remove the private-build
licensing gate, authorize distribution, approve an external dependency, or
approve executing/importing upstream code. Each Milestone C slice retains those
independent controls.
