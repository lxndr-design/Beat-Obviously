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

## Original baseline evidence requirements

These requirements are addressed by the stabilization report below. The recent-project semantic mismatch remains the sole explicit waiver, and Milestone A remains blocked for review.

## Baseline stabilization report — 2026-07-11

Milestone A remains blocked pending human review of this report. No production Aether DSP or upstream implementation was changed or imported.

### Snapshot discrepancy

`062413553930fb102a81658063966c34500bf8a9` cannot be certified as containing the complete earlier dirty working state. The first audit status captured many modified and untracked source files while HEAD was `aea04342`; the only committed delta from `aea04342` to `06241355` is the six-file version bump. Current reflogs contain only a later reset to `06241355`, and unreachable-object enumeration did not establish a safe mapping back to the missing working files. The baseline therefore proceeds from `06241355` with this explicit limitation.

The audit documents were frozen in snapshot commit `fcfc59f1` and tag `aether-audit-snapshot-2026-07-11`. The external bundle SHA-256 is `8a0a1d7139d5be67849be244983252d1e644b10045fc8bc6985e9744e276cbfc`.

### Gate classification

| Gate | Predates this Aether branch | Audio-engine validity | Disposition and evidence |
| --- | --- | --- | --- |
| Eight Drumpad 3px-grid violations | Yes; all lines blame to `aea04342` | None; CSS only | Fixed to 12/21/3/9px geometry. Design-system verifier passes. |
| Direct Drumpad `AudioContext` | Yes; line blamed to `aea04342` | Boundary validity only; no native DSP change | Fixed by using the existing Beat-owned timeline browser-preview context. Audio-boundary verifier passes. |
| DAW left-split MIDI clipping | Yes; split implementation dates to `a4666e84` | No oscillator/DSP impact; affects edit correctness and rendered note scheduling | Fixed production note-window clipping for split and origin-aware resize. Existing assertions were preserved; DAW verifier passes. |
| Recent-project existence stress | Yes; no-path-probe policy blamed to `aea04342` | None; persistence/startup metadata only | Temporarily waived by explicit environment flag. Production deliberately reports a non-empty stored path without filesystem probing to avoid macOS TCC prompts. The original assertion still fails and remains visible. |

### Complete gates

- `npm run verify:non-native`: passed end-to-end, including build.
- `Beat`, `BeatBackendStress`, and `BeatAetherBaseline`: built in Release.
- `AETHER_BASELINE_WAIVE_RECENT_PROJECT_EXISTS=1 build-native/bin/BeatBackendStress`: passed every section with only `baseline.recent-project-exists` waived.
- Native suite: 6.81 s wall, 5.08 s user, 0.80 s system; maximum RSS 194,297,856 bytes; reported peak footprint 180,814,544 bytes.

### Test-only spectral/render baseline

`BeatAetherBaseline` produced 150 WAVs: six scenarios × five sample rates (`44.1/48/88.2/96/192 kHz`) × five block sizes (`64/128/256/512/1024`). All five block-size renders for each scenario/rate share a hash, proving block-size determinism. Report hash: `38be9dfa47454ec6bb2c3e4ac490330229c62ffd993325c9843c8bba951c6830`; render-hash manifest: `488cff559576353b206afaf0bc041d6bcd23522b684effeb455e192ceab2fbad`.

- Initialization exposed a real sample-rate preparation defect: pitch error is about `-0.036 cents` at 44.1 kHz but rises to `146.68`, `1199.98`, `1346.71`, and `2546.72 cents` at 48/88.2/96/192 kHz. `prepare()` calls `setFrequency()` with an unchanged cached frequency, so the early return leaves the old 44.1-kHz phase delta.
- High-note pitch error remained between `-0.092` and `0.074 cents`; measured alias-energy ratio ranged `0.00297–0.01684`, DC stayed within `3.1e-9`, and maximum adjacent-sample step ranged `0.905–1.023`.
- Modulated/unison scenario pitch and alias fields are descriptive composite-signal measurements, not fundamental-frequency accuracy claims. Dense modulation DC ranged `-0.00264–0.01222`; rapid-automation maximum step reached `0.5693`.
- Harness time per 250-ms mono render ranged about `5.53–7.08 ms`; no coarse render deadline overruns were observed. Peak harness RSS was 14,450,688 bytes.
- Fixed-capacity queue probe accepted 64 events and rejected/counts 16 overflow events.
- The isolated oscillator harness bypasses the shared wavetable cache and records that fact explicitly. Existing full-engine stress supplies render-work and cache coverage; the harness does not fabricate those counters.

The existing timbre/mipmap-axis coupling remains a Milestone A input and is untouched.

## Sample-rate correctness and baseline freeze — 2026-07-11

No upstream code was imported, and no wavetable frame/mipmap redesign was started. The user subsequently approved Option A on 2026-07-11, establishing freeze commit `e74d6d99` as the canonical source baseline; separate phase and licensing gates remain in force.

### Root cause and correction

`WavetableOscillator::prepare()` previously called `setFrequency(frequencyHz)`. Because `setFrequency()` deliberately returns early when the numeric frequency is unchanged, preparing an oscillator at a new rate could retain the phase increment computed for 44.1 kHz. Preparation now always validates the active rate, clamps the cached frequency to the new Nyquist policy, and evaluates `phaseDelta = frequencyHz / sampleRate` directly. It marks the existing frame cache dirty but does not reset phase. `InstrumentVoice::prepare()` likewise recomputes its voice-owned `phaseDelta = baseFrequencyHz / sampleRate` before preparing the main, A/B-unison, and related oscillator banks. Stateless `BasicOscillator` and sub/noise calls already receive a rate-derived increment at their call sites; live and offline engines both propagate their active rate through voice preparation.

Focused native coverage verifies 44.1/48/88.2/96/192 kHz tuning, changed-rate recomputation with unchanged frequency, same-rate idempotence, preserved phase, before/after-prepare frequency-order equivalence, BasicOscillator tuning, and exact WavetableOscillator phase increments. The complete live/offline stress path and render matrix remain green.

### Frozen results

- `npm run verify:non-native`: passed end-to-end.
- `Beat`, `BeatBackendStress`, and `BeatAetherBaseline`: Release targets built.
- Native stress with only `baseline.recent-project-exists` waived: passed every section in 6.69 s wall / 5.07 s user / 0.76 s system; maximum RSS 210,075,648 bytes. Compared with the prior run this is -0.12 s wall and +15,777,792 bytes RSS; this single-run delta is descriptive, not a performance regression conclusion.
- Initialization pitch error before -> after (cents): 44.1 kHz `-0.0360 -> -0.0360`; 48 kHz `146.6803 -> -0.0132`; 88.2 kHz `1199.9821 -> -0.0360`; 96 kHz `1346.7135 -> -0.0132`; 192 kHz `2546.7217 -> -0.0132`.
- Of 150 deterministic WAVs, 130 are byte-identical to the pre-fix baseline. Exactly 20 changed: the initialization scenario at each non-44.1-kHz rate across five block sizes. All 30 44.1-kHz renders and all non-initialization scenarios are unchanged. These expected changes are accepted explicitly rather than silently replacing hashes.
- New JSON report SHA-256: `ac7d3bef75b98de5b69a9973dd2a8ac30549806190f2653fbef46345074b9231`; render manifest SHA-256: `c2a4a3632e39707473e91fe2889ea510fb1f2b1dfc16a71a35a699be072c621f`.
- Per-render time range: 5.495–7.204 ms (prior 5.533–7.080 ms). Harness wall time was 1.09 s; JSON peak RSS was 14,319,616 bytes and `/usr/bin/time` maximum RSS was 14,729,216 bytes. No deadline overruns were observed.
- Queue probe remains 64 accepted, 16 rejected, and 16 overflow. The isolated harness still bypasses the shared wavetable cache and does not invent unavailable full-engine render counters; full-engine stress remains the evidence for those paths.

The only waiver remains `baseline.recent-project-exists`. It suppresses only the stale path-existence result when the explicit environment variable is present; order, legacy timestamp, removal, recording, and every later persistence/native stress remain asserted and executed. The untested behavior is filesystem existence probing of stored recent-project paths, intentionally disabled to avoid macOS TCC prompts.
