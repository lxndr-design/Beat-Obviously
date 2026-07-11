# Aether current-engine audit

Audit date: 2026-07-11  
Pinned revision: `062413553930fb102a81658063966c34500bf8a9` (`codex/aether-serum-foundation`)  
Scope: native Aether/Beat rendering code and existing stress/verifier surfaces. No DSP behavior was changed during this audit.

## Reproducibility and baseline

- Host: macOS 26.6, Apple Silicon arm64; Apple clang 21.0.0; CMake 4.3.2; Node 26.0.0; npm 11.12.1; JUCE 8.0.4.
- The first read-only run began on `aea0434223c54a413bdaff5f8adb8594acaf15ee`; the checkout changed externally during the run to clean revision `06241355`. Those first results are race-affected and are not the reproducible baseline.
- Fresh Release configuration, `Beat`, `BeatBackendStress`, and root `Beat.app` packaging succeeded in the isolated worktree; JUCE HarfBuzz emitted 20 third-party warnings. The packaged app registered `com.beat.project -> com.beat.app`.
- The initial checkout's `verify:non-native` failed in `verify:design-system` on eight pre-existing Drumpad CSS grid violations.
- The initial checkout's native stress runner failed after 1.53 s in persistence: `Recent project repository stress failed order=1 existence=0 legacyTimestamp=1 remove=1 record=1`. Later sections were not executed.
- The reproducible isolated `verify:non-native` run passed version verification for 0.2.1 and then failed on the same eight Drumpad design-grid violations. Later non-native gates were not executed.
- The reproducible isolated native run failed at the same persistence assertion after 1.53 s (1.10 s user, 0.04 s system). Peak RSS was 27,918,336 bytes and the reported peak memory footprint was 14,991,936 bytes. Later native sections were not executed.
- Individually running the fail-fast suite's remaining commands found two additional failures: `verify:audio-boundary` rejects direct `AudioContext` use in `DrumpadEditorModal.solid.tsx:393`, and `verify:daw` fails the left-split MIDI clipping assertion at `verify-daw-core.mjs:787`. Sampler zones, typecheck, synth roundtrip, document roundtrip, track interactions, frontend interactions, node instrument, drums, and the frontend production build passed.
- CPU brand and physical-memory queries were denied by the execution sandbox. These measurements remain unverified rather than inferred.

Because the existing complete gates are not green, this audit is a release blocker. No Milestone A DSP replacement may begin until the pinned baseline is rerun after packaging and the persistence failure is either fixed or explicitly accepted as unrelated.

## Claim verification

| Supplied claim | Finding | Evidence and consequence |
| --- | --- | --- |
| PolyBLEP saw and square | Verified | `BasicOscillator::sample()` applies `polyBlep()` at the saw discontinuity and both square edges. Triangle is naive and noise uses JUCE's process-global random source. |
| Partially band-limited wavetable playback | Verified, architecturally incorrect | `WavetableOscillator::updateFrameCache()` computes a pitch-limited `playbackPosition`; the same axis selects timbral frames. Higher notes therefore change requested timbre instead of selecting an independent harmonic mip level. |
| Linear runtime sample and frame interpolation | Verified | `readCurrentSample()` linearly interpolates adjacent samples in each of two frames and then linearly interpolates the frames. No higher-quality offline path exists. |
| Mostly sample-rate-aware processing | Partial | Oscillator increments, ADSRs, filters, limiter release, glide, and LFO rates use the prepared rate. Several limits are constants or normalized policies; only existing stress coverage, not a systematic 44.1/48/88.2/96/192 kHz matrix, supports equivalence. |
| Caller-controlled parameter ramps | Verified | `RealtimeParameterChange` carries `rampSamples`; queue callers and automation events choose it. `InstrumentVoice` applies that value directly. There is no central parameter-rate/smoothing policy. |
| Partial click prevention | Verified | ADSR note tails, clip fades, sample fades, effect smoothing, and some project transitions exist. Hard voice stops call `clearCurrentNote()` without a shared steal/hard-stop fade, and routing/source/preset transitions do not share one de-click contract. |
| No always-on DC blocker | Verified | High-pass filters found in analysis/loudness metering do not process the audible master path. Wavetable construction does not establish a documented DC-removal invariant. |
| Final sample-peak limiter | Verified | `MasterLimiter` is the final safety stage and performs linked-channel instantaneous gain reduction plus an explicit sample clamp. It has no lookahead and is not a true-peak limiter. |
| Partial high-note and fast-pitch validation | Partial | Existing wavetable and high-polyphony stresses exercise pitch/render paths, but there is no automated alias-energy-by-note sweep, fast-FM/PM sideband threshold, or full sample-rate matrix. |
| Substantial but unproven real-time-safe memory handling | Verified | SPSC queues, fixed-capacity automation data, cached tables, immutable project snapshots, and preallocated recording buffers are present. There is no callback-wide allocation/lock/file-I/O detector. Shared-pointer release, JUCE callbacks, and container bounds are not comprehensively proven. |
| JUCE-controlled voice stealing | Verified | Beat only sets voice count and `setNoteStealingEnabled(true)` through `VoiceAllocation`; no Beat-owned victim selector implements released/quietest/oldest/stable-ID ordering. |
| Telemetry without overload response | Verified | Atomic render-work/cache counters and timing/meter data exist. Realtime parameter queue `push()` returns `false` on overflow, but there is no persistent overflow counter or explicit bounded overload policy. |
| No offline-only high-quality DSP mode | Verified | Offline export constructs another `AudioEngine` and calls the same callback/render path. Bit depth changes, but oscillator interpolation and nonlinear quality do not. |
| Stress tests lack comprehensive spectral regression | Verified | Existing tests cover render parity, limiter, caches, automation, high polyphony and effects. No reusable alias-energy, transition-spectrum, modulation-sideband, pitch-error, DC, or frequency-response threshold suite exists. |

## Additional material risks

- `InstrumentVoice::setParams()` obtains shared wavetable objects and can release prior `shared_ptr`s; the call sites must be proven non-callback or destruction must be deferred before claiming hard real-time safety.
- The runtime warp path uses a two-point nonlinear evaluation with a one-pole downsample state. It is described as oversampled but is not backed by a measured stop-band/alias specification.
- `BasicOscillator` noise uses `juce::Random::getSystemRandom()` while the Aether noise path has deterministic per-voice state. The standard oscillator path is therefore not guaranteed deterministic.
- Offline WAV export allocates buffers/vectors and performs file I/O by design outside a device callback; this is acceptable only because the offline entry is not a real-time thread.
- Existing telemetry counts work but does not prove allocation freedom, deadline compliance, or bounded destruction.

## Baseline evidence still required before Milestone A

1. Resolve or explicitly waive the eight Drumpad design-grid failures, then run all later non-native verifiers.
2. Resolve or explicitly waive the recent-project persistence stress failure, then run all later native sections.
3. Store deterministic WAV hashes and timing/RSS results for init, dense modulation, maximum unison, rapid automation, and high-note renders at the supported rate/block matrix.
4. Add a non-production spectral probe or first test-only Milestone A harness for alias, pitch, DC, and discontinuity measurements; the current suite cannot produce those baselines.
