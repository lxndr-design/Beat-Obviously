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
    apply normalized export quality (default Standard; optional Offline HQ)
    applyProject / seek / play
    loop
      AudioEngine::audioDeviceIOCallbackWithContext
        same synthesis, routing, effects, limiter, and meter path as live
      quantize integer samples and write temporary WAV
    validate temporary WAV and atomically replace destination
```

Offline allocation and file I/O are outside a real-time device callback. Standard uses the live oscillator policy. An explicit Offline HQ export changes only the prepared wavetable interpolation policy; interaction oversampling remains the same measured fixed 2x policy in both modes. Event, modulation, phase, routing, effects, limiter, and meter paths remain shared.

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
  -> Lumus route only, when schema v7 arpeggiator is enabled
     -> fixed held-note/channel/velocity arrays
     -> step samples from active sample rate + atomic sequencer tempo/speed
     -> pre-sized route MIDI output with sample-offset gate events
     -> no separate clock, file access, lock, or lazy initialization
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

## Milestone B28 export quality selection

```text
Export Review quality field (UI thread)
  -> normalized optional ProjectExportOptions.quality
  -> synchronous/async project, range, track, stems, or bounce IPC
  -> MessageBridge::parseExportRenderOptions (unknown -> Standard)
  -> AudioEngine::render*ToWav final quality argument (default Standard)
  -> prepareForOffline
  -> setProcessingQuality
  -> applyProject
  -> existing offline render loop
```

The selection is setup-only and never enters the device callback. It does not mutate the live engine, project schema, automation IDs, event timing, or overload policy.

## Milestone B release review

The release review adds no production or test call-graph edge. It accepts the graphs documented above as the implementation under review and keeps Milestone C blocked pending the two human policy decisions in `milestone-b-release-report.md`.

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

At B13 the interaction added one base-rate multiplication per active voice sample against a 33-evaluation nonlinear ceiling. B27 supersedes that edge with two fixed source-rate evaluations and a 34-evaluation ceiling; the current production path is detailed below and its measured alias is recorded in `current-engine-audit.md`.

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

RPN selection and interpretation use existing fixed 16-channel atomic selector arrays. The active zone is fixed-size scalar state and replacement is bounded work; expression propagation remains bounded to 15 channel numbers. The B21 mapping adds no allocation, container growth, filesystem or stream operation, lazy initialization, or processor ownership. B22 below adds a bounded active-voice update under the synthesiser's existing critical section and directly probes that path for blocking. Offline rendering may consume the same MIDI semantics but remains outside the real-time callback detector. MIDI-CI profile exchange, simultaneous lower+upper zones, and non-Aether initialization remain outside the current implementation.

## Milestone B22 independent MPE pitch paths

```text
RPN 0,6 accepted
  fixed manager range = 2 semitones
  fixed negotiated member ranges = 48 semitones
  bounded active-voice scan applies ranges and retained manager wheel
member pitch wheel(channel)
  JUCE/Beat fixed channel cache -> InstrumentVoice member semitone offset
manager pitch wheel(master)
  Beat fixed manager cache -> bounded active-member scan
  -> InstrumentVoice manager/global semitone offset
member note-on / deterministic steal
  JUCE starts voice with retained member wheel
  Beat applies retained member range + retained manager wheel/range
InstrumentVoice::renderNextBlock
  base pitch * exp2((member semitones + manager semitones) / 12)
zone clear/replacement
  bounded retired-member scan -> clear manager offset only
```

Both pitch offsets and all ranges/caches are fixed scalar or 16-channel state. The MCM path performs bounded channel/voice scans under the synthesiser's existing critical section and adds no ownership, allocation, resize, sort, filesystem access, lazy initialization, or processor construction. A focused development/test probe exercises RPN 6 ingestion and reports zero allocation, blocking-lock, file/stream, lazy-init, or growth violations. Offline rendering remains excluded from real-time callback classification.

## Milestone B23 product MPE controls

```text
SynthEditor MPE switch/channel inputs (UI thread)
  -> existing stable aether.mpe.* draft fields
  -> overlap validation disables invalid saved zone
Apply/Save
  -> existing synthDraftToInstrumentPatch / project persistence
  -> AudioEngine project-application setup
  -> BeatSynthesiser::configureMemberExpressionZone
audio callback
  -> unchanged B20-B22 fixed zone/expression paths
```

The controls add no IPC message, persisted schema, callback branch, container, or DSP state. All validation and draft edits run on the frontend/UI path; the existing project-application boundary remains the only route into prepared native state.

## Milestone B24 oscillator tuning/phase controls

```text
OscillatorPanel tuning/phase controls (UI thread)
  -> existing osc.{a,b}.tuning.* / phaseMode draft fields
Apply/Save
  -> existing synthDraftToInstrumentPatch / project persistence
  -> existing SynthPatchContract::applyOscillator
  -> InstrumentVoice prepared parameter state
audio callback
  -> unchanged B3 tuning and B4 phase lifecycle paths
```

The controls add no parameter ID, IPC message, schema branch, callback work, container, ownership, or DSP behavior. Mode-dependent field visibility is entirely frontend state projection.

## Milestone B25 phase lifecycle fixture

B25 adds no production call-graph edge. The native test invokes the existing `BeatSynthesiser::noteOn` -> deterministic victim selection -> `InstrumentVoice::prepareForSteal` -> `InstrumentVoice::startNote` path and the existing direct legato `InstrumentVoice::startNote` retune path, then observes test-only phase and output accessors. The audio callback and offline-render graphs are unchanged.

## Milestone B26/B27 interaction oversampling

```text
InstrumentVoice::prepare / setProcessingQuality / startNote (non-render setup)
  -> prepare duplicate A/B oscillator banks at 2x
  -> prepare fixed low-pass coefficients and synchronize note phases
InstrumentVoice::renderNextBlock (active AM/ring and amount > 0 only)
  -> AetherTableStackRenderer::render
  -> duplicate A/B source render (2 fixed subsamples)
  -> AetherInteractionStage::State::process
  -> AM/ring multiplication
  -> 3 prepared fixed biquad sections
  -> replace only oscillator A interaction contribution
  -> exact oscillator/unison/nonlinear work counters
```

Interaction off or amount zero bypasses this edge exactly. Standard Live and Offline HQ both use the measured 2x source-rate policy. The callback path owns only fixed oscillator arrays, plans, filter history, and scalar work counters; preparation computes coefficients and configures table handles before rendering. The warmed production path passes the allocation/lock/file/lazy-init/growth detector. Offline export uses the same render edge but remains correctly excluded from real-time callback classification.

## Milestone B29 benchmark factory presets

```text
frontend factory bank load
  -> createFactorySynthPresetsFromGuide
  -> createFactorySynthPresetFromGuide
  -> normalizeSynthDraftPatch
  -> existing preset selection / synthDraftToInstrumentPatch
  -> existing backend SynthPatchContract application
```

B29 adds two data records to the existing factory-load path. It adds no callback branch, allocation site, file operation, lock, container growth, lazy initialization, native schema, or DSP function. Preset selection continues through the already-audited patch application boundary; the audio callback graph is unchanged.

## Milestone C1 source-slot foundation

```text
setup/control thread
  -> construct already-decoded ImmutableSampleSource
  -> SampleSourceSlot::publish (only while inactive)
  -> SourceSlotRack::attach (three fixed non-owning positions)
  -> SourceSlotRack::prepare
       -> SampleSourceSlot::prepare
       -> precompute 128 pitch-rate entries and release length

future audio callback integration boundary (focused native fixture today)
  -> SourceSlotRack::noteOn(slot, event)
       -> fixed 16-voice search; accept or reject with telemetry
  -> SourceSlotRack::render
       -> fixed three-slot loop
       -> SampleSourceSlot::render
            -> fixed voice array
            -> linear sample interpolation
            -> equal-power pan, bounded release, source-end fade
            -> preallocated scalar telemetry
```

The C1 code is compiled into the native target surface and exercised through BackendStress, but is not yet connected from AudioEngine, project/preset persistence, or the Aether product UI. The tested render boundary performs no ownership mutation, allocation, blocking lock, file access, lazy initialization, or container growth. Offline callers may use the same deterministic render contract without being classified as a real-time callback.

## Milestone C2A Slot 1 production connection

```text
control/setup thread: AudioEngine::applyProject
  -> AudioEngine::rebuildSampleInstruments
       -> resolve project AudioFileAsset
       -> AudioFormatReader decode / existing loadedBufferCache
       -> immutable alias retaining SampleBuffer lifetime
       -> AudioEngine::createInstrumentSynth
            -> InstrumentVoice::prepare
                 -> SampleSourceSlot::prepare (pitch table/release length)
            -> InstrumentVoice::setParams
                 -> SampleSourceSlot::publish (inactive voice only)

live callback or offline engine: BeatSynthesiser::renderNextBlock
  -> InstrumentVoice::startNote
       -> SampleSourceSlot::noteOn (fixed voice array)
  -> InstrumentVoice::renderNextBlock
       -> SampleSourceSlot::renderFrame
       -> selected normal-filter / Filter 1 / Filter 2 / Direct lane
       -> existing envelope, amp/pan, steal transition and route effects
  -> InstrumentVoice::stopNote
       -> bounded SampleSourceSlot release or immediate clear
```

Offline rendering follows the same graph but is excluded from real-time callback instrumentation. Missing assets publish no source and render silence. Slot identity changes are detected while rebuilding route state and arm the existing bounded `effectGraphTransition` from the previous route output; no old sample owner is destroyed by the callback.

## Milestone C2B Slot 1 slice/loop edge

Setup and persistence remain outside the callback:

```text
synth patch v1/v2 -> normalizeSynthDraftPatch -> v3 full-range/loop-off defaults
MessageBridge / ProjectRepository -> AetherSampleSlot v2 -> AudioEngine::applyProject
decoded cache alias -> ImmutableSampleSource normalized bounds
  -> SampleSourceSlot::publish
       -> rebuildPlaybackRegion (integer bounds + maximum 64-sample seam)
```

The live callback remains fixed-work:

```text
InstrumentVoice::renderNextBlock
  -> SampleSourceSlot::renderFrame
       -> cached slice-end test or cached loop wrap
       -> one linear interpolation per channel normally
       -> at most two per channel inside the bounded loop seam
  -> existing Filter / Filter 1 / Filter 2 / Direct lane
```

Invalid loop bounds clear only looping. Offline rendering follows the same voice edge but remains excluded from real-time callback interception. Slice/loop identity changes enter the existing bounded route replacement bridge; no file decode, range validation, allocation, ownership destruction, or container growth occurs on the callback.

## Milestone C2C mapped-zone edge

```text
control/setup: patch/project zone array (maximum 8)
  -> AudioEngine decoded project-asset cache lookup
  -> ImmutableMappedSampleSource fixed array
  -> MappedSampleSourceSlot::publish
       -> eight fixed SampleSourceSlot children prepared/published

callback note-on
  -> MappedSampleSourceSlot::selectZone
       -> at most eight key/velocity comparisons
       -> narrowest combined span; stable order tie-break
  -> exactly one SampleSourceSlot::noteOn

callback render
  -> MappedSampleSourceSlot::renderFrame
       -> fixed published-zone scan
       -> child C2B slice/loop renderFrame
  -> existing Aether routing/envelope/transition graph
```

Missing assets and malformed/future state are resolved before publication. The callback performs no decode, path access, allocation, container mutation, ownership destruction, or lock acquisition. Offline rendering uses the identical selection/render edge but is excluded from real-time interception.

## Milestone C2D mapped-zone editor edge

```text
Solid editor NumberInput / Toggle
  -> immutable zone patch in synth draft metadata
  -> existing schema-v4 normalization and project conversion
  -> existing C2C setup/publication edge
```

Slice endpoint edits clamp the draft's loop endpoints before normalization; loop-point editing is disabled while the loop switch is off. No new function is called from `audioDeviceIOCallbackWithContext`, `InstrumentVoice::renderNextBlock`, or offline rendering. The C2C callback graph and fixed eight-zone bound are unchanged.

## Milestone C2E sample-source send edge

```text
setup/control: schema-v5 patch / sample-slot-v4 project
  -> clamp two sample send levels
  -> resolve existing two project return-bus IDs
  -> createInstrumentSynth fixed voice params

callback render:
  MappedSampleSourceSlot::renderFrame
    -> existing filter/direct lane
    -> fixed sampleSourceFrame
       -> bus 1 accumulator * cached send 1
       -> bus 2 accumulator * cached send 2
  -> preallocated AetherSourceBusContext
  -> existing project return-bus effect chains
```

The bus loop remains exactly two entries. A disabled sample slot or zero sends contributes silence; no map scan or send work is made variable by project size. Decoding, bus resolution, schema validation, and ownership changes stay on setup/control paths. Offline rendering follows the same accumulation edge and remains excluded from real-time interception.

## Milestone C2F overlap-selection edge

```text
callback note-on
  -> fixed maximum-eight matching scan
  -> most-specific + second-most-specific stable selection
  -> key-overlap equal-power weights
       or velocity-overlap weights when key centres coincide
  -> at most two fixed SampleSourceSlot::noteOn calls

callback render
  -> existing fixed published-zone scan
  -> child renderFrame sums already weighted voices
```

Single matches, gaps, and identical key/velocity duplicates retain one-or-zero-child behavior. No crossfade coefficient evolves during rendering: weights are computed once at note-on and stored through each child voice's existing gain scalar. Offline rendering follows the same deterministic edge and is excluded from real-time interception.

## Milestone C2G bounded streaming-cache foundation

```text
setup/test worker (not callback)
  -> SamplePageLoader::readFrames
  -> inactive preallocated page bank
  -> atomic descriptor publication

candidate callback boundary (not production-connected)
  -> BoundedSamplePageCache::readStereoFrame
       -> bounded 16-slot descriptor scan
       -> reader pin + descriptor verification
       -> preallocated stereo-frame copy on hit
       -> fixed SPSC request + atomic underflow telemetry on miss
```

The candidate owns neither a thread nor a file reader. The callback edge cannot invoke `SamplePageLoader`, allocate, resize, acquire a mutex, or wait. A single background consumer is the only request-queue reader. Double page banks prevent the worker from writing the currently published bank, and generation-bearing descriptors prevent a delayed callback reader from accepting a replaced bank as the earlier page publication. Queue full is an explicit bounded failure. Production `SampleSourceSlot` still reads immutable decoded `AudioBuffer` data; therefore the production callback and offline call graphs above are unchanged. Connection remains gated on shared worker lifetime, attack/loop preloading, underflow fades, and explicit live/offline selection.

## Milestone C2H production streaming edge

```text
setup/control
  -> prepareForRealtime
  -> conservative Aether-only >= 8 s asset classification
  -> AudioFormatReader creation (maximum 8)
  -> preload attack / next / loop-start / loop-end pages
  -> start one SampleStreamingSession worker
  -> publish immutable session + asset index to SampleSourceSlot

background worker
  -> pop fixed request from each asset cache
  -> AudioFormatReader::read into preallocated scratch
  -> inactive page bank
  -> atomic descriptor publication

real-time callback
  -> SampleSourceSlot::renderFrame
  -> SampleStreamingSession::readStereoFrame
  -> BoundedSamplePageCache::readStereoFrame
       hit: pin / verify / copy / unpin
       miss: fixed request + atomic telemetry
  -> 64-sample fade-out or recovery fade
  -> existing sample gain/pan, filter/direct, and FX-send graph

offline/export
  -> prepareForOffline
  -> existing complete decode and immutable AudioBuffer playback
```

The callback does not call `AudioFormatReader`, `Thread::notify`, `Thread::wait`, loader code, or any ownership-changing operation. Worker file I/O is outside the thread-local real-time probe. Project replacement keeps the retired session alive until old routes are destroyed, publishes the new session under the project lock, then signals and joins the retired worker after releasing the lock. An asset shared with an audio segment or conventional sampler never enters this edge. If a page is unavailable, position/timing advance normally while the held source value fades to silence; recovery begins only after the fade-out reaches zero.

## Milestone C2I streaming-pressure proof edge

The production graph above is unchanged. Test-only coverage drives the existing boundaries in two ways:

```text
deterministic slow/failing test worker
  -> 2 ms bounded loader delay + 64 declared failures
  -> existing fixed request consumer and page publication

instrumented simulated callback
  -> 50,000 random cache reads across 128 pages
  -> explicit queue saturation / zero-on-miss / recovery proof

real file worker + instrumented render blocks
  -> 16 SampleSourceSlot voices at divergent rates
  -> non-sequential page churn + forward-loop wrap
  -> more successful loads than resident page slots
```

Sleep, test-file creation, loader failure injection, telemetry formatting, and worker joins occur outside every real-time probe. The callback still performs only the C2H bounded scan, atomic request/telemetry operations, preallocated sample copies, and per-voice transition arithmetic. Offline rendering remains outside the probe and stays on the full-decode edge.

## Milestone C3A disconnected SFZ parsing edge

```text
future explicit import action (control thread only)
  -> selected .sfz file size check (maximum 1 MiB)
  -> bounded lexer (maximum 4,096 opcodes)
  -> control/global/group/region inheritance
  -> path/range/loop/sequence validation
  -> immutable-neutral region records (maximum 256)
  -> diagnostics (maximum 512 stored; uncapped error/warning totals)

production callback / offline render
  -> no C3A edge
```

C3A performs no sample existence check, decode, stream creation, route publication, schema mutation, or audio rendering. `parseSfzSubsetFile` is a control/import-thread wrapper and is not referenced by `AudioEngine` or the device callback. Unsupported headers and opcodes produce diagnostics rather than calling or emulating external implementations. C3B must introduce a separately reviewed sample-root and immutable region-index publication edge before playback exists.

## Milestone C3B disconnected SFZ resolution edge

```text
future explicit import action (control thread only)
  -> C3A parsed region model
  -> canonical SFZ parent as sample root
  -> canonicalize each referenced path
  -> component-wise root-containment / regular-file / extension checks
  -> per-file and aggregate byte budgets
  -> immutable stable-order regions
  -> fixed 128-note candidate index (maximum 32 entries per note)

production callback / offline render
  -> no C3B edge
```

The resolver opens no audio stream and publishes nothing into `AudioEngine`, `InstrumentVoice`, the streaming worker, or project state. File inspection is intentionally control-thread work and is outside the real-time instrumentation boundary. Future C3C decode must revalidate the selected file after opening it to close the remaining time-of-check/time-of-use window; it must also establish decoder-format support, destruction deferral, live/offline ownership, and callback-safe publication before this edge can reach playback.

## Milestone C3C1 disconnected SFZ decode edge

```text
future explicit import action (control thread only)
  -> accepted immutable C3B instrument
  -> canonical root/sample revalidation
  -> open one stream per unique sample
  -> post-open path / containment / size / timestamp / stream-length checks
  -> JUCE format reader metadata validation
  -> decoded-memory budget check before allocation
  -> immutable shared audio buffers + stable region/note index

production callback / offline render
  -> no C3C1 edge
```

All file opens, format discovery, allocation, decoding, diagnostic growth, and destruction occur outside the callback. C3C1 neither starts the C2H worker nor publishes to a source slot. Metadata revalidation is not equivalent to descriptor-level identity; C3C2 must add a platform-safe opened-file identity or content-digest policy, control-thread publication, deferred destruction, and callback instrumentation before the decoded graph may become reachable from the production render path.

## Milestone C3C2 strong descriptor identity edge

```text
control/import thread
  -> C3B stat(canonical sample): device + inode + size + mtime + ctime
  -> C3C open(canonical sample, O_RDONLY | O_CLOEXEC | O_NOFOLLOW)
  -> fstat(open descriptor) == recorded identity
  -> existing path / containment / portable metadata checks
  -> JUCE format reader owns the same descriptor stream
  -> bounded immutable decode
  -> fstat(same open descriptor) == recorded identity

production callback / offline render
  -> no C3C2 edge
```

Symlink-swap, identity-mismatch, and post-read mutation hooks compile only into `BeatBackendStress`. Production does not contain those hooks. On unsupported non-POSIX platforms the decode fails closed. C3C2 establishes a trustworthy immutable decoded object but deliberately does not publish it; the next edge must specify control-thread handoff, active-voice replacement policy, heavyweight destruction deferral, and callback-safety probes before reaching `MappedSampleSourceSlot`.

## Milestone C3D1 disconnected indexed SFZ playback edge

```text
control thread
  -> validate immutable C3C2 instrument and finite decoded buffers
  -> write inactive owner/raw-pointer bank
  -> atomic published-bank switch
  -> retire unpinned former bank on control thread

note-on callback boundary
  -> pin current publication bank
  -> fixed per-note candidate list (maximum 32)
  -> key/velocity specificity + at most two equal-power regions
  -> reserve one or two of 16 fixed voice records

sample callback boundary
  -> scan 16 fixed voice records
  -> immutable buffer interpolation / slice / loop / transition arithmetic
  -> release voice bank pin (no shared-owner destruction)

AudioEngine / project schema / product import
  -> no C3D1 edge
```

Note-on and render contain no allocation, blocking lock, file/stream access, lazy initialization, or container growth. Candidate scans and active voice samples are observable bounded work. Publication refuses active replacement, and sequence, release-trigger, group, and off-by semantics refuse publication. `takeRetiredInstrument()` is a control-thread destruction boundary. The next integration slice must choose an explicit product routing/import contract and preserve this bank/retirement policy; it must not fall back to the 256-slot per-sample scan that C3D1 was designed to avoid.

## C3D2 managed SFZ product and callback boundary — 2026-07-15

Control/message thread: `MessageBridge::instrument.importSfz` -> `importManagedSfzAsset()` -> C3A parse -> C3B resolution -> C3C descriptor decode -> SHA-256 inventory -> staging copy/verification -> manifest write -> atomic managed-directory publication. No callback or live route is touched before publication completes.

Project apply/control thread: `AudioEngine::applyProject()` -> `rebuildSampleInstruments()` -> `loadManagedSfzAsset()` -> manifest/path/hash/symlink verification -> resolve/decode -> `createInstrumentSynth()` -> `InstrumentVoice::prepare()` -> `SfzSourceSlot::publishInstrument()`. File I/O, hashing, allocation, decoding, route construction, and retirement/destruction remain outside the callback.

Audio callback: `audioDeviceIOCallbackWithContext()` -> route synth -> `InstrumentVoice::renderNextBlock()` -> `SfzSourceSlot::renderFrame()` -> fixed candidate scan -> pinned immutable sample reads -> existing source routing, filters, sends, effects, master DC blocker, and limiter. Replacement adds a fixed scan of at most two tailing synths with a pre-existing empty MIDI buffer; they accept no new notes. This branch performs no manifest access, file/stream operation, hash, decode, allocation, container growth, blocking lock, publication destruction, or lazy initialization.

## C3E1 disconnected granular callback boundary — 2026-07-15

Setup/test thread: immutable decoded-buffer creation -> complete finite/range validation -> idle-only `GranularSourceSlot::publish()` -> sample-rate coefficient preparation. Callback contract: note-on scans eight fixed emitters; each output sample scans eight schedulers and 32 grain records; active grains perform bounded interpolation, Hann gain, pan, position, and counter arithmetic. Pool saturation rejects explicitly. There is no allocation, lock, file/stream access, worker signaling, lazy initialization, container growth, or ownership destruction in render. C3E1 has no edge from `AudioEngine`, `InstrumentVoice`, project schemas, IPC, or UI.

## C3E2 managed granular product and callback boundary — 2026-07-15

Control/message thread: `MessageBridge::instrument.importGranular` -> `importManagedGranularAsset()` -> bounded descriptor decode -> SHA-256 -> staging copy/verification -> manifest write -> atomic directory publication. Project apply/control thread: `AudioEngine::applyProject()` -> `rebuildSampleInstruments()` -> `loadManagedGranularAsset()` or `makeGranularBenchmarkAudio()` -> immutable `ImmutableGranularSource` construction -> `createInstrumentSynth()` -> per-voice `GranularSourceSlot::publish()`. File I/O, hashing, decoding, generation, allocation, route identity, publication, retirement, and destruction remain outside the callback.

Audio callback: device/offline render -> `InstrumentVoice::startNote()` -> fixed emitter admission; per-sample `GranularSourceSlot::renderFrame()` -> fixed eight-emitter scheduler scan -> fixed 32-grain scan -> interpolation/window/pan arithmetic -> selected main/filter/direct route and fixed FX buses. A changed source or granular parameter reuses the existing maximum-two retiring-synth bridge. The callback contains no manifest access, file/stream operation, hash, decode, allocation, blocking lock, lazy initialization, container growth, or shared-owner destruction. Offline rendering is not misclassified as a realtime callback by the development instrumentation.

## C3F proposed spectral boundary — 2026-07-15

There is no new call-graph edge in C3F. The accepted-with-revisions boundary is: descriptor-safe decode and deterministic import resampling plus immutable L/R magnitude/phase-residual analysis, shared peak-region/transient detection, and validation on a worker/control side; manifest/hash/dimension validation and all FFT/WOLA/output-resampler construction before publication; then fixed-capacity identity-phase-locked synthesis, inverse transforms, overlap-add, time-domain stereo width, and canonical-to-host streaming resampling in the callback. File access, decoding, analysis, plan creation, allocation, worker signaling, container growth, repair, and ownership destruction are forbidden in render. This remains blocked until a human DSP specialist confirms the revised constants, pitch/position algorithm, filter geometry, deadline machine, and latency reference model.

## C3G persistence and test boundaries — 2026-07-16

There is no new audio-callback or offline-render edge in C3G.

```text
repository/control thread
  ProjectRepository::loadWithDiagnostics()
    -> JSON parse
    -> validateHybridSourceDocument()
    -> reject with stable diagnostics OR projectFromJson()

project cleanup/message thread
  MessageBridge::project.cleanupAssets
    -> cleanupUnusedProjectSidecarAssets()
    -> validateHybridSourceDocument()
    -> blocked diagnostic with zero deletions OR collect references
    -> protect complete referenced managed bundles
    -> delete only proven-orphan sidecar files

test process only
  verify-aether-benchmark-renders.mjs
    -> production factory record
    -> synthDraftToPreviewInstrument()
    -> production frontend render
    -> finite/audibility/DC/discontinuity/determinism/hash checks
```

Slot accessibility and selector-keyboard changes are presentation/input behavior only. The 150-render native freeze remains byte-identical. Slot 3, `SourceSlotIndex::three`, and the proposed C3F boundary have no new caller or implementation.

## C3F1 disconnected analysis boundary — 2026-07-16

```text
native test/control thread only
  locally generated verified 48 kHz AudioBuffer
    -> SpectralAnalyzer::analyze()
       -> bounded window/forward FFT
       -> independent L/R magnitude + phase residual planes
       -> shared peak/transient decisions
       -> payload hash + complete artifact validation
       -> complete immutable value OR diagnosable failure/cancellation

audio callback / offline engine / project apply / IPC
  -> no C3F1 caller
```

`SpectralAnalyzer` is compiled into native targets but unreachable from product behavior. It performs allocations, FFT preparation, hashing, and validation on its caller's non-realtime thread. C3F1 adds no callback instrumentation exemption and no offline-render edge.

## C3F2 artifact-v2 representation boundary — 2026-07-16

```text
native test/control thread only
  verified canonical PCM
    -> SpectralAnalyzer::analyze()
    -> artifact-v2 peak identity/evolution + relative phase
    -> exact serialization/hash
    -> decode with bounded counts
    -> complete validation
    -> test-only comparison inverse transforms

AudioEngine / InstrumentVoice / SourceSlotRack / offline renderer / IPC
  -> no C3F2 caller
```

Serialization, decoding, allocation, hashing, validation, FFT preparation, and comparison reconstruction remain outside realtime. No detector exemption, callback work, lazy initialization, file operation, source publication, or destruction edge was added.

## Serum 1 integration realtime-string boundary — 2026-07-19

```text
sequencer route automation event
  -> preallocated blockRouteParameterEvents
  -> AudioEngine::applyRouteParameterLocked()
     -> bounded target-prefix and separator scan
     -> in-place bus/effect/parameter region comparison
     -> scalar route/effect state update
  -> existing route effect processing
```

No substring, temporary `juce::String`, heap allocation, container growth, file operation, blocking lock, or lazy initialization occurs on this edge. JUCE IDs entering the fixed realtime parameter queue are encoded directly into its preallocated arrays. Offline rendering continues to use the same automation semantics but is not classified as a realtime callback. The focused streaming callback detector and complete native suite cover this boundary.

## Serum 1 fixed-unison-capacity closeout — 2026-07-19

```text
control / project / IPC
  -> clamp oscillator unison to 1..16
  -> prepare/configure fixed WavetableOscillatorBank::Bank
  -> publish existing immutable wavetable handle

audio callback or offline render
  InstrumentVoice::renderNextBlock()
    -> AetherTableStackRenderer::render()
       -> WavetableUnison::update(preallocated Plan)
       -> bounded loop over active voices, maximum 16
       -> existing oscillator render, weighting, pan, routing, and counters
```

`WavetableUnisonConfig.h` defines one native capacity and phase-array type. Voice-owned oscillator banks, interaction banks, phase-memory arrays, plan coefficient arrays, and maximum-unison tests all use it. Increasing the compile-time storage from eight to 16 adds no allocation, container growth, lock, file/stream, lazy initialization, publication, or destruction edge. Offline rendering follows the same fixed loop but remains excluded from realtime detector classification. The full production native fixture renders the authored nine-voice Future Bass benchmark with zero deadline overruns; the 150-render harness exercises the full 16-voice ceiling across every supported sample-rate/block-size combination.

The TypeScript browser reference renderer separately caches its immutable built-in wavetable configuration by object identity and bounded numeric harmonic/warp key, and caches bounded unison stereo gains. Warp modulation passes a scalar offset rather than constructing a configuration object per sample. This path is not the JUCE realtime callback, does not alter native call edges, and preserves all frozen browser render hashes.
