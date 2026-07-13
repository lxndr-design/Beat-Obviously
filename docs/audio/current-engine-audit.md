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
| Independent timbral and harmonic-resolution axes | Resolved in Milestone A foundation | Position now selects adjacent immutable timbral frames only. Frequency/sample rate select adjacent harmonic mip levels only; playback crossfades continuously on both axes. |
| Linear runtime sample, frame, and mip interpolation | Verified | `readCurrentSample()` linearly interpolates adjacent samples, timbral frames, and logarithmically selected mip levels. No higher-quality offline path exists yet. |
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

## Milestone A1 frame/mip foundation — 2026-07-11

Starting from canonical baseline `e74d6d99`, Beat now owns an immutable `TimbralFrame[]` model whose frames contain ordered immutable `MipLevel[]` sample vectors and explicit harmonic limits. Construction validates empty frames, missing or inconsistent levels, sample sizes, harmonic ordering/ranges, cross-frame harmonic-layout consistency, and finite samples with inspectable error codes/messages. The legacy flat constructor remains only as a compatibility boundary and creates a single-level table.

The Beat factory deterministically generates common harmonic mip layouts (`64, 32, 16, 8, 4, 2, 1` at the default size) outside playback. Every generated level is DC-removed, phase-aligned by common harmonic synthesis, and scaled with the frame's common full-band normalization gain. The cache publishes the completed immutable table through existing `shared_ptr<const Wavetable>` voice ownership; audio-thread playback performs no generation or allocation.

`WavetableOscillator` no longer derives frame position from pitch. Position crossfades only adjacent timbral frames. The continuously valued `0.48 * sampleRate / frequencyHz` harmonic budget selects and logarithmically crossfades adjacent mip levels; removing integer quantization avoids discontinuities at mip boundaries. Phase and preset/automation IDs are unchanged.

Focused native tests cover malformed input, finite/bounded output, frame-position invariance between low and high notes, independent mip selection, frame and mip transition continuity, deterministic generation, generated-level DC, all existing custom/warp behavior, and the five-rate preparation suite. Full `verify:non-native`, Release `Beat`, `BeatBackendStress`, and `BeatAetherBaseline` pass with only the existing TCC waiver.

The final 150-render matrix reproduced twice with zero WAV mismatches. Compared with the canonical sample-rate freeze, all 25 initialization renders remain byte-identical; the 125 position-dependent renders change intentionally because pitch no longer clamps timbral position. JSON SHA-256: `c8da1d0a0aa34849c501d5aaa3e4d850f67b1ca76efd9444af0d57b65f3011fc`; render-manifest SHA-256: `bb299db960d7942995e38a2b7361b9b14730e3497cd5313380b0fa738f77ae4f`.

Native stress completed in 7.12 s with 189,284,352-byte maximum RSS and no new waiver. Harness render measurements were 12.78–15.92 ms with 15,073,280-byte peak RSS and zero coarse deadline overruns. These harness times include constructing a complete multi-mip table for every render, so they measure generation plus playback rather than callback cost; production tables are generated on cache-miss setup paths and reused. Composite-signal alias fields remain descriptive rather than release thresholds.

This completes only the A1 frame/mip foundation. Bounded table-replacement crossfades, destruction deferral proof, central parameter policy, unified de-clicking, deterministic stealing, callback instrumentation/budgets, DC blocking, and explicit quality modes remain open Milestone A slices.

## Milestone A2 realtime parameter policy — 2026-07-11

The realtime voice surface has one allocation-free constexpr metadata authority in `ParameterPolicy.h`. It began with 24 entries and expands to 28 with Milestone B9's Macro 5–8 IDs. Each entry preserves its stable automation ID and defines minimum/maximum range, rate class, smoothing ownership, and modulation eligibility. The taxonomy supports discrete, smoothed-control, sample-accurate-control, and audio-rate classifications; current realtime entries are classified according to their implemented processing path rather than claiming unsupported audio-rate modulation.

`VoiceRealtimeParams` now derives ID lookup and clamping from this table instead of parallel string and range switches. `InstrumentVoice` asks the policy for the effective ramp length before activating its existing sample-by-sample ramp. Every currently supported entry retains `callerRamp`, so caller-selected timing, zero-ramp immediacy, inactive-voice behavior, presets, automation IDs, and modulation semantics are unchanged.

Compile-time checks require the policy count to match the realtime enum and reject duplicate stable IDs. Native coverage verifies complete lookup round trips, unique/nonempty IDs, valid ranges, exact clamping, smoothing ownership, representative rate classes, the 15 currently eligible modulation targets, and unknown-ID rejection. The full native and non-native gates pass with only the existing TCC waiver, and all 150 WAVs are byte-identical to the A1 freeze.

This slice makes metadata authoritative for the implemented realtime voice surface. Parameters that are not currently realtime-applicable are not falsely advertised as supported; extending the surface requires adding policy metadata and coverage in the same change.

## Milestone A3 deterministic steal transitions — 2026-07-11

Beat now owns synthesiser victim selection through `BeatSynthesiser`, overriding JUCE's selection hook without modifying JUCE. Every `InstrumentVoice` exposes bounded allocation state: active/released flags, current stereo output level, and a stable construction-order voice ID. Victims are selected lexicographically: released first, then quietest, then oldest, then lowest stable ID. This ordering is allocation-free and deterministic for equal event streams.

A true victim selection explicitly arms a fixed `VoiceTransition`; ordinary hard stops do not. On immediate reuse, the new note's first stereo sample is exactly the victim's last stereo output and a linear 1.5 ms handoff (clamped to 8–256 samples) reaches the replacement signal. This avoids a steal-boundary step while preserving MIDI event timing, note phase setup, envelopes, and voice limits. No stale transition survives an unrelated hard stop.

Tests cover the complete victim comparator, real oldest and released-voice selection through a two-voice synthesiser, stable IDs, bounded transition length, exact first-sample continuity, completion, and actual one-voice stealing. Full native/non-native gates pass with only the TCC waiver, production Beat builds, and all 150 non-steal baseline WAVs remain byte-identical.

This checkpoint addresses deterministic voice stealing and steal de-clicking. General route/effect/source/table replacement transitions and explicit reclamation remain open.

## Milestone A4 durable telemetry and hard budgets — 2026-07-11

`RenderTimingSnapshot` now publishes cumulative realtime-parameter queue accepted/rejected counts, block-event overflow, deadline overruns, and callback-capacity safety violations alongside existing timing/cache/work counters. Queue admission increments atomics at the producer boundary; block-capacity drops increment a separate counter; deadline comparison uses the active sample rate and block size; callback buffer growth risk is detected before `setSize()`.

`RenderBudgets.h` centralizes fixed limits: 1024 queued realtime events, 256 drained per block, 2048 block parameter events, 1024 route events, 256 pending note-offs, 64 instrument routes, 192 sample voices, and 256 audio-clip voices. Callback admission no longer grows these containers. Excess sample/clip voices are rejected and counted; excess deferred note-offs are converted to an end-of-block note-off to avoid stuck notes; excess route/events are deterministically omitted and counted. In-budget behavior is unchanged.

Native saturation coverage proves exact queue capacity, nonzero rejection, cumulative counters, zero prepared-capacity violations, and detection when a deliberately oversized test block would require callback growth. The complete native suite passes in 6.57 s with 185,991,168-byte maximum RSS. Full non-native verification passes, and all 150 in-budget WAVs remain byte-identical to the A1 freeze.

The callback-safety counter detects known preallocation boundary violations; it is not yet a global malloc/lock/file-I/O interposer. That stronger detector and deferred shared-owner reclamation remain open.

## Milestone A5 master DC invariant — 2026-07-11

A fixed-state `MasterDcBlocker` now processes the audible master signal after the master chain and before the final limiter. It implements a 5 Hz first-order high-pass recurrence, recomputes its coefficient for the active sample rate, supports up to the engine's fixed 32-channel limit, suppresses denormals/non-finite output, and performs no callback allocation.

State persists across ordinary blocks for block-size equivalence. Explicit hard transport reset and project replacement clear it, preventing sub-audible filter decay from leaking across those lifecycle boundaries. Monitoring disable alone retains the physically correct bounded filter decay; the stress contract measures it below `1e-5` total energy rather than requiring an impossible instantaneous state disappearance.

Native tests cover 44.1/192 kHz coefficient ordering, one-second constant-signal rejection, stereo polarity, finite output, exact split/whole-block equality, monitoring decay, hard-stop silence, and project-replacement silence. Full native and non-native gates pass with only the existing TCC waiver. `BeatAetherBaseline` remains byte-identical because that isolated oscillator harness intentionally bypasses the production master chain; full-engine native render tests provide the DC-stage evidence.

## Milestone A6 explicit quality modes — 2026-07-11

`AudioQuality` defines explicit `standardLive` and `offlineHighQuality` modes. Standard Live remains the default for devices, ordinary offline engines, and all existing export entry points, so no render silently changes quality or semantics. Callers may explicitly select Offline HQ through `AudioEngine::setProcessingQuality()`.

The mode propagates to every existing and newly created `InstrumentVoice` and its legacy/A/B/unison wavetable oscillators. Offline HQ uses four-point Catmull-Rom sample interpolation inside each already selected frame/mip; frame selection, mip selection, phase delta, event offsets, parameter ramps, modulation evaluation, envelopes, and routing are identical to Standard Live.

Tests prove Standard Live remains the default and bit-stable, HQ is finite/bounded and audibly/numerically distinct on wavetable material, oscillator phase remains sample-exact between modes, and two full engines reach the exact same sequencer position. The full native suite passes with only the existing waiver. Offline HQ remains opt-in until a product-facing export-quality choice and performance gate are approved.

## Milestone A7 bounded table replacement and reclamation — 2026-07-11

`WavetableOscillator` now maintains independent current/previous immutable playback caches during replacement. A valid table change begins a 5 ms transition clamped to 32–512 samples; the first replacement sample is exactly the continuing old-table sample, then playback crossfades to the new table at the same phase, frequency, position, frame mix, and mip mix. Reapplying the same pointer is a no-op, and a newer replacement deterministically supersedes an in-flight one.

Each `InstrumentVoice` retains one retired `shared_ptr<const Wavetable>` for the legacy, A, and B stacks. Oscillators read raw immutable views, while retained owners guarantee lifetime through the transition. Ownership is bounded at current plus one retired table per stack. Production `setParams()` occurs during control-thread synth construction/replacement under the engine boundary; cache eviction and voice teardown likewise occur off the callback. A subsequent controlled replacement reclaims the prior retired owner only after its oscillator view has been superseded.

Tests cover exact first-sample continuity, bounded completion, repeated replacement during an active transition, finite output, same-pointer no-op behavior through existing note reconfiguration, and all prior frame/mip/quality invariants. Standard single-table renders remain unchanged.

This completes the planned Milestone A production foundation. A release-gate review still needs to assess the remaining global malloc/lock/file-I/O interposer limitation and product-facing Offline HQ selection before declaring the entire phase releasable.

## Milestone A8 callback heap-allocation proof — 2026-07-11

`BeatBackendStress` now links a test-only global C++ allocation interposer and enables it directly around one warmed, dense-modulation `AudioEngine::audioDeviceIOCallbackWithContext()` invocation. The probe records every ordinary, array, aligned, and nothrow `new` call without allocating in the recorder itself. It initially exposed 14 callback allocations: route-event sorting, route-automation `juce::String` slicing, a potentially growing parameter fallback, a callback-local MIDI buffer, and an owning sequencer callback wrapper.

Production corrections preserve DSP and event semantics: the callback MIDI buffer is prepared once; route events use bounded stable insertion ordering; effect IDs and parameter keys are compared as string regions without temporary strings; unknown route parameters are rejected instead of appended on the callback; and `Sequencer` accepts non-owning allocation-free callback views whose lifetime is limited to the synchronous render call. The dense callback probe now reports exactly zero heap allocations. Existing capacity/overflow telemetry remains active and no assertion was weakened.

The complete native stress executable passes with only `baseline.recent-project-exists` waived (7.26 s wall / 5.98 s user / 0.89 s system; 207,683,584-byte maximum RSS). `npm run verify:non-native` passes end-to-end, the production `Beat` and `BeatAetherBaseline` targets build, and the complete 150-WAV matrix is byte-identical to the A1/A7 freeze. The new report SHA-256 is `430bf90db6c2efd652eafa3b15408f8a51092cbe296b540ac8b83e6d47e3afd8`; the baseline run completed in 2.27 s wall / 2.17 s user / 0.06 s system with 15,613,952-byte maximum RSS, zero deadline overruns, and the unchanged queue result of 64 accepted / 16 rejected / 16 overflow.

This closes callback heap-allocation detection for the exercised dense core path. Arbitrary client-provided `onSegmentTriggered` or `onPositionChanged` callbacks remain external boundaries. OS/JUCE lock and file-operation interception is completed by the following A9 gate.

## Milestone A9 expanded realtime-safety instrumentation — 2026-07-11

The stress executable now links a development/test-only fixed-capacity realtime-safety probe. While explicitly active on the simulated device callback thread it intercepts all C++ `new` variants, `pthread_mutex_lock`, POSIX `open`/`openat`/`read`/`write`, and C `fopen`/`fread`/`fwrite`. A blocking lock violation is recorded only when a nonblocking try proves the mutex is busy; uncontended JUCE synthesiser acquisition retains its normal semantics. File and stream operations are forbidden whenever the probe is active. Every report is a thread-local write into a preallocated 128-entry array containing violation kind and return address; symbol resolution and diagnostic formatting occur outside the callback.

Compile-time hooks cover explicit lazy-initialization and container-growth boundaries. Production builds compile those hooks to no-ops. The callback's existing buffer-capacity check now emits a development-only container-growth violation in addition to durable production telemetry. Heap-backed lazy initialization is also caught by the allocator interposer, while the explicit lazy-init hook covers nonallocating initialization sites as the architecture expands.

Focused negative tests deliberately trigger and verify each category: non-elidable allocation, a mutex held by another thread, temp-file open/read, explicit lazy initialization, and explicit container growth. A prepared dense offline engine renders with the probe inactive, followed by an empty probe window, proving ordinary offline rendering is not classified as a real-time callback. The warmed dense device-callback simulation passes with zero violations across allocation, actually blocking locks, file operations, lazy initialization, and growth.

The full native suite passes with only `baseline.recent-project-exists` waived. Full non-native verification passes, production `Beat` and `BeatAetherBaseline` build, and all 150 WAVs are byte-identical to the A1/A7 freeze. Instrumentation report SHA-256 is `2fc02f1ba65191821360f5ccfcee237faa85155983fff60926930aacdb4d3935`; the matrix completed in 2.38 s wall / 2.17 s user / 0.05 s system with 15,450,112-byte maximum RSS and zero deadline overruns. No upstream code or dependency was introduced.

Per the approved review decision, the traced A8 boundaries were sufficient to complete Milestone A; A9 is the stronger prerequisite for the expanded Milestone B graph. External product callbacks remain explicitly outside Beat's internal guarantee and must themselves obey the same contract when installed.

## Milestone B1 oscillator A/B unison independence — 2026-07-11

Milestone B begins by removing the remaining shared static unison configuration from the two main oscillator contracts. New stable parameters `osc.a.unison.voices/detune/spread` and `osc.b.unison.voices/detune/spread` independently configure the already separate A/B wavetable banks and unison plans. Voice count is bounded to 1–8, detune to 0–100 cents, and spread to 0–1. Source, wavetable, tuning, phase/randomization, level, pan, and table ownership were already independent and remain unchanged.

Compatibility is explicit: patches without the six new fields inherit the existing shared `unison.voices/detune/spread` values. Existing frontend shared-unison controls write both oscillator parameter sets, while direct per-oscillator edits may diverge them. Draft normalization, preview conversion, native patch conversion, and reverse preview conversion preserve the new values; existing automation IDs are not renamed or removed.

Native contract coverage verifies A at 3 voices / 11 cents / 0.27 spread and B at 7 voices / 31 cents / 0.83 spread in one patch. Frontend coverage verifies legacy shared-value inheritance and the same divergent preview configuration. Full native stress passes with only the TCC waiver, full non-native verification passes, production Beat builds, and all 150 frozen baseline WAVs are byte-identical. Baseline JSON SHA-256 is `b6dfabee16c5b61bee82ddfb29e9a5a7ab3a6ef2cd504b502e293984b6e13b0b`.

This slice does not yet add per-oscillator FX sends, shared-filter routing, audio-rate cross-modulation, or separate unison modulation routes; those remain later B gates.

## Milestone B2 independent A/B unison modulation — 2026-07-11

Four stable modulation targets extend the B1 static contract: `osc.a.unison.detune`, `osc.a.unison.spread`, `osc.b.unison.detune`, and `osc.b.unison.spread`. Each route is evaluated only for its owning oscillator and added to the legacy shared unison route, preserving existing patches while allowing deliberate divergence. Detune remains clamped by the existing wavetable-bank plan in cents and spread by its existing bounded stereo plan.

The targets flow through frontend normalization/labels/preview, native patch conversion, activity flags, cached modulation planning, and the separate A/B renderer calls. Native tests verify distinct macro routes reach only A detune and B spread; frontend tests verify route admission and target summaries. The expanded A9 callback-safety test remains green because route state is prepared outside the callback and evaluation adds no allocation, file operation, lock contention, lazy initialization, or container growth.

Full native and non-native suites pass with only the TCC waiver, production Beat builds, and all 150 frozen WAVs remain byte-identical. B2 baseline JSON SHA-256 is `8a64d2389a2d4578e2cf6455d4a99f4b63ae647831b108791825f6c7e611ecce`.

Shared legacy targets remain supported and additive. Per-source filter/direct/FX routing and audio-rate oscillator cross-modulation remain open.

## Milestone B3 oscillator tuning modes — 2026-07-11

Oscillators A and B now independently select one of four explicit tuning contracts. `semitone` preserves the existing octave + semitone + fine-cent calculation bit-for-bit. `harmonic` multiplies the octave base by an integer harmonic 1–64; `ratio` applies a bounded positive numerator/denominator; and `step` applies an integer step in an equal division of the octave (1–96 divisions). Fine cents remain available in every mode and octave remains an independent coarse multiplier.

The persisted parameters are namespaced per oscillator under `osc.[a|b].tuning.*`. Defaults are semitone mode, harmonic 1, ratio 1/1, and step 0 of 12, so old documents and automation retain their prior result. Native and frontend conversion preserve all mode fields. Focused native tests verify semitone, harmonic, 3:2 ratio, and 7-of-19 step mathematics; frontend tests verify harmonic, ratio, and step round trips into preview state.

No lookup table, allocation, lazy initialization, or container mutation was added to the callback. Tuning selection is a cached setup-time pitch-rate calculation and remains compatible with the A9 realtime-safety gate.

Full native and non-native suites pass with only the existing TCC waiver, production Beat builds, and the 150 frozen WAVs are byte-identical to B2. B3 baseline JSON SHA-256 is `650cef36a89d84e52b360ecf78003ca910c595554ef0794b46766ee242b051bf`.

## Milestone B4 oscillator phase memory — 2026-07-12

Oscillators A and B now independently choose `retrigger` or `memory` phase behavior through stable `osc.[a|b].phaseMode` fields. Retrigger remains the default and preserves the existing explicit phase plus deterministic random-phase depth. Memory mode preserves each oscillator's phase across ordinary hard note boundaries and voice reuse instead of applying a new reset; A and B can select different modes.

Basic waveform paths now maintain separate A/B base accumulators rather than deriving both from the legacy shared phase. Wavetable stacks preserve every unison member's existing oscillator phase across setup reconfiguration in memory mode. Project replacement still creates/reset voices through the existing lifecycle, and legato continues its pre-existing no-reset path. Sample-rate preparation does not reset phase.

Native tests render both basic and wavetable sources, verify phase advances, prove exact preservation across stop/restart in memory mode, and prove retrigger mode returns the basic accumulator to zero. Native patch parsing and frontend preview/roundtrip tests cover the new mode. The implementation uses fixed stack arrays and existing oscillator state; no callback allocation, file operation, blocking wait, lazy initialization, or container growth is introduced.

Full native and non-native suites pass with only the existing TCC waiver, production Beat builds, and all 150 frozen WAVs are byte-identical to B3. B4 baseline JSON SHA-256 is `9e95a0611f7c4ca33158d6ab4fa7dd20df9da80e11cfc23ec4e26f15d5580b7f`.

## Milestone B5 dual shared-filter foundation — 2026-07-12

The voice engine now owns two prepared shared filter stages. Filter 1 is the existing filter and retains all stable parameters and modulation behavior. Filter 2 is opt-in with independent enabled, type, cutoff, resonance, and drive fields. `filter.routing` selects serial or parallel topology; serial feeds Filter 1 into Filter 2, while parallel processes the same pre-Filter-1 input through both branches and averages them for bounded gain.

Filter 2 state and oversampled drive state are prepared/reset with the voice lifecycle and never created in the callback. Disabled Filter 2 executes the original Filter-1 path without an additional arithmetic mix, preserving old renders. Native patch and frontend conversions preserve the new schema, and browser preview maintains an independent second filter state per channel.

Focused native tests verify parsing, bounded finite output, and distinct serial, parallel, and Filter-1-only renders. Frontend coverage verifies Filter 2 settings and topology reach preview state. Per-source selection between Filter 1, Filter 2, both, and direct remains the next routing slice.

The first complete non-native run exposed and retained a migration regression test: disabled Filter 2 cutoff was incorrectly sanitized from its Hz domain to `1`. The sanitizer now treats both filter cutoff IDs as 20–20,000 Hz, and the full roundtrip gate passes. Full native/non-native suites pass with only the existing TCC waiver, production Beat builds, and all 150 frozen WAVs are byte-identical to B4. B5 baseline JSON SHA-256 is `12d67613f247312e3cfdceb6bc69c1a46a5f0935e32af7869da1777153a1250a`.

## Milestone B6 per-source direct routing — 2026-07-12

Oscillator A, oscillator B, sub, and noise now independently select the stable `filter` or `direct` destination. `filter` remains the compatibility default. The stack renderer keeps one shared level normalizer, then publishes separate fixed stereo buses; the filtered bus follows the existing runtime-warp and Filter 1/Filter 2 path, while the direct bus receives an independent runtime-warp state and rejoins after both shared filters/drives but before the common amp, pan, and steal transition.

Focused native coverage proves filtered and direct buses can be nonzero simultaneously and recombine to the bounded compatibility frame. Patch parsing verifies all four route fields. Frontend normalization, reverse conversion, and preview use the same destinations; the existing default preview remains exactly RMS `0.05915262597409699`, peak `0.5288043022155762`.

Full native stress passes with only `baseline.recent-project-exists` waived, full non-native verification passes, and production `Beat` plus `BeatAetherBaseline` build. The 150-WAV matrix is byte-identical to B5; report SHA-256 is `48f94deb7d80373e3ee1ad5f9fdf162762bdad935e5f634a4289c7dc1e017d2c`, peak RSS is 15,335,424 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow. Filter-1-only, Filter-2-only, both-filter, and FX-send destinations remain later routing slices.

## Milestone B7 explicit filter destinations — 2026-07-12

Each Aether source now accepts `both`, `filter1`, `filter2`, or `direct`; legacy `filter` is retained as an alias for `both`. `both` follows the existing global serial/parallel topology. Explicit Filter 1 and Filter 2 destinations use isolated, preprepared filter/drive/runtime-warp state lanes, preventing a shared state object from being processed twice in one sample when sources choose different destinations.

Native tests prove all four renderer buses are independently populated, bounded, and recombine correctly; voice tests prove Filter-1-only and Filter-2-only renders are finite and audibly distinct. Frontend normalization and preview maintain corresponding isolated filter-state lanes. Default preview RMS/peak remain unchanged.

Full native stress passes with only the existing TCC waiver, full non-native verification passes, and production targets build. All 150 default-route WAVs are byte-identical to B6. B7 report SHA-256 is `1f3a4ddd44fb3117a326ec939a75267e23ede01d88aefcfad65cea0084a27125`; peak RSS is 14,860,288 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow. Per-source FX sends remain open.

## Milestone B8 dual serial runtime warp — 2026-07-12

Aether now exposes two independent serial runtime warp stages. Stage one retains `aether.runtimeWarp` and `aether.runtimeWarpMode`; stage two adds stable `aether.runtimeWarp2` and `aether.runtimeWarp2Mode` fields and defaults to zero, preserving every existing patch and render. Both stages use the existing bounded fold, pinch, mirror, and shape set and the existing two-point nonlinear evaluation/downsample state. Every source destination lane owns fixed stage-one and stage-two state, so filter/direct routing does not share nonlinear history.

Native coverage verifies patch conversion, project persistence, finite output, and a non-null audible delta between one and two enabled stages. Frontend normalization, reverse conversion, and preview apply the stages in the same order. The A9 callback probe remains at zero violations. This completes the two-stage architecture but does not invent an alias threshold: the existing oversampling stop-band/alias specification remains an explicit release-quality follow-up.

Full native and non-native suites pass with only the TCC waiver; production targets build; all 150 default-stage-two-off WAVs are byte-identical to B7. B8 report SHA-256 is `1d448e4477c529783952236a9478c40c41daa417ccff6b78cdf1bd6db42e60c4`, peak RSS is 15,089,664 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow.

## Milestone B9 eight-macro modulation surface — 2026-07-12

The stable macro surface expands from four to eight with `macro.5` through `macro.8`. Native value storage is a fixed eight-float array; every dynamic target carries fixed Macro 5–8 route amounts; evaluation remains a bounded straight-line calculation. The authoritative real-time parameter policy now contains 28 entries and exposes all eight macros with the same sample-accurate-control/caller-ramp contract.

Project persistence accepts old four-value arrays and zero-fills the new tail, while new documents preserve all eight values and route amounts. Frontend draft normalization, macro definitions, automation targets, modulation-matrix sources, preview evaluation, and node-editor validation expose the same IDs. Existing factory guide fallback routes remain limited to Macros 1–4, so normalization does not silently alter legacy preset sound; Macros 5–8 receive neutral definitions until deliberately routed.

Focused native tests verify Macro 8 evaluation, parsing, and all eight persistence values. Frontend tests verify Macro 5–8 normalization. Full native stress and A9 instrumentation pass with only the TCC waiver; full non-native verification and production builds pass; all 150 WAVs are byte-identical to B8. B9 report SHA-256 is `56493200ccbc425d1d670063fdd5fa376168a4ec9ba07ddba68258a695c02f37`, peak RSS is 15,155,200 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow.

## Milestone B10 four-envelope modulation foundation — 2026-07-12

Envelope 3 and Envelope 4 are now complete fixed voice modulation sources alongside the existing amp and mod envelopes. Each has stable ADSR, attack/decay/release curve, sustain, loop, bipolar-route, persistence, and preview fields. Their ADSR/loop state is prepared with the voice lifecycle; per-sample evaluation occurs only when cached route activity marks the source as needed. Envelope 1/2 behavior and timing are unchanged.

The new source values are threaded through every oscillator, unison, filter, drive, amp, and pan modulation target. Native patch and project persistence preserve envelope settings and route amounts. Frontend normalization, envelope editor summaries, modulation-matrix source selection, and browser preview support `env.3` and `env.4` with the same curve/loop semantics.

Focused tests verify Env 3/4 arithmetic, patch parsing, persistence, and frontend normalization. Full native stress including A9 passes with only the TCC waiver; full non-native verification and production builds pass; all 150 unrouted-default WAVs are byte-identical to B9. B10 report SHA-256 is `924758cfb2dcc1744c87dad5f7419717286f92cb846cfb93f035d56631d5cda8`, peak RSS is 13,189,120 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow.

## Milestone B11 ten-LFO modulation foundation — 2026-07-12

The modulation source surface now contains ten LFO slots. LFO 1/2 retain their legacy scalar fields and behavior. LFO 3–10 use fixed eight-slot configuration, phase, activity, raw-value, route-amount, and bipolar arrays, avoiding dynamic graph ownership and repetitive callback containers. Each extra slot supports enabled, waveform, rate, smoothing, random phase, phase offset, retrigger, and one-shot semantics.

Cached target activity and per-slot enablement jointly gate evaluation and phase advancement, so disabled or unrouted extra slots remain zero-work. Extra raw values are threaded through every oscillator, unison, filter, drive, amp, and pan target. Patch/project persistence and browser preview preserve the same stable `lfo.3` through `lfo.10` IDs. LFO 1/2 synchronization behavior is unchanged; tempo-sync fields for LFO 3–10 are intentionally not claimed in this foundation.

Focused coverage verifies LFO 10 arithmetic, parsing, persistence, rate sanitization, and frontend normalization. Full native stress including A9 passes with only the TCC waiver; full non-native verification and production builds pass; all 150 default-extra-LFO-disabled WAVs are byte-identical to B10. B11 report SHA-256 is `9f53f8ad5d6e3ab89d0dcfb0174c8f12c5db7d59b36b134b5ce94c63f9966bf9`, peak RSS is 14,925,824 bytes, deadline overruns are zero, and queue telemetry remains 64 accepted / 16 rejected / 16 overflow.

## Milestone B12 callback work ceilings — 2026-07-12

The fixed voice graph now has explicit structural callback ceilings of 16 modulation evaluations and 32 oversampled nonlinear evaluations per rendered voice sample. The modulation ceiling covers voice automation, the legacy LFO path, and all eight fixed extra-LFO slots with headroom for fixed graph bookkeeping. The nonlinear ceiling exactly covers four destination lanes through two serial warp stages at four evaluations per stereo lane. Saturating ceiling arithmetic prevents telemetry overflow. These are invariant limits: normal audio is never conditionally truncated or quality-degraded.

Voice telemetry now counts each active extra LFO and every executed runtime-warp lane. At the audio-engine block publication boundary, allocation-free atomic counters record modulation or nonlinear work that exceeds its structural ceiling. Native-to-frontend timing IPC exposes voice nonlinear work and cumulative overrun counts; the development timing panel displays them. Focused negative tests prove equality passes, one-unit excess fails, negative work fails, and multiplication saturates safely. The complete A9 callback-safety gate remains green and offline rendering remains outside callback instrumentation.

Full native stress passes in 8.23 s with only `baseline.recent-project-exists` waived. Full non-native verification passes. All 150 WAVs are byte-identical to B11. B12 baseline JSON SHA-256 is `ee404aa66fb3f93beb05d963fe3c44512fbc7723e65c29fb8ac4035f70ed56db`; the isolated matrix completed in 2.25 s wall / 2.16 s user / 0.06 s system with 15,286,272-byte peak RSS, zero deadline overruns, and 64 accepted / 16 rejected / 16 overflow queue events. No upstream code, dependency, or production DSP output change was introduced.

## Milestone B13 bounded A/B interaction — 2026-07-12

Oscillator A can now opt into two deliberately limited interactions with oscillator B: amplitude modulation and ring modulation. Amount zero/off remains the exact compatibility path. The interaction crossfades only oscillator A's existing contribution toward the interacted carrier, retains A's level/pan/destination, leaves B independently audible/routable, clamps the public amount to 0–1, rejects non-finite products, and adds no container or ownership work. The fixed nonlinear ceiling expands from 32 to 33 evaluations per voice sample: 32 for both warp stages across four lanes plus one A/B multiplication.

The current oversampling policy is explicit: A/B multiplication is not oversampled. A test-only 4096-point Hann/FFT fixture at 44.1 kHz deliberately drives a 7040 Hz carrier and third-harmonic modulator, whose 28160 Hz upper sideband folds to 15940 Hz. Measured alias-to-total energy is `0.0705697` for AM and `0.24735` for ring. These are captured baselines, not release-quality thresholds; the material ring-alias result keeps oversampling/stop-band design open before B release. Both modes remain finite across 44.1, 48, 88.2, 96, and 192 kHz.

Native patch conversion, project persistence, work accounting, mode-difference, finite/bounded output, five-rate, and spectral tests pass. Frontend normalization, reverse conversion, deterministic preview, and roundtrip tests pass. Full native stress passes in 8.51 s with only the TCC waiver; full non-native verification and production builds pass. All 150 default-off WAVs are byte-identical to B12. B13 baseline JSON SHA-256 is `c5cd84596e44b8638a2cd6d392fdc8b5e767abb203f0270c2038273f76a29b96`; the matrix completed in 2.26 s wall / 2.18 s user / 0.06 s system with 15,319,040-byte peak RSS, zero deadline overruns, and unchanged queue telemetry.

## Milestone B14 independent pressure and timbre sources — 2026-07-12

The fixed modulation matrix now exposes `pressure` and `timbre` as independent performance sources rather than mapping aftertouch to mod wheel. JUCE polyphonic aftertouch and channel pressure update the voice-owned normalized pressure value; MIDI CC74 updates the separate normalized timbre value; CC1 retains its existing mod-wheel value. Every dynamic target stores fixed pressure/timbre amounts and bipolar flags, and the values are evaluated through the existing bounded straight-line target calculation. The change does not add callback containers, allocation, ownership changes, lazy initialization, filesystem access, or locks.

Patch conversion, project persistence, native expression telemetry, IPC, browser MIDI parsing, modulation-matrix selection, editor activity summaries, factory-guide normalization, and deterministic preview all preserve the distinct source IDs. Native focused coverage verifies exact arithmetic/activity flags, channel and poly pressure, CC74, state clearing, patch conversion, repository roundtrip, and audible voice response. Frontend coverage verifies parsing/tracking, separate live status, normalization, persistence roundtrip, and that pressure/timbre preview offsets do not alias mod wheel or each other. This is a channel/poly-pressure and CC74 foundation, not a claim of complete MPE member-channel ownership or per-note pressure persistence.

Full native stress passes with only `baseline.recent-project-exists` waived; the unwaived run still exposes that assertion before the explicit waiver is applied. Full `verify:non-native` and production `Beat`, `BeatBackendStress`, and `BeatAetherBaseline` builds pass. All 150 default-unrouted WAVs are byte-identical to B13. B14 baseline JSON SHA-256 is `ea2f4e30eb4b2c4a802c542bcae531d1fc19e6a56fa3873a85ac5c66df8a5e06`; the normalized 150-file hash manifest is `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`. The matrix completed in 2.47 s wall / 2.16 s user / 0.07 s system with 15,466,496-byte process maximum RSS (14,958,592-byte harness-reported peak), zero deadline overruns, and unchanged 64 accepted / 16 rejected / 16 overflow queue telemetry. No upstream code or dependency was introduced.

## Milestone B15 LFO 3–10 tempo sync — 2026-07-12

LFO slots 3–10 now support the same explicit free-rate versus tempo-synced rate contract as LFO 1/2. Each fixed extra-LFO configuration persists `sync` and `syncedRate`; the compatibility default is sync off with the existing 1 Hz free rate. On project application, Beat converts the selected musical division to a bounded cycles-per-second value using the current sequencer tempo before publishing fixed voice parameters. The audio callback still advances each enabled/routed slot from one cached phase delta and performs no string parsing, division lookup, allocation, lock, file operation, lazy initialization, or container growth.

The shared native rate helper preserves quarter-note, dotted, and triplet mathematics and returns the exact stored free rate when sync is disabled. Native tests cover 60/120 BPM quarter-note rates, an eighth-note triplet, free-rate BPM invariance, patch parsing, project persistence, and a full `AudioEngine` render whose routed LFO 10 response changes with tempo. Frontend normalization, editor controls, labels, persistence roundtrip, and preview calculations use the same stable `lfo.3.sync/syncedRate` through `lfo.10.sync/syncedRate` IDs and verify both synced and free-rate behavior.

Full native stress passes with only the existing TCC waiver; full non-native verification and production builds pass. All 150 default-extra-LFO-disabled WAVs are byte-identical to B14. B15 baseline JSON SHA-256 is `6afccadd90b3db75663a89368bcc8d132289e68ebf8ab6408381297d444d23de`; the normalized render manifest remains `713ed72937dc82df0a0d845ebff1d48aee8a8d87ab4af877cabc895c6bee5ba5`. The matrix completed in 2.38 s wall / 2.17 s user / 0.07 s system with 15,859,712-byte process maximum RSS (15,384,576-byte harness-reported peak), zero deadline overruns, and unchanged queue telemetry. No upstream code or dependency was introduced.

## Milestone B16 fixed per-source FX buses — 2026-07-12

Aether now exposes two fixed source-send levels for each of oscillator A, oscillator B, sub, and noise. Each bus targets an explicit project return-bus ID, so effects remain shared route-owned processors rather than per-voice instances. The tap is the normalized source contribution after source level/pan and A/B interaction, before the shared filter/warp lanes; the voice envelope, velocity, amp level/pan, and an independent bounded steal transition are then applied. AudioEngine accumulates voice output into two route-owned, setup-preallocated stereo buffers, applies route gain/pan, and adds each buffer to its selected return before the existing return effect chain. Main stereo synthesis, instrument inserts, ordinary track sends, groups, and returns retain their existing ordering.

`AetherSourceBusContext` is a render-scope, non-owning thread-local pointer pair. It performs only bounded sample adds while JUCE synchronously renders the route synth; buffer ownership, sizing, clearing, and destruction remain in `AudioEngine`. Missing, muted, or deleted targets discard the auxiliary signal. Default send levels and target IDs are zero/empty, making existing documents and renders exact compatibility paths. Persistence, IPC, synth patch conversion, frontend draft normalization, oscillator controls, sub/noise controls, and project return selectors preserve the stable two-bus contract.

Focused native coverage proves an oscillator-A-only send creates a finite audible return delta and that a muted target is exactly dry; repository roundtrip coverage preserves all eight source levels and both target IDs. The warmed dense callback allocation/lock/I/O/lazy-init/growth gate remains green. Full native stress passes with only `baseline.recent-project-exists` waived, full non-native verification passes, and production `Beat`, `BeatBackendStress`, and `BeatAetherBaseline` build. All 150 default-off WAVs are byte-identical to B15. B16 baseline JSON SHA-256 is `1818c21ce8f655297e682158050c2ff9a4688df6951e3f52b8065e1ee80f8923`; a filename-normalized local render manifest is `f3d8c2fce88a0607d4f3c3043fef273617f999d9c38f1b1147327fbf73b8bba1` for both B15 and B16. The matrix completed in 2.29 s wall / 2.19 s user / 0.05 s system with 15,794,176-byte process maximum RSS (15,368,192-byte harness-reported peak), zero deadline overruns, and unchanged 64 accepted / 16 rejected / 16 overflow queue telemetry. No upstream code or dependency was introduced.

## Milestone B17 bounded effect-graph transitions — 2026-07-12

Instrument, group, and return routes now apply the existing 1.5 ms bounded stereo transition when a same-project apply changes effect order, bypass state, kind, identity, latency declaration, or ordered parameter values. Graph equivalence and transition arming happen on the project-application path while prepared route states are rebuilt. The audio path performs only fixed transition arithmetic and captures the final stereo route sample for a possible later bridge; it allocates no memory, grows no container, opens no file, initializes no processor, and introduces no new callback lock. A different project ID retains the established full-project reset behavior, while same-project effect edits no longer reset the master DC blocker.

Focused native coverage renders a sustained note through lowpass and saturator effects, then reorders the chain and bypasses the saturator under the same project ID. Output remains finite and audible, and the measured boundary step is `0.000371158`, below the explicit `0.2` regression ceiling. Existing schema-0 migration coverage for instrument, track, and return effects remains green; B17 adds no persisted field and therefore requires no schema version change. The bounded bridge intentionally starts from the last old graph output and does not keep the old processor graph alive to render its decay tail in parallel. Broader source/table/preset replacement fixtures and a product-ratified transition ceiling remain open.

Full native stress passes with only `baseline.recent-project-exists` waived, full non-native verification passes, and production `Beat` and `BeatAetherBaseline` builds pass. All 150 WAVs are byte-identical to B16. B17 baseline JSON SHA-256 is `c6b3ab19034bab5ee43222b4a869ab858f459fb31cdcbf938440183bc3b4692c`; the filename-normalized render manifest remains `f3d8c2fce88a0607d4f3c3043fef273617f999d9c38f1b1147327fbf73b8bba1`. The matrix completed in 2.50 s wall / 2.18 s user / 0.06 s system with 15,974,400-byte process maximum RSS (15,581,184-byte harness-reported peak), zero deadline overruns, and unchanged 64 accepted / 16 rejected / 16 overflow queue telemetry. Timing and RSS deltas are descriptive single-run measurements, not regressions. No upstream code or dependency was introduced.

## Milestone B18 deterministic member-channel expression state — 2026-07-12

`BeatSynthesiser` now retains channel pressure and MIDI CC74 timbre in fixed 16-channel atomic arrays, complementing JUCE's existing per-channel pitch-wheel retention. When a note starts, its `InstrumentVoice` receives the retained state for that exact channel before any audio is rendered. Active channel-pressure and CC74 messages continue through JUCE's channel-filtered voice dispatch, while polyphonic aftertouch remains filtered by both channel and note. A voice stolen from one member channel therefore begins with the destination channel's pressure, timbre, and pitch state rather than stale values from its previous owner. Unused channels start at zero, and rebuilding a project constructs a fresh synthesiser with zeroed caches.

The caches are fixed-size and use relaxed atomic loads/stores; they allocate no memory, grow no container, perform no I/O, and add no controller-path lock. Focused native coverage proves pre-note retention, independent state on channels 2 and 3, isolation of subsequent pressure/CC74 updates, note-specific poly-aftertouch, deterministic state after a cross-channel voice steal, and zero state on a previously unused channel. The complete warmed callback-safety gate remains green. This is a deterministic Aether member-channel foundation, not a claim of complete MPE: zone/master-channel negotiation, RPN pitch-range negotiation, capability exchange, persisted performance mapping, and pre-note expression initialization for non-Aether Nodemap voices remain open.

Full native stress passes with only `baseline.recent-project-exists` waived, full non-native verification passes, and production targets build. All 150 WAVs are byte-identical to B17. B18 baseline JSON SHA-256 is `2acb16e85a8845d7d91cc8a0033bdecd95e9f8e8db21181f1bcc1ad2ce8f21b1`; the filename-normalized render manifest remains `f3d8c2fce88a0607d4f3c3043fef273617f999d9c38f1b1147327fbf73b8bba1`. The resource-accounting matrix completed in 2.29 s wall / 2.17 s user / 0.09 s system with 15,646,720-byte process maximum RSS (15,089,664-byte harness-reported peak), zero deadline overruns, and unchanged 64 accepted / 16 rejected / 16 overflow queue telemetry. No upstream code or dependency was introduced.
