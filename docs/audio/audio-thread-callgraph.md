# Audio-thread call graph

Pinned revision: `062413553930fb102a81658063966c34500bf8a9`.

## Live device path

```text
JUCE audio device thread
  AudioEngine::audioDeviceIOCallbackWithContext
    consume transport commands and realtime-parameter SPSC queues
    apply queued voice/note automation
    Sequencer::render
      emit bounded trigger/automation callbacks into AudioEngine
    per instrument juce::Synthesiser::renderNextBlock
      JUCE voice allocation / stealing
      InstrumentVoice::renderNextBlock
        VoiceNoteAutomationState / RealtimeRamp advancement
        Lfo / DynamicModulation evaluation
        BasicOscillator or AetherTableStackRenderer
          WavetableOscillatorBank::render
            WavetableOscillator::setFrequency/setPosition/renderSample
        EnvelopeShaper / JUCE ADSR
        FilterStage / DriveStage / runtime warp
        VoiceRenderStats::recordBlock (relaxed atomics)
    sample-zone and audio-clip renderers
    per-route effects and routing accumulation
    MasterEq
    MasterLimiter
    live meter and loudness-state updates
    copy mix to device outputs / recording capture
```

## Offline path

```text
caller thread
  AudioEngine::renderProjectToWav or renderTrackToWav
    allocate output stream, AudioEngine, AudioBuffer, pointer vector
    AudioEngine::prepareForOffline
    applyProject / seek / play
    loop
      AudioEngine::audioDeviceIOCallbackWithContext
        same synthesis, routing, effects, limiter, and meter path as live
      quantize integer samples and write temporary WAV
    validate temporary WAV and atomically replace destination
```

Offline allocation and file I/O are outside a real-time device callback. There is no distinct high-quality DSP policy; live and offline use the same oscillator and nonlinear algorithms.

## Thread-boundary findings

| Boundary | Current mechanism | Audit status |
| --- | --- | --- |
| Project state to callback | Immutable/shared project snapshot | Strong design, but shared-owner destruction timing must be measured. |
| Transport commands | Fixed-capacity SPSC queue plus urgent atomic path | Bounded queue; overflow semantics are specialized and not unified with event telemetry. |
| Realtime parameters | Fixed-capacity SPSC queue | `push()` failure is returned to the caller; no durable overflow counter/report. |
| Note automation | Fixed-capacity inbox/state structures | Bounded data, but end-to-end saturation reporting is incomplete. |
| Wavetable data | Shared cached immutable table pointer per voice | Playback reads are allocation-free; replacement/destruction thread is not formally enforced. |
| Render telemetry | Relaxed atomic counters | Bounded, but counter traffic has cost and does not detect forbidden operations. |
| Meter publication | Engine-owned state/atomics | Separate analysis high-pass filters do not remove audible DC. |

## Operations requiring proof or redesign

- JUCE `Synthesiser::renderNextBlock` owns victim selection; replace it or interpose a deterministic Beat allocator before claiming deterministic steals.
- Audit every `setParams`, project-apply, cache-clear, effect-chain replacement, and sample-source replacement caller for `shared_ptr` destruction, vector growth, sorting, locks, lazy initialization, and file access.
- Add callback-scope instrumentation for allocations, blocking locks, file operations, deadline overruns, and queue overflow. Instrumentation must only update preallocated/atomic state in the callback.
- Bound all per-block iteration counts: instruments, voices, routes, effects, samples, modulation routes, grains, and future source slots.
- Defer heavyweight destruction and table/source replacement cleanup to a non-audio reclamation queue.

## Baseline-only test path

```text
BeatAetherBaseline (test executable, never called by Beat)
  WavetableFactory::createBasic
  WavetableOscillator::prepare / setFrequency / setPosition / renderSample
  block-matrix render loop
  JUCE FFT measurement
  deterministic WAV + JSON output
  local fixed-capacity RealtimeParameterQueue saturation probe
```

This path links existing production oscillator sources read-only. It does not change the live or offline call graph. It revealed that `WavetableOscillator::prepare()` can retain the 44.1-kHz phase delta when frequency remains numerically unchanged.

## Sample-rate preparation correction

```text
live AudioEngine preparation or AudioEngine::prepareForOffline(activeRate)
  InstrumentVoice::prepare(activeRate, blockSize)
    recompute voice phaseDelta = baseFrequencyHz / activeRate
    WavetableOscillator::prepare(activeRate)
      preserve phase
      recompute phaseDelta = frequencyHz / activeRate
      invalidate existing pitch-dependent frame cache
    prepare every main and A/B unison oscillator instance
    prepare envelopes and filters at activeRate
```

`BasicOscillator` is stateless and receives an explicitly rate-derived phase increment. The sub/noise paths using it therefore require no cached-coefficient invalidation. Live and offline use the same preparation propagation, and the focused test plus full matrix now cover all five supported rates. No callback topology or wavetable representation changed.

## Milestone A1 immutable wavetable path

```text
control/setup cache miss (non-playback path)
  WavetableFactory
    generate TimbralFrame[]
      generate ordered MipLevel[] harmonic caps
      remove DC and apply common per-frame normalization
    validate complete immutable Wavetable
  WavetableVoiceCache publishes shared_ptr<const Wavetable>
  InstrumentVoice retains stable shared owner

audio callback
  WavetableOscillator::setPosition(position)
    select adjacent timbral frames only
  WavetableOscillator::setFrequency(frequency)
    derive continuous harmonic budget from frequency/sample rate only
    select adjacent mip levels
  WavetableOscillator::renderSample
    interpolate sample phase × frame axis × mip axis
```

No table generation, mutation, allocation, or lock was added to oscillator playback. The oscillator caches four immutable sample pointers (two frames by two mip levels) plus two interpolation fractions. Replacement crossfades and explicit deferred reclamation remain a later A slice.

## Realtime parameter policy path

```text
queue/sequencer note or arrangement event
  stable parameter ID + value + caller rampSamples
  AudioEngine block event ordering
  InstrumentVoice::setRealtimeParameterValue
    ParameterPolicy lookup (constexpr linear table, no allocation)
      authoritative range clamp
      smoothing ownership / effective ramp length
      rate class and modulation eligibility metadata
    existing fixed VoiceRealtimeRampState
  per-sample active-ramp advancement
  apply value to oscillator/filter/amp/modulation state
```

The policy adds no callback allocation, lock, container growth, or string ownership. Lookup remains bounded at 24 constexpr entries. No render topology or timing semantics changed in this slice.

## Beat-owned steal path

```text
JUCE noteOn when all voices are active
  BeatSynthesiser::findVoiceToSteal
    inspect fixed voice array
    released -> quietest -> oldest -> stable voice ID
    InstrumentVoice::prepareForSteal (flag only)
  JUCE stopNote(false) / immediate startNote
    capture retained last stereo output
    reset ordinary note DSP state
    VoiceTransition::beginFrom(last output)
  render replacement note
    first sample equals prior victim output
    bounded 1.5 ms linear handoff to new note
```

Selection scans the preallocated JUCE voice array and performs no sorting, temporary container growth, allocation, or lock beyond JUCE's existing synthesiser callback lock. Ordinary hard stops reset transition state and cannot affect a later unrelated note.

## Telemetry and budget boundaries

```text
producer queue admission
  accepted/rejected cumulative atomics
audio callback
  verify prepared buffer capacity before setSize
  drain <= 256 realtime events
  admit only within fixed block/route/note-off/voice/clip capacities
  count every overflow/rejection
  render and publish existing bounded work counters
  compare total callback ticks with block deadline
  publish cumulative safety/deadline/overflow counters
```

Overload does not trigger container growth or automatic quality reduction. Each admission limit has deterministic behavior, and normal in-budget render hashes are unchanged.

## Master DC stage

```text
route/group/return mix
  master EQ/compressor/bitcrush chain
  MasterDcBlocker (5 Hz, persistent fixed per-channel state)
  MasterLimiter
  meters/analyzer/output copy
```

The blocker is prepared outside the callback and reset only at explicit hard-stop/project-replacement boundaries. It adds one fixed recurrence per channel/sample and no allocation or dynamic dispatch.

## Quality-mode branch

```text
AudioEngine quality selection (setup/control path)
  propagate enum to fixed InstrumentVoice set
  propagate to main/A/B/unison wavetable oscillators
audio callback
  identical event/modulation/phase path
  Standard Live: linear phase-sample interpolation
  Offline HQ: four-point Catmull-Rom phase-sample interpolation
  identical frame/mip crossfades and phase advancement
```

Mode selection is not data-dependent and never changes automatically under load.

## Table replacement lifetime path

```text
control-thread replacement
  build/find complete immutable new table
  move current shared owner -> one bounded retired owner
  publish new raw immutable view to oscillator
audio callback
  retain old/new playback caches
  first sample continues old table exactly
  crossfade old -> new for bounded 5 ms at identical phase/timing
  drop old raw view when transition completes
later control replacement or voice teardown
  reclaim retired shared owner off callback
```

Same-table note reconfiguration does not restart a transition. Repeated replacement supersedes the earlier transition without accumulating owners or queues.

## Callback allocation-proof path

```text
BeatBackendStress setup (test thread)
  prepare dense Aether engine and all fixed callback buffers
  warm four complete callbacks
  queue one sample-offset realtime parameter change
  enable test-only global new/new[] interposer
AudioEngine::audioDeviceIOCallbackWithContext
  clear preallocated callback MIDI storage
  collect bounded events into reserved vectors
  stable in-place route-event ordering
  allocation-free route target/key region matching
  Sequencer::render via synchronous non-owning callback views
  render voices/routes/master/analyzer and publish telemetry
  zero observed C++ heap allocations
  disable probe
```

The callback continues to use `ScopedTryLock` for the engine project-state boundary, so contention skips the guarded render path instead of blocking there. The A9 test interposer probes JUCE's internal pthread mutex with `trylock`: an uncontended acquisition proceeds, while an acquisition that would wait is recorded before normal semantics continue. POSIX/C file and stream calls are likewise intercepted while the realtime scope is active. Product callbacks (`onSegmentTriggered`, `onPositionChanged`) remain external code boundaries.

```text
test-only realtime scope (device callback simulation only)
  C++ new/new[] -> record heapAllocation
  pthread_mutex_lock
    try succeeds -> proceed without violation
    try reports busy -> record blockingLock, then preserve normal wait semantics
  open/openat/read/write/fopen/fread/fwrite -> record fileOperation
  explicit lazy-init/growth hooks -> record typed violation
  fixed thread-local event array (128 entries, kind + return address)
scope ends
  symbolize/report outside callback

offline render
  no realtime scope -> no interception reports
```

## Milestone B1 independent A/B unison configuration

```text
patch/control path
  legacy shared unison fields -> inherited by A and B when per-osc fields are absent
  osc.a.unison.* -> A WavetableConfig -> aetherOscillatorsA + unisonPlanA
  osc.b.unison.* -> B WavetableConfig -> aetherOscillatorsB + unisonPlanB
audio callback
  render oscillator A with A's fixed bank/plan
  render oscillator B with B's fixed bank/plan
  sum through existing independent level/pan path
```

No callback parsing, allocation, or graph mutation is added. Parameter normalization and migration occur on the existing control/setup boundary.

```text
modulation setup
  legacy unison.detune/spread -> shared target state
  osc.a.unison.detune/spread -> A-only target state
  osc.b.unison.detune/spread -> B-only target state
audio callback
  A unison offsets = shared + A-only
  B unison offsets = shared + B-only
  existing bounded A/B unison plans render independently
```

```text
voice setup / parameter refresh
  A tuning mode + fields -> cachedPitchRates.oscA
  B tuning mode + fields -> cachedPitchRates.oscB
audio callback
  base note frequency * cached oscillator rate
  optional existing fine modulation
  unchanged oscillator phase advance/render path
```

```text
note start
  phaseMode=retrigger
    A/B basic accumulator -> 0
    A/B wavetable members -> configured phase + deterministic jitter
  phaseMode=memory
    preserve A/B basic accumulator
    snapshot fixed A/B wavetable member phases
    configure table/rate state
    restore member phases
render
  advance independent A/B base accumulators
  wavetable members advance their existing internal phases
```

```text
shared source mix
  Filter 1 drive -> Filter 1
  Filter 2 disabled -> existing output unchanged
  Filter 2 enabled, serial
    Filter 1 output -> Filter 2 drive -> Filter 2 -> amp
  Filter 2 enabled, parallel
    pre-Filter-1 input -> Filter 2 drive -> Filter 2
    bounded average(Filter 1, Filter 2) -> amp
```

Both filter and drive states are prepared outside the callback. Topology selection is a fixed per-sample branch with no graph mutation or dynamic ownership.

```text
A/B/sub/noise render
  route=filter -> normalized filtered stereo bus
  route=direct -> normalized direct stereo bus
filtered bus -> runtime warp -> Filter 1 / optional Filter 2 topology
direct bus -> independent runtime warp -> bypass shared filter drives and filters
filtered + direct -> common amp/pan -> steal transition -> voice output
```

Route values are parsed and copied on the setup boundary. Both buses and runtime-warp states are fixed voice members; callback routing performs no allocation, ownership change, lazy initialization, file operation, or container growth.

```text
route=both (or legacy filter) -> existing shared serial/parallel Filter 1 + Filter 2 topology
route=filter1 -> isolated prepared Filter 1 drive/state lane
route=filter2 -> isolated prepared Filter 2 drive/state lane
route=direct -> bypass filters
all destination outputs -> common amp/pan/steal transition
```

The isolated lanes share parameter values, not mutable DSP state. They are configured with the voice lifecycle outside the callback and preserve the A9 zero-violation gate.
