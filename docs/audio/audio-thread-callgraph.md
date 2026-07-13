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

```text
each Aether destination lane
  runtime warp stage 1 (optional, prepared state)
  -> runtime warp stage 2 (optional, separate prepared state)
  -> selected filter/direct destination
```

Both stages are fixed branches over voice-owned state. Stage-two amount zero is an exact bypass/reset path and adds no ownership or graph mutation.

```text
setup/persistence -> fixed macroValues[8] + fixed route amounts per target
audio callback -> targetOffset(...)
  existing LFO/envelope/performance terms
  + sum(macroValues[0..7] * target.macro1..macro8)
```

Macro expansion changes fixed object size only. Route parsing, metadata construction, and container work remain outside the callback.

```text
voice setup -> ADSR/curve/loop state for Env 1..4
cached target activity -> needsEnv2/needsEnv3/needsEnv4
audio callback
  Env 1 always drives amp lifecycle
  Env 2..4 evaluate only when routed
  targetOffset receives Env 1..4 values through every supported target
```

All four envelopes use voice-owned fixed state. No route parsing, allocation, lock, file operation, lazy initialization, or container growth occurs in the callback.

```text
setup -> LFO 1/2 legacy fields + fixed extraLfos[8]
target cache -> per-source activity for LFO 1..10
audio callback
  for each LFO 3..10: enabled && routed -> evaluate + advance fixed phase
  rawExtraLfos[8] -> fixed target route arrays -> targetOffset
```

No extra-LFO vector, lookup map, or callback graph mutation is introduced. Disabled/unrouted slots do not evaluate or advance.

```text
InstrumentVoice::renderNextBlock
  fixed modulation sources -> VoiceStats::modulationSamples
  four fixed destination lanes x two optional warp stages
    -> VoiceStats::nonlinearSamples
AudioEngine block publication
  compare accumulated work with saturating structural ceilings
  -> atomic modulationWorkBudgetOverruns / nonlinearWorkBudgetOverruns
MessageBridge -> frontend timing store/debug panel
```

The comparison and reporting path performs only integer arithmetic and relaxed atomic operations in the callback. A ceiling trip reports an invariant violation; it does not branch the audio path, allocate, lock, perform I/O, or lower quality. Offline renders are not treated as real-time callback violations.

```text
fixed Oscillator A sample + fixed Oscillator B sample
  interaction off/amount 0 -> exact existing A contribution
  AM -> A * (0.5 + 0.5 * B)
  ring -> A * B
  amount crossfade -> A level/pan/source destination
  -> existing route warp/filter/direct graph
```

The interaction adds one bounded multiplication evaluation per active voice sample and no state allocation. It is counted against the 33-evaluation nonlinear ceiling. Current processing is at the active sample rate without oversampling; measured high-note alias is recorded in `current-engine-audit.md`.

## Milestone B14 pressure and timbre modulation path

```text
MIDI input / scheduled MIDI buffer
  poly aftertouch -> JUCE voice aftertouchChanged(note value) -> voice pressure
  channel pressure -> JUCE voice channelPressureChanged(value) -> voice pressure
  CC74 -> InstrumentVoice::controllerMoved -> voice timbre
  CC1 -> existing voice modWheel
InstrumentVoice::renderNextBlock
  pressure + timbre + existing fixed sources
  -> DynamicModulation::targetOffset
  -> existing oscillator/unison/filter/drive/amp/pan targets
```

Pressure and timbre are normalized scalar voice state and fixed route fields. MIDI dispatch uses JUCE's existing prepared synthesiser path; target evaluation adds two bounded multiply-add terms and no callback allocation, lock, file operation, lazy initialization, or container growth. `AudioEngine` also publishes non-audio expression activity through pre-existing MIDI-input monitoring state and `MessageBridge`; that UI telemetry is not used to render the audio callback. Browser preview accepts explicit pressure/timbre inputs for deterministic route visualization. Offline rendering is not classified as a real-time callback by the A9 detector.

## Milestone B15 LFO 3–10 tempo preparation

```text
project/patch setup
  extra LFO sync + musical division + sequencer BPM
  -> Lfo::effectiveRateHz (setup thread)
  -> fixed InstrumentVoice::Params::ExtraLfo.rateHz
InstrumentVoice::refreshCachedPitchRates (non-callback parameter boundary)
  -> fixed extraLfoPhaseDeltas[8]
audio callback
  enabled && routed slot -> phase += cached delta -> fixed target evaluation
```

Musical-division strings are parsed only while copying project state into prepared voice parameters. The callback sees the same bounded scalar phase-delta path for free and synced modes. Disabled or unrouted extra slots retain the B11 zero-evaluation behavior.

## Milestone B16 fixed Aether source-send buses

```text
AudioEngine::rebuildSampleInstruments (setup thread)
  allocate two fixed stereo sourceFxBuffers per instrument route
  copy two persisted return-bus IDs
audio callback, per instrument route
  clear fixed sourceFxBuffers
  AetherSourceBusContext::ScopedTargets (non-owning TLS pointers)
    BeatSynthesiser::renderNextBlock
      InstrumentVoice::renderNextBlock
        AetherTableStackRenderer sourceFrames[A, B, sub, noise]
        fixed source send gains -> voice amp/envelope/pan
        bounded per-bus steal transition
        addSample into sourceFxBuffers
  addAetherSourceSendsLocked
    route gain/pan -> selected prepared returnBuffer
  existing main route effects/sends/group or mix path
processReturnBusesLocked
  shared return effects -> master mix
```

The callback owns no auxiliary allocation, resizing, lookup container, effect instance, file operation, or destruction. The only target lookup scans the already bounded prepared return-state vector, matching the pre-existing track-send policy. Empty, muted, or missing target IDs produce no return contribution. Offline rendering traverses the same deterministic audio path but remains outside the real-time callback detector.

## Milestone B17 bounded effect-graph transitions

```text
AudioEngine::applyProject / rebuildSampleInstruments (setup boundary)
  compare ordered prepared effect descriptors for matching route IDs
  changed same-project graph -> arm fixed 1.5 ms transition from last route output
  different project ID -> retain full-project reset semantics
audio callback, instrument/group routes
  processRouteEffectsLocked
  processEffectGraphTransitionLocked
    inactive: capture final stereo sample only
    active: fixed per-sample stereo bridge arithmetic
  meter/sends/group-or-master accumulation
audio callback, return routes
  processRouteEffectsLocked
  processEffectGraphTransitionLocked
  master accumulation
```

Graph comparison, vector traversal, and route-state publication stay outside the callback. The callback transition owns no dynamic storage and performs no effect construction, destruction, sorting, filesystem access, lazy initialization, or container growth. It bridges from the last output sample of the retired graph; it does not process the retired graph in parallel or preserve its effect tail. Offline rendering uses the same deterministic signal path but remains outside real-time callback instrumentation.

## Milestone B18 member-channel expression ownership

```text
MIDI channel pressure / CC74
  BeatSynthesiser fixed atomic cache[channel]
  JUCE channel-filtered active-voice dispatch
MIDI polyphonic aftertouch
  JUCE channel-and-note-filtered active-voice dispatch
MIDI note-on(channel, note)
  JUCE starts or deterministically steals a voice with cached pitch wheel
  BeatSynthesiser matches the started InstrumentVoice by channel and note
  apply cached channel pressure + CC74 before rendering
InstrumentVoice::renderNextBlock
  fixed pressure/timbre scalar sources -> bounded modulation target evaluation
```

Pressure/timbre cache storage is exactly two 16-element atomic float arrays; B19 adds the separately documented fixed RPN arrays below. Controller ingestion performs no allocation, container growth, file access, lazy initialization, or additional lock acquisition. Note-on matching traverses the already bounded prepared JUCE voice array under the synthesiser's existing critical section. Project rebuilds replace the synthesiser and therefore reset all member-channel caches outside the callback.

## Milestone B19 channel pitch-range negotiation

```text
MIDI CC101/100(channel) -> fixed RPN selector[channel]
MIDI CC6/38(channel), when RPN == 0,0
  -> fixed coarse/fine pitch-range state[channel]
  -> bounded active InstrumentVoice scan under existing synth lock
  -> setMemberPitchBendRange -> recompute from cached current wheel
MIDI RPN null 127,127 -> deselect; later Data Entry ignored
MIDI note-on(channel)
  JUCE applies retained channel pitch wheel
  BeatSynthesiser applies retained RPN range for that channel
```

The selector, coarse/fine values, and effective range are fixed 16-channel atomic arrays. The MIDI/controller path owns no dynamic storage and performs no allocation, file access, lazy initialization, or container growth. Unconfigured channels preserve the saved patch bend range and legacy clamp; project rebuild resets negotiated state with the synthesiser outside the callback.

## Milestone B20 explicit member-expression zone

```text
project/synth-patch setup
  schema-v1 zone { enabled, master, first member, last member }
  normalize bounds; reject overlap/future schema
  AudioEngine::createInstrumentSynth
    -> BeatSynthesiser::configureMemberExpressionZone
MIDI master channel (zone enabled)
  CC1 / CC74 / channel pressure / pitch wheel
  -> update fixed state for each configured member channel
  -> JUCE channel-filtered dispatch to active member voices
MIDI member channel
  -> update and dispatch only that channel
MIDI outside zone
  -> ordinary channel-local dispatch; no master broadcast
```

Zone configuration and validation occur while constructing the prepared synthesiser. Callback work is a fixed loop over at most 15 channel numbers plus JUCE's already bounded prepared voice scans. Storage is fixed atomic channel state; the path performs no allocation, resizing, sorting, file access, lazy initialization, or processor construction/destruction. The zone is default-off, so existing projects retain the pre-B20 path and output.

## Milestone B21 legacy RPN 6 zone negotiation

```text
MIDI CC101/100(channel) -> fixed RPN selector[channel]
MIDI CC6(channel), when RPN == 0,6
  channel 1 + count 1..15 -> lower zone { master 1, members 2..1+count }
  channel 16 + count 1..15 -> upper zone { master 16, members 16-count..15 }
  count 0 -> clear only the zone owned by that manager
  other manager/count, RPN null, or CC38 -> no zone change
subsequent manager expression
  -> existing B20 fixed member loop and channel-filtered dispatch
project rebuild
  -> saved schema-v1 zone is prepared again; runtime RPN state is not persisted
```

RPN selection and interpretation use existing fixed 16-channel atomic selector arrays. The active zone is fixed-size scalar state and replacement is constant work; expression propagation remains bounded to 15 channel numbers. The path adds no allocation, container growth, filesystem or stream operation, lazy initialization, processor ownership, or lock acquisition. Offline rendering may consume the same MIDI semantics but remains outside the real-time callback detector. MIDI-CI profile exchange, simultaneous lower+upper zones, automatic MCM pitch-range defaults, and non-Aether initialization are outside this slice.
