# Milestone C3F spectral architecture review

> Private personal GPLv3-constrained build only. Do not distribute, publish,
> share with testers or collaborators, sell, or convey source or binaries.

Date: 2026-07-15

Branch: `codex/aether-c3f-review`

Reviewed implementation head: `aace6c1b`

Status: **proposal only — specialist DSP sign-off and human approval required**

## Outcome

Slot 3 should use a bounded immutable spectral-frame asset, analyzed entirely
outside the realtime callback and rendered by a fixed-capacity source slot.
The recommended representation is Option B below: a phase-vocoder/STFT frame
bank with explicit phase evolution, overlap-add, latency, resampling, and work
budgets.

This checkpoint does not approve or implement spectral DSP. It adds no product
schema, parameter, asset, callback, dependency, preset, factory content, or
render change. It is the review package a DSP specialist must evaluate before
the first disconnected implementation slice.

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
| B | Immutable STFT magnitude plus phase-evolution frames, fixed-window overlap-add | Preserves tonal/noise content, supports independent position and pitch, has measurable reconstruction behavior | Requires an explicit phase, stereo, resampling, latency, and polyphony policy | **Recommended, pending specialist review** |
| C | Magnitude-only spectrogram with generated phase | Small artifact and simple editing model | Unstable identity, smeared attacks, weak deterministic reconstruction | Reject as production playback model |

Option B is recommended because it is the narrowest architecture that can be
judged against the original signal without pretending a partial-only model is
general-purpose. The recommendation is not implementation authorization.

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

The recommended first representation is two bounded spectral planes carrying
magnitude and phase evolution. The stereo plane choice is deliberately open
for specialist review: independent L/R is simple but can damage image
coherence; mid/side can preserve a controllable image but needs explicit side
energy and phase rules.

Provisional review limits, not yet accepted implementation constants:

- one managed source per Slot 3 instance;
- decoded input: at most two channels and 30 seconds;
- canonical analysis rate: 48 kHz;
- FFT size: 1024; hop: 256; periodic Hann-derived perfect-reconstruction pair;
- at most 5,625 frames and 513 bins per plane;
- spectral payload: at most 48 MiB;
- active spectral voices: four;
- no realtime analysis, adaptive FFT size, unbounded frame cache, or automatic
  quality degradation.

Every limit must fail closed before allocation and be encoded into the artifact
version so a later policy cannot silently reinterpret old data.

## Playback and musical contract

The first product slice should expose only enable, source, root note, level,
pan/stereo width, normalized position, pitch in semitones, playback/freeze mode,
main route, and two fixed FX sends. Stable IDs and migration defaults are
required. Source replacement and analysis-structural changes are control-side
rebuild parameters, not realtime modulation targets.

Position and musical pitch must be independent. A held note must not reset
phase on sample-rate changes unless the source lifecycle explicitly resets.
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

The implementation must define a hard transform-per-block ceiling for every
supported block size. Pool or work exhaustion rejects work deterministically;
it must not allocate, block, read a file, start a worker, grow a container, or
silently reduce quality.

Reported latency must be derived from the accepted analysis/synthesis window,
hop, and output-resampler delay. Note/event timing, offline export trimming,
plugin compensation, and replacement fades must be tested against that value.

## Security and artifact validation

- Reuse Beat's descriptor-identity and managed-asset path policy; do not add a
  second weaker file boundary.
- Analyze only a verified immutable decode. Revalidate source identity before
  and after decode and hash the exact PCM consumed by analysis.
- Reject traversal, absolute payload paths, symlinks, schema/version mismatch,
  size/hash mismatch, unknown windows, inconsistent dimensions, non-finite or
  negative magnitudes, invalid phase evolution, excessive energy, and decoded
  metadata mismatch.
- Analysis cancellation and failure must leave no published partial asset.
  Stage, fsync where required by the existing policy, verify, then rename.
- Acquired repositories, binaries, models, presets, services, and external
  runtime dependencies remain prohibited without their separate human gates.

## Required specialist DSP decisions

A qualified DSP reviewer must explicitly accept or replace all of these before
spectral implementation begins:

1. STFT window/hop pair and the reconstruction-normalization proof.
2. Phase propagation and whether identity/transient phase locking is required.
3. L/R versus mid/side representation and stereo-coherence tests.
4. Canonical-rate analysis plus fixed output-resampling policy across 44.1,
   48, 88.2, 96, and 192 kHz.
5. Four-voice/48-MiB/1024-point provisional budgets and measured CPU/deadline
   acceptance thresholds.
6. Latency definition and compensation behavior for note start, live render,
   offline export, and source replacement.

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

Milestone C3F is blocked at architecture review. Do not add an analyzer,
spectral artifact, FFT playback code, Slot 3 schema/UI, factory spectral asset,
or upstream implementation until the specialist DSP decisions and human
implementation approval above are recorded.
