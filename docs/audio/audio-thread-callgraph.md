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
