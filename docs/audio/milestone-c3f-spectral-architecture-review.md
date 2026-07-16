# Milestone C3F spectral architecture review

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> share with testers or collaborators, sell, or convey source or binaries.

Date: 2026-07-15; owner authorization updated 2026-07-16

Branch: `codex/aether-c3f-review`; C3F1 implementation: `codex/aether-c3f1`

Reviewed implementation head: `aace6c1b`

Status: **C3F1 owner-authorized; specialist credential requirement explicitly waived by the project owner**

## Outcome

Slot 3 should use a bounded immutable spectral-frame asset, analyzed entirely
outside the realtime callback and rendered by a fixed-capacity source slot.
The selected representation is revised Option B below: a phase-vocoder/STFT
frame bank with exact WOLA reconstruction, identity phase locking, shared
stereo analysis decisions, explicit canonical-rate resampling, latency, and
measurable deadline budgets.

The original checkpoint did not approve or implement spectral DSP. On
2026-07-16 the project owner explicitly directed Beat to treat the attached
technical review as sufficient authorization and proceed. The reviewer remains
accurately identified as AI technical assistance; the record does not relabel
it as a human-authored review. The owner waived the specialist-credential gate
and authorized C3F1 only. Product schema, playback, callback connection,
factory content, C3F2, and C3F3 remain separate gates.

## Current architecture evidence

- `SourceSlotIndex::three` and `SourceComplexity::spectral` are reserved, but no
  Slot 3 model or renderer exists.
- `SourceSlot` already separates setup/publication from fixed-work note/render
  methods and exposes lifecycle, latency, state version, and telemetry.
- C3D2 and C3E2 establish content-addressed project assets, strict path/hash
  validation, immutable control-side construction, bounded replacement tails,
  and deferred destruction.
- The callback-safety probe detects heap allocation, blocking locks,
  file/stream operations, lazy initialization, and container growth while not
  misclassifying offline rendering.
- No runtime FFT or spectral-resynthesis path currently exists in Beat.

## Candidate representations

| Option | Model | Strength | Material cost/risk | Decision |
| --- | --- | --- | --- | --- |
| A | Fixed sinusoidal partial tracks | Device-rate-independent, naturally bounded, inexpensive for tonal sources | Loses noise and transient identity unless a residual model is added | Reject for first general spectral source |
| B | Immutable L/R STFT magnitude plus phase-evolution frames, exact WOLA and identity phase locking | Preserves tonal/noise content, supports bounded position and pitch, has measurable reconstruction behavior | Requires the revised contracts below and human specialist confirmation | **Accepted with revisions; recommended** |
| C | Magnitude-only spectrogram with generated phase | Small artifact and simple editing model | Unstable identity, smeared attacks, weak deterministic reconstruction | Reject as production playback model |

Option B is recommended because it is the narrowest architecture that can be
judged against the original signal without pretending a partial-only model is
general-purpose. The attached AI technical review accepted Option B with the
revisions below; this is not specialist sign-off or implementation
authorization.

## Proposed ownership and thread boundary

```text
saved project / explicit import
  -> descriptor-safe bounded audio decode
  -> analysis worker (never the callback)
       decode/resample -> window/FFT -> phase evolution -> finite validation
       -> immutable spectral artifact -> hash/manifest -> atomic publication

project apply / control thread
  -> verify manifest, paths, hashes, analysis version and hard limits
  -> construct immutable SpectralFrameBank
  -> prepare fixed FFT/window/resampler state and fixed voice buffers
  -> publish inactive bank / retire unpinned bank on control thread

audio callback
  -> fixed note admission
  -> bounded frame interpolation and phase propagation
  -> fixed inverse transform and overlap-add work
  -> fixed output resampling and route/FX-send arithmetic
  -> atomic counters only; no ownership destruction
```

Analysis and playback must remain separate translation units and interfaces.
The playback target must not include file selection, decoding, hashing,
manifest parsing, analysis, cache generation, or artifact repair.

## Proposed immutable artifact

The artifact should be project-owned and content-addressed. Its manifest must
include at least:

- schema and analysis-algorithm versions;
- original encoded-audio SHA-256 and analyzed-PCM SHA-256;
- channel/stereo representation;
- canonical analysis sample rate, FFT size, hop size, window identifier and
  normalization convention;
- frame and bin counts, duration, root note, and deterministic seed where used;
- payload byte count and SHA-256;
- finite-value and range-validation result.

The C3F representation is independent L/R magnitude and wrapped phase-evolution
data. Peak regions and transient markers derive from one shared stereo reference
spectrum, while magnitudes and phases remain channel-specific. Stereo width is
applied only after time-domain reconstruction.

Provisional review limits, not yet accepted implementation constants:

- one managed source per Slot 3 instance;
- decoded input: at most two channels and 30 seconds;
- canonical analysis rate: 48 kHz;
- FFT size: 1024; analysis/synthesis hop: 256; exact square-root periodic Hann
  WOLA pair and scaling defined below;
- at most 5,625 frames and 513 bins per plane;
- spectral payload: at most 48 MiB;
- active spectral voices: four;
- no realtime analysis, adaptive FFT size, unbounded frame cache, or automatic
  quality degradation.

The 48 MiB cap covers the complete uncompressed validated artifact, including
both quantities, both channels, alignment, frame metadata, transient flags,
peak regions, and internal indexes. Every limit must fail closed before
allocation and be encoded into the artifact version so a later policy cannot
silently reinterpret old data.

## Standard STFT and reconstruction contract

Standard mode uses transform length `N = 1024`, analysis and synthesis hop
`H_a = H_s = 256`, and overlap factor four. The periodic Hann is exactly:

```text
wH[n] = 0.5 - 0.5 cos(2 pi n / N),  0 <= n < N
wa[n] = ws[n] = sqrt(wH[n])
```

For fourfold overlap, the shifted products sum to two. WOLA therefore applies
gain `1/2` after an inverse transform normalized by the transform size, or
`1/(2N)` when the inverse FFT is unnormalized. The analysis-algorithm version
must record the exact forward/inverse scaling, periodic window formula,
separate analysis/synthesis windows, overlap gain, real-spectrum DC/Nyquist
handling, left/center frame alignment, edge padding, and startup/pre-roll
policy.

Unmodified float32-spectrum analysis/resynthesis must measure relative error:

```text
Erel = 10 log10(sum((x - xhat)^2) / (sum(x^2) + epsilon)) <= -120 dB
```

The measured gate covers impulse, DC, Nyquist, coherent sine, swept sine, white
noise, and deterministic random finite signals. Any excluded boundary samples
must be fixed by the alignment contract and reported explicitly.

## Phase, peak, and transient contract

For bin `k` and frame `m`, the artifact stores magnitude `M[k,m]` and wrapped
instantaneous-frequency residual:

```text
deltaPhi[k,m] = princarg(phi[k,m] - phi[k,m-1] - (2 pi k / N) Ha)
omegaHat[k,m] = (2 pi k / N) + deltaPhi[k,m] / Ha
theta[k,m] = theta[k,m-1] + omegaHat[k,m] Hs
```

Synthesis phase accumulation uses float64. Standard playback requires bounded,
deterministic identity phase locking: local-magnitude peaks are detected from
the shared stereo reference spectrum; every bin is assigned to one peak region
with stable tie-breaking; peak phases propagate from instantaneous frequency;
and each assigned bin preserves its analysis-relative phase to that peak.

Offline analysis marks bounded transient frames using versioned normalized
positive spectral flux and a fixed refractory interval. At a transient, both
channels synchronously reset to analysis-relative phases, interpolation across
the boundary is suppressed, and the reset rule is deterministic. Exact flux
threshold and refractory constants remain specialist-confirmation items; until
accepted, C3F cannot claim general transient preservation.

## Stereo contract

The shared detection magnitude is:

```text
Mref[k,m] = sqrt((ML[k,m]^2 + MR[k,m]^2) / 2)
```

Both channels use the same peak regions and transient decisions but retain
their own magnitude and phase-evolution data. After time-domain reconstruction,
bounded stereo width uses `mid = (L+R)/2`, `side = (L-R)/2`, then
`L' = mid + width*side`, `R' = mid - width*side`. Required coherence fixtures
include mono, dual mono, polarity-inverted stereo, hard-panned impulse,
coherent sine, decorrelated noise, moving stereo, and side-only input under
freeze and pitch motion. Tests record L/R correlation, interchannel level
difference, and controlled-tone phase difference.

## Canonical-rate resampling contract

Import performs a deterministic versioned band-limited conversion from the
verified source rate to 48 kHz. Playback remains on a canonical 48 kHz spectral
timeline and feeds a fixed-capacity streaming converter to the host rate, so
transform cadence does not increase at 88.2, 96, or 192 kHz.

The converter version must define phase accumulator, phase-table geometry, tap
count, passband/transition band, coefficient-phase interpolation, group delay,
startup/flushing, and sample-rate-change state mapping. Standard targets are at
least 100 dB stopband attenuation, no more than 0.01 dB passband ripple, and no
image/alias component above -100 dBFS outside the declared transition band for
an amplitude-limited sweep. A host-rate change is a control-side reprepare that
maps canonical time and accumulated phase into freshly prepared resampler
state; it never preserves stale raw buffer indexes.

## Playback and musical contract

The first product slice should expose only enable, source, root note, level,
pan/stereo width, normalized position, pitch in semitones, playback/freeze mode,
main route, and two fixed FX sends. Stable IDs and migration defaults are
required. Source replacement and analysis-structural changes are control-side
rebuild parameters, not realtime modulation targets.

Position is a smoothed control-rate source trajectory; arbitrary audio-rate
motion is excluded. Discontinuous jumps perform a bounded phase reset with a
short fixed crossfade. Negative traversal is excluded from C3F. Pitch range,
collision and Nyquist policy remain specialist-confirmation constants. The
implementation must choose and version one complete algorithm: direct spectral
frequency/bin scaling with interpolation and energy/collision rules, or
phase-vocoder time scaling followed by bounded resampling. Pitch transposition
`q` uses ratio `2^(q/12)` and must not silently change requested duration.

A held note must not reset phase on sample-rate changes unless the source
lifecycle explicitly resets.
Live and offline Standard rendering must share the same state transitions and
produce deterministic output. Offline HQ may use a separately declared quality
mode only after Standard parity is frozen.

The first slice does not include transient-aware time stretching, formant
preservation, spectral painting, cross-synthesis, morphing between unrelated
assets, automatic tempo sync, external relinking, or arbitrary FFT sizes.

## Realtime contract and budgets

Before publication, each voice must own all transform, overlap-add, phase,
resampling, and output buffers at maximum size. FFT/window plans and coefficient
tables must be constructed and warmed outside the callback. The callback may
read only immutable frame data and mutate fixed per-voice state.

Required callback telemetry:

- transforms and spectral bins processed;
- frame interpolations and overlap-add samples;
- accepted/rejected notes and capacity rejection;
- invalid-artifact/publication rejection;
- active voices and retired publications;
- deadline/queue counters through the existing engine telemetry.

One transform is accounted as one real inverse transform for one channel; a
complete stereo synthesis hop therefore accounts as two transforms unless a
later packed implementation changes the named accounting unit. Four steady
voices at 48 kHz and hop 256 require 750 stereo hops, or 1,500 channel inverse
transforms, per second. The implementation must derive a hard per-callback loop
ceiling from elapsed canonical frames and maximum legal resampler demand. Pool
or work exhaustion rejects work deterministically; it must not allocate, block,
read a file, start a worker, grow a container, or silently reduce quality.

Deadline testing covers rates 44.1/48/88.2/96/192 kHz; blocks 16, 32, 64, 128,
256, 512, 1024 and irregular legal sizes; zero through four voices; position
motion, pitch extrema, freeze, replacement, sends, and denormal-prone tails.
For callback utilization `U = callback_time / (block_samples / sample_rate)`,
each declared minimum supported machine must achieve `P99.9(U) < 0.50` and
`max(U) < 0.80` in an extended isolated run, with zero deadlines, allocations,
blocking operations, lazy initialization, non-finite samples, or silent quality
fallback. These provisional engineering gates remain subject to whole-engine
budget confirmation.

## Latency and alignment contract

The implementation separately defines event latency (note event to first
intended causal output), steady-state alignment delay (requested canonical
position to synthesized reference sample), output-resampler group delay, and
host-reported fixed latency. For a linear-phase FIR of length `Lr`, converter
delay is `(Lr - 1)/2` at the tap operating rate and is converted explicitly to
host samples.

Frame centering or left alignment, negative-time padding, first-frame pre-roll,
overlap-ring phase, note-event placement, output startup, replacement-fade
alignment, export trimming, and end flushing are versioned contracts. The same
reference sample is used for live and offline Standard rendering. Tests cover
note-on/off at every sample offset, first impulse, source start/end, frozen
start, replacement at every overlap phase, export start/tail, host-rate
changes, live/offline alignment, and plugin delay-compensation reporting.

## Security and artifact validation

- Reuse Beat's descriptor-identity and managed-asset path policy; do not add a
  second weaker file boundary.
- Analyze only a verified immutable decode. Revalidate source identity before
  and after decode and hash the exact PCM consumed by analysis.
- Reject traversal, absolute payload paths, symlinks, schema/version mismatch,
  size/hash mismatch, unknown windows, inconsistent dimensions, non-finite or
  negative magnitudes, invalid phase evolution, excessive energy, and decoded
  metadata mismatch.
- Require `0 <= M[k,m] <= Mmax`; finite phase residuals in `[-pi, pi)`; real
  DC/Nyquist constraints; bounded spectral energy versus analyzed PCM; in-range,
  terminating peak regions; bounded transient counts; and overflow-safe
  dimension multiplication before allocation. Revalidate every artifact-derived
  loop bound during construction even after hash verification.
- Analysis cancellation and failure must leave no published partial asset.
  Stage, fsync where required by the existing policy, verify, then rename.
- Acquired repositories, binaries, models, presets, services, and external
  runtime dependencies remain prohibited without their separate human gates.

## Technical review decision record

Reviewer: OpenAI GPT-5.6 Thinking, technical DSP review assistance; not a human
credentialed signatory. Review date: 2026-07-15. Outcome: **accept with
revisions**. Option B remains recommended. Specialist DSP sign-off: **no**.
Project-owner authorization to begin C3F1: **recorded 2026-07-16**. The owner
explicitly waived the specialist-signatory prerequisite. This changes project
authorization, not the factual identity or credentials of the AI reviewer.

The review accepted the 48 kHz canonical timeline and provisionally accepted
the four-voice, 48 MiB and 1024-point limits subject to complete payload
accounting and measured deadline gates. It required the exact reconstruction,
phase-locking/transient, L/R stereo, pitch/position, resampling, resource, and
latency contracts now recorded above.

## Required specialist DSP decisions

A qualified DSP reviewer must explicitly accept or replace all of these before
spectral implementation begins:

1. Confirm the exact square-root periodic Hann/WOLA and FFT scaling contract.
2. Confirm deterministic identity phase locking, spectral-flux threshold,
   refractory interval, and stereo-synchronous reset behavior.
3. Confirm independent L/R storage, shared peak/transient decisions, and the
   coherence gates.
4. Confirm the versioned import/output resampler design and filter constants.
5. Confirm pitch range/algorithm, Nyquist/collision/energy behavior, position
   smoothing, jump crossfade, and the lack of negative traversal.
6. Confirm complete 48 MiB accounting, transform unit, minimum supported
   machine, utilization gates, latency reference model, and compensation.

Review approval must name the reviewer, date, accepted option, any changed
constants, and the evidence used. A generic “continue” is sufficient to keep
the architecture work moving, but it is not recorded as specialist DSP
sign-off unless the reviewer qualification and decisions are explicit.

## Implementation slices after approval

1. **C3F1 disconnected analyzer/artifact validator:** locally generated test
   signals only; no product import or callback edge.
2. **C3F2 disconnected fixed-capacity source slot:** immutable test artifacts,
   fixed voices/buffers, callback-safety and deadline pressure tests.
3. **C3F3 managed product path:** project asset, migrations, routing, UI,
   replacement tails, audible benchmark, complete matrix freeze.

Each slice requires focused negative tests and the full native/non-native gate.
The 150 default-off renders must remain byte-identical until Slot 3 is made
product-reachable; expected changes after opt-in must be documented rather than
silently replacing hashes.

## Review-checkpoint verification

- The diff is documentation-only; `backend`, `frontend`, build files, scripts,
  tests, schemas, assets, and presets are unchanged from `aace6c1b`.
- `git diff --check` passes.
- The C3E2 native/non-native and 150-render evidence is inherited unchanged and
  is not represented as a new execution of those suites.

## Stop condition

C3F1 is authorized as a disconnected analyzer and artifact validator using
locally generated test PCM. Do not add FFT playback, a callback edge, Slot 3
schema/UI, a managed or factory spectral asset, or upstream implementation in
C3F1. C3F2 and C3F3 require their own review of measured C3F1 evidence.

## C3F1 measured contract update — 2026-07-16

C3F1 fixes analysis version 1 at 48 kHz, `N=1024`, `H=256`, periodic
square-root Hann analysis/synthesis windows, an inverse-transform-normalized
overlap gain of `1/2`, independent L/R magnitude and wrapped phase residuals,
shared root-mean-square stereo reference magnitudes, stable local-peak regions,
normalized positive-flux threshold `0.35`, and a four-frame refractory period.
The 5,625-frame ceiling includes three leading and three trailing overlap
positions; the exact fully reconstructed source ceiling is therefore 1,439,232
samples, or 29.984 seconds, rather than the contradictory provisional 30.000
seconds.

The disconnected analyzer accepts only already-verified immutable in-memory
PCM at the canonical rate. It publishes nothing on cancellation or failure.
The artifact accounts for both L/R magnitude and phase planes, shared peak
assignments/bins, transient flags, indexes, and fixed manifest/alignment
overhead under the 48 MiB cap. Validation recomputes the payload SHA-256 and
checks schema/algorithm/window, overflow-safe shapes, finite/ranged values,
phase bounds, peak termination/order/assignment, binary transients, and
Parseval energy agreement.

Raw float32 WOLA reconstruction measures `-139.333 dB` on the mixed stereo
fixture and passes the `-120 dB` gate across impulse, DC, Nyquist, coherent
sine, swept sine, white noise, and deterministic finite random fixtures. The
version-1 magnitude/float32-phase-residual artifact round trip measures
`-91.7453 dB`; that value is frozen as analysis evidence and is not a C3F2
playback-quality acceptance. C3F2 must resolve accumulated phase precision,
identity phase-lock playback, pitch, resampling, latency, and callback budgets
before any callback connection.

## C3F2 representation decision — 2026-07-16

The project owner approved artifact v2 with float64 phase evolution per detected
L/R peak and float32 per-bin phase relative to the assigned peak, subject to
measured comparison before playback integration. That representation passes the
dedicated report in `milestone-c3f2-representation-validation.md`.

V2 supersedes the C3F1 provisional per-bin float32 residual representation and
its provisional 5,625-frame/29.984-second source limit. Exact materialized
serialization under the unchanged 48 MiB cap guarantees 3,640 frames,
931,072 source samples, or 19.397333 seconds at the worst legal density of 255
peaks per frame. V2 reconstruction measures -138.468 to -140.310 dB across the
required corpus, improves independently encoded float32 all-bin residuals by
9.99–33.80 dB, and stays within 0.208 dB of independently encoded float64
all-bin residuals. Float32 relative phase therefore
remains accepted.

This closes only the representation/serialization/validation portion of C3F2.
The disconnected fixed-capacity playback engine remains unimplemented pending
review of this report. Product import, schema/UI, managed assets, callback
connection, and C3F3 remain later gates.

The final C3F1 source-matched gates pass: full `verify:non-native`; Release
`Beat`, `BeatBackendStress`, and `BeatAetherBaseline`; and the complete native
suite with only the existing `baseline.recent-project-exists` TCC waiver. The
native run took 9.92 seconds wall / 8.18 user / 0.74 system with 229,376,000-byte
maximum RSS. The external baseline regenerated 150 WAVs with unchanged
normalized manifest `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`.
Timing-bearing JSON SHA-256 is
`2979d34da05091f33cccba4d54392d62d0719f7b1d55788cff1692644b1ff024`;
render times were 12.63–21.83 ms (13.60 ms mean), harness peak RSS was
15,138,816 bytes, deadline overruns were zero, and queue telemetry remained
64 accepted / 16 rejected / 16 overflow. Timing and RSS are descriptive
single-run observations. C3F1 introduces no new waiver.

## C3F2 disconnected playback checkpoint — 2026-07-16

After reviewing the artifact-v2 evidence, the project owner authorized the
disconnected fixed-capacity playback slice. The implementation and measured
results are recorded in `milestone-c3f2-playback-validation.md`. Four fixed
voices, identity-locked float64 synthesis phase, fixed WOLA/rings, bounded
direct pitch, fixed setup position/freeze, canonical-rate conversion, explicit
latency, realtime-safety probes, and the complete rate/block/voice deadline
matrix now pass while remaining unreachable from product rendering.

The project owner subsequently approved the recommended active-position
contract. A latest-wins atomic control request prepares a second fixed lane
through the existing pre-roll, then crosses over with a 5 ms equal-power fade.
Requests during pre-roll supersede the pending target; a request during an
audible fade becomes the sole next target. Block determinism, discontinuity,
active-rate-change, callback safety, underflow, and the full dynamic-position
deadline matrix pass. Contract item 5 is closed for this disconnected engine.
Replacement/alignment and product latency compensation remain open. Accordingly
C3F2 and Slot 3 remain incomplete, and C3F3 has not begun.
