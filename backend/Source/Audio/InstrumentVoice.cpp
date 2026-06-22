#include "InstrumentVoice.h"

#include "Modulation/DynamicModulation.h"
#include "Modulation/Lfo.h"
#include "Oscillator/AetherTableStackRenderer.h"
#include "Oscillator/BasicOscillator.h"
#include "Oscillator/VoiceMath.h"
#include "Oscillator/VoiceRenderStats.h"
#include "Realtime/VoiceAutomationInbox.h"
#include "Wavetable/WavetableOscillatorBank.h"
#include "Wavetable/WavetableVoiceCache.h"

#include <cmath>

namespace beat
{
    VoiceStats::WavetableCache InstrumentVoice::getWavetableCacheStats() noexcept
    {
        return WavetableVoiceCache::stats();
    }

    VoiceStats::RenderWork InstrumentVoice::consumeRenderWorkStats() noexcept
    {
        return VoiceRenderStats::consume();
    }

    void InstrumentVoice::prepare(double sr, int blockSize)
    {
        sampleRate = sr;
        for (auto& osc : wavetableOscillators)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsA)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsB)
            osc.prepare(sampleRate);
        adsr.setSampleRate(sr);
        env2Adsr.setSampleRate(sr);
        filterState.prepare(sr, blockSize, params.filterType);
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        baseParams = p;
        params = p;
        modWheel = juce::jlimit(0.0f, 1.0f, p.modWheel);
        pitchWheelSemitones = 0.0f;
        params.wavetable.bank = params.wavetableBank;
        params.wavetable.custom = params.wavetableBank == 5;
        params.wavetable.position = params.wavetablePosition;
        params.wavetable.warp = params.wavetableWarp;
        params.wavetable.warpMode = params.wavetableWarpMode;
        params.wavetable.unison = params.wavetableUnison;
        params.wavetable.detuneCents = params.wavetableDetuneCents;
        params.wavetable.blend = params.wavetableBlend;
        if (legacyWavetableNeedsSetup())
        {
            activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
            wavetableTable = WavetableVoiceCache::sharedTableForConfig(params.wavetable);
            WavetableOscillatorBank::configure(wavetableOscillators, wavetableTable.get(), params.wavetable, sampleRate, baseFrequencyHz);
            WavetableUnison::invalidate(wavetableUnisonPlan);
        }
        else
        {
            activeWavetableUnison = 1;
            wavetableTable.reset();
            WavetableOscillatorBank::clear(wavetableOscillators, wavetableUnisonPlan);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            aetherTableA = WavetableVoiceCache::sharedTableForConfig(params.aetherOscA.wavetable);
            WavetableOscillatorBank::configure(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            aetherTableA.reset();
            WavetableOscillatorBank::clear(aetherOscillatorsA, aetherUnisonPlanA);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            aetherTableB = WavetableVoiceCache::sharedTableForConfig(params.aetherOscB.wavetable);
            WavetableOscillatorBank::configure(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            aetherTableB.reset();
            WavetableOscillatorBank::clear(aetherOscillatorsB, aetherUnisonPlanB);
        }
        adsrParams.attack  = juce::jmax(0.001f, p.attackMs  * 0.001f);
        adsrParams.decay   = juce::jmax(0.001f, p.decayMs   * 0.001f);
        adsrParams.sustain = juce::jlimit(0.0f, 1.0f, p.sustain);
        adsrParams.release = juce::jmax(0.001f, p.releaseMs * 0.001f);
        adsr.setParameters(adsrParams);
        env2AdsrParams.attack = juce::jmax(0.001f, p.env2AttackMs * 0.001f);
        env2AdsrParams.decay = juce::jmax(0.001f, p.env2DecayMs * 0.001f);
        env2AdsrParams.sustain = juce::jlimit(0.0f, 1.0f, p.env2Sustain);
        env2AdsrParams.release = juce::jmax(0.001f, p.env2ReleaseMs * 0.001f);
        env2Adsr.setParameters(env2AdsrParams);

        filterState.configure(p.filterType, p.cutoff01, p.resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedPitchRates();
        refreshCachedDynamicModulationFlags();
        realtimeRampState.resetFromParams(params);
    }

    void InstrumentVoice::controllerMoved(int controllerNumber, int controllerValue)
    {
        if (controllerNumber == 1)
            modWheel = juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f);
    }

    void InstrumentVoice::pitchWheelMoved(int newPitchWheelValue)
    {
        pitchWheelSemitones = VoiceMath::pitchWheelRatio(newPitchWheelValue)
            * juce::jlimit(0.0f, 24.0f, params.pitchBendRangeSemitones);
    }

    void InstrumentVoice::setRealtimeRamp(RealtimeParam param, float value, int rampSamples) noexcept
    {
        auto& ramp = realtimeRampState.ramp(param);
        ramp.setTarget(value, rampSamples);
        if (rampSamples <= 0)
        {
            realtimeRampState.deactivate(param);
            applyRealtimeValue(param, ramp.current);
            return;
        }
        realtimeRampState.activate(param);
    }

    bool InstrumentVoice::applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples) noexcept
    {
        return setRealtimeParameterValue(parameterId, value, rampSamples, true);
    }

    bool InstrumentVoice::setRealtimeParameterValue(std::string_view parameterId, float value, int rampSamples, bool updateBaseline) noexcept
    {
        const int index = VoiceRealtimeParams::indexForParameterId(parameterId);
        if (index < 0)
            return false;

        const auto param = (RealtimeParam) index;
        if (!VoiceRealtimeParams::isValid(param))
            return false;
        if (!isVoiceActive())
            rampSamples = 0;
        if (updateBaseline)
            VoiceRealtimeParams::applyValue(baseParams, param, value);
        setRealtimeRamp(param, VoiceRealtimeParams::clampValue(param, value), rampSamples);
        return true;
    }

    void InstrumentVoice::applyRealtimeValue(RealtimeParam param, float value) noexcept
    {
        VoiceRealtimeParams::applyValue(params, param, value);
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
            {
                filterState.updateCutoffIfChanged(params.cutoff01, sampleRate, params.filterKeytrack, baseFrequencyHz, 0.5f);
                break;
            }
            case RealtimeParam::FilterResonance:
            {
                filterState.updateResonanceIfChanged(params.resonance01, 0.001f);
                break;
            }
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
                refreshCachedPitchRates();
                break;
            case RealtimeParam::OscALevel:
            case RealtimeParam::OscBLevel:
            case RealtimeParam::UnisonDetune:
            case RealtimeParam::UnisonSpread:
            case RealtimeParam::LfoRate:
            case RealtimeParam::LfoDepth:
                break;
            case RealtimeParam::AmpPan:
            case RealtimeParam::OscAPan:
            case RealtimeParam::OscBPan:
                refreshCachedPanGains();
                break;
            case RealtimeParam::OscAPhase:
                aetherOscAPhaseOffset = (double) juce::jlimit(0.0f, 1.0f, params.aetherOscA.phase);
                break;
            case RealtimeParam::OscBPhase:
                aetherOscBPhaseOffset = (double) juce::jlimit(0.0f, 1.0f, params.aetherOscB.phase);
                break;
            case RealtimeParam::Count:
                break;
        }
    }

    void InstrumentVoice::advanceRealtimeRamps() noexcept
    {
        realtimeRampState.advance([this](RealtimeParam param, float value)
        {
            applyRealtimeValue(param, value);
        });
    }

    void InstrumentVoice::loadPendingNoteAutomation(int midiNoteNumber) noexcept
    {
        noteAutomationState.loadPending(midiNoteNumber);
    }

    void InstrumentVoice::advanceVoiceAutomation() noexcept
    {
        noteAutomationState.advance(
            [this](const VoiceNoteAutomation::PitchEvent& event)
            {
                pitchFrequencyRamp.setTarget(juce::jlimit(1.0f, 24000.0f, event.frequencyHz), event.rampSamples);
            },
            [this](const RealtimeParameterChange& event)
            {
                setRealtimeParameterValue(event.parameterIdView(), event.value, event.rampSamples, false);
            });
    }

    void InstrumentVoice::startNote(int midiNoteNumber, float velocity,
                                    juce::SynthesiserSound*, int currentPitchWheel)
    {
        const bool legatoRetune = baseParams.legato && adsr.isActive();
        params = baseParams;
        realtimeRampState.resetFromParams(params);
        baseFrequencyHz = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
        level = velocity;
        noteKeytrack = juce::jlimit(0.0f, 1.0f, (float) midiNoteNumber / 127.0f);
        pitchWheelMoved(currentPitchWheel == 0 ? 8192 : currentPitchWheel);

        if (legatoRetune)
        {
            const int glideSamples = params.glideMs > 0.0f && sampleRate > 0.0
                ? juce::jmax(1, (int) std::round((params.glideMs / 1000.0f) * (float) sampleRate))
                : 0;
            filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            refreshCachedPanGains();
            refreshCachedDynamicModulationFlags();
            refreshCachedPitchRates();
            pitchFrequencyRamp.setTarget((float) baseFrequencyHz, glideSamples);
            phaseDelta = baseFrequencyHz / sampleRate;
            loadPendingNoteAutomation(midiNoteNumber);
            return;
        }

        filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedDynamicModulationFlags();

        phase     = 0.0;
        noiseState = (juce::uint32) (midiNoteNumber * 747796405u + 2891336453u);
        aetherOscAPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscA.phase)
            + VoiceMath::deterministicPhaseJitter(noiseState ^ 0xa9f14c31u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscA.randomPhase);
        aetherOscBPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscB.phase)
            + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x6c8e9cf5u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscB.randomPhase);
        if (params.lfoRetrigger)
            lfoPhase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfoPhaseOffset)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x35a1d7bdu) * juce::jlimit(0.0, 1.0, (double) params.lfoRandomPhase),
                1.0);
        if (params.lfo2Retrigger)
            lfo2Phase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfo2PhaseOffset)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x91c2ef43u) * juce::jlimit(0.0, 1.0, (double) params.lfo2RandomPhase),
                1.0);
        phaseDelta = baseFrequencyHz / sampleRate;
        pitchFrequencyRamp.reset((float) baseFrequencyHz);
        driveState.reset();
        previousRawEnvelope = 0.0f;
        previousRawEnv2Envelope = 0.0f;
        env1LoopState.reset();
        env2LoopState.reset();
        if (legacyWavetableNeedsSetup())
            configureWavetableOscillators(baseFrequencyHz);
        else
            WavetableOscillatorBank::clear(wavetableOscillators, wavetableUnisonPlan);
        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            WavetableOscillatorBank::configure(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, sampleRate, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsA)
                osc.setPhase(aetherOscAPhaseOffset);
        }
        else
            WavetableOscillatorBank::clear(aetherOscillatorsA, aetherUnisonPlanA);

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            WavetableOscillatorBank::configure(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, sampleRate, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsB)
                osc.setPhase(aetherOscBPhaseOffset);
        }
        else
            WavetableOscillatorBank::clear(aetherOscillatorsB, aetherUnisonPlanB);
        refreshCachedPitchRates();
        loadPendingNoteAutomation(midiNoteNumber);
        adsr.noteOn();
        env2Adsr.noteOn();
    }

    void InstrumentVoice::stopNote(float, bool allowTailOff)
    {
        if (allowTailOff)
        {
            if (params.env1Loop)
            {
                const float value = env1LoopValue();
                env1LoopState.beginRelease(value);
                previousRawEnvelope = value;
            }
            else
            {
                adsr.noteOff();
            }
            if (params.env2Loop)
            {
                const float value = env2LoopValue();
                env2LoopState.beginRelease(value);
                previousRawEnv2Envelope = value;
            }
            else
            {
                env2Adsr.noteOff();
            }
        }
        else
        {
            adsr.reset();
            env2Adsr.reset();
            env1LoopState.reset();
            env2LoopState.reset();
            clearCurrentNote();
        }
    }

    void InstrumentVoice::renderNextBlock(juce::AudioBuffer<float>& out,
                                          int startSample, int numSamples)
    {
        juce::ScopedNoDenormals noDenormals;
        if (!adsr.isActive()) return;

        const auto modulationPlan = DynamicModulation::makeRenderPlan(
            cachedDynamicTargets,
            params.dynamicModulation.active,
            params.lfo2Enabled,
            params.lfoToPitch,
            params.lfoDepth,
            params.lfoToFilter,
            params.envToFilter);
        const float pitchMod = modulationPlan.pitchMod;
        const bool useDynamicModulation = modulationPlan.useDynamicModulation;
        const bool hasPitchMod = modulationPlan.hasPitchMod;
        const bool hasPositionMod = modulationPlan.hasPositionMod;
        const bool hasFilterMod = modulationPlan.hasFilterMod;
        const bool needsLfoValue = modulationPlan.needsLfoValue;
        const bool needsLfo2Value = modulationPlan.needsLfo2Value;
        const bool needsEnv2Value = modulationPlan.needsEnv2Value;
        const bool hasAmpPanMod = modulationPlan.hasAmpPanMod;
        const double lfoPhaseDelta = juce::jmax(0.01f, params.lfoRateHz) / sampleRate;
        const double lfo2PhaseDelta = juce::jmax(0.01f, params.lfo2RateHz) / sampleRate;
        const bool hasVoiceAutomation = noteAutomationState.active();
        int64_t modulationSamples = 0;
        int64_t realtimeRampSamples = 0;
        currentBlockOscillatorSamples = 0;
        currentBlockWavetableVoiceSamples = 0;
        currentBlockAetherOscASamples = 0;
        currentBlockAetherOscBSamples = 0;
        currentBlockAetherSubSamples = 0;
        currentBlockAetherNoiseSamples = 0;
        currentBlockOscillatorRateCalculations = 0;
        currentBlockFilterDriveSamples = 0;
        currentBlockFilterCoefficientUpdates = 0;
        currentBlockFilterCutoffUpdates = 0;
        currentBlockFilterResonanceUpdates = 0;
        currentBlockWavetableFrequencyUpdates = 0;
        currentBlockWavetablePositionUpdates = 0;

        for (int i = 0; i < numSamples; ++i)
        {
            if (hasVoiceAutomation)
            {
                advanceVoiceAutomation();
                ++modulationSamples;
            }
            if (realtimeRampState.activeCount > 0)
            {
                realtimeRampSamples += realtimeRampState.activeCount;
                advanceRealtimeRamps();
            }
            const float rawLfo = needsLfoValue ? Lfo::value(params.lfoWaveform, lfoPhase, params.lfoSmoothing, params.lfoOneShot) : 0.0f;
            const float rawLfo2 = needsLfo2Value ? Lfo::value(params.lfo2Waveform, lfo2Phase, params.lfo2Smoothing, params.lfo2OneShot) : 0.0f;
            if (needsLfoValue || useDynamicModulation)
                ++modulationSamples;
            const float positionLfo = hasPositionMod ? Lfo::routeValue(rawLfo, params.lfoPositionBipolar) * VoiceMath::clamp01(params.lfoDepth) : 0.0f;
            const float pitchLfo = hasPitchMod ? Lfo::routeValue(rawLfo, params.lfoPitchBipolar) : 0.0f;
            const float filterLfo = !useDynamicModulation && hasFilterMod ? Lfo::routeValue(rawLfo, params.lfoFilterBipolar) : 0.0f;
            const float env = params.env1Loop
                ? env1LoopValue()
                : shapedEnvelope(adsr.getNextSample());
            const float env2 = needsEnv2Value
                ? (params.env2Loop
                    ? env2LoopValue()
                    : EnvelopeShaper::shapeAdsrSample(
                        env2Adsr.getNextSample(),
                        previousRawEnv2Envelope,
                        params.env2Sustain,
                        params.env2AttackCurve,
                        params.env2DecayCurve,
                        params.env2ReleaseCurve))
                : 0.0f;
            const double currentPitchFrequency = juce::jmax(1.0f, pitchFrequencyRamp.next())
                * std::exp2((double) pitchWheelSemitones / 12.0);
            double currentPhaseDelta = currentPitchFrequency / sampleRate;
            if (hasPitchMod)
                currentPhaseDelta *= std::exp2((pitchLfo * pitchMod) / 12.0);
            if (useDynamicModulation && !params.hasAether)
            {
                const float oscAFineCents = DynamicModulation::targetOffset(params.dynamicModulation.oscAFine, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 100.0f);
                currentPhaseDelta *= std::exp2(oscAFineCents / 1200.0f);
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation && cachedDynamicTargets.oscAPosition
                ? DynamicModulation::targetOffset(params.dynamicModulation.oscAPosition, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation && cachedDynamicTargets.unisonDetune
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation && cachedDynamicTargets.unisonSpread
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f)
                : 0.0f;

            // Oscillator
            StereoSample raw;
            if (params.hasAether)
            {
                const auto aetherResult = AetherTableStackRenderer::render(
                    params,
                    cachedDynamicTargets,
                    cachedPanGains,
                    cachedPitchRates,
                    aetherOscillatorsA,
                    aetherOscillatorsB,
                    aetherUnisonPlanA,
                    aetherUnisonPlanB,
                    currentFrequency,
                    baseFrequencyHz,
                    sampleRate,
                    phase,
                    aetherOscAPhaseOffset,
                    aetherOscBPhaseOffset,
                    rawLfo,
                    rawLfo2,
                    env,
                    env2,
                    level,
                    noteKeytrack,
                    modWheel,
                    noiseState);
                raw = { aetherResult.frame.left, aetherResult.frame.right };
                currentBlockOscillatorSamples += aetherResult.work.oscillatorSamples;
                currentBlockWavetableVoiceSamples += aetherResult.work.wavetableVoiceSamples;
                currentBlockAetherOscASamples += aetherResult.work.aetherOscASamples;
                currentBlockAetherOscBSamples += aetherResult.work.aetherOscBSamples;
                currentBlockAetherSubSamples += aetherResult.work.aetherSubSamples;
                currentBlockAetherNoiseSamples += aetherResult.work.aetherNoiseSamples;
                currentBlockOscillatorRateCalculations += aetherResult.work.oscillatorRateCalculations;
                currentBlockWavetableFrequencyUpdates += aetherResult.work.wavetableFrequencyUpdates;
                currentBlockWavetablePositionUpdates += aetherResult.work.wavetablePositionUpdates;
            }
            else
            {
                const float mono = params.waveform == 5
                    ? renderWavetableStack(currentFrequency, positionLfo + dynamicOscAPosition, dynamicUnisonDetune, dynamicUnisonSpread)
                    : params.waveform == 4
                        ? VoiceMath::nextNoise(noiseState)
                        : BasicOscillator::sample(params.waveform, phase, currentPhaseDelta);
                if (params.waveform != 5)
                    ++currentBlockOscillatorSamples;
                raw = { mono, mono };
            }
            float left = raw.left;
            float right = raw.right;

            // Drive (soft clipping)
            const float drive = VoiceMath::clamp01(params.drive01 + (useDynamicModulation && cachedDynamicTargets.filterDrive
                ? DynamicModulation::targetOffset(params.dynamicModulation.filterDrive, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f)
                : 0.0f));
            if (drive > 0.0001f)
            {
                const float driveGain = 1.0f + drive * 6.0f;
                const auto driven = DriveStage::processOversampled(driveState, { left, right }, driveGain);
                left = driven.left;
                right = driven.right;
                currentBlockFilterDriveSamples += DriveStage::workSamplesForChannels(2);
            }
            else
            {
                driveState.reset({ left, right });
            }

            if (hasFilterMod)
            {
                const float cutoffMod = useDynamicModulation && cachedDynamicTargets.filterCutoff
                    ? DynamicModulation::targetOffset(params.dynamicModulation.filterCutoff, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 0.35f)
                    : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f;
                const int cutoffUpdates = filterState.updateCutoffIfChanged(
                    params.cutoff01 + cutoffMod,
                    sampleRate,
                    params.filterKeytrack,
                    baseFrequencyHz,
                    6.0f);
                currentBlockFilterCutoffUpdates += cutoffUpdates;
                currentBlockFilterCoefficientUpdates += cutoffUpdates;
                if (useDynamicModulation && cachedDynamicTargets.filterResonance)
                {
                    const float resonance = VoiceMath::clamp01(params.resonance01
                        + DynamicModulation::targetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f));
                    const int resonanceUpdates = filterState.updateResonanceIfChanged(resonance, 0.001f);
                    currentBlockFilterResonanceUpdates += resonanceUpdates;
                    currentBlockFilterCoefficientUpdates += resonanceUpdates;
                }
            }
            const auto filtered = filterState.process(left, right);
            left = filtered.left;
            right = filtered.right;

            const float ampLevel = VoiceMath::clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? DynamicModulation::targetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + DynamicModulation::targetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? VoiceMath::equalPowerPanGains(ampPan) : cachedPanGains.amp;
            const float voiceGain = env * level * 0.4f * ampLevel;
            const auto [leftGain, rightGain] = panGains;

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
            {
                const float sample = ch == 0 ? left * leftGain : ch == 1 ? right * rightGain : (left + right) * 0.5f;
                const float output = sample * voiceGain;
                out.addSample(ch, startSample + i, VoiceMath::denormalSafe(output));
            }

            phase += currentPhaseDelta;
            if (phase >= 1.0) phase -= 1.0;
            if (needsLfoValue)
            {
                lfoPhase += lfoPhaseDelta;
                if (params.lfoOneShot)
                    lfoPhase = juce::jmin(1.0, lfoPhase);
                else if (lfoPhase >= 1.0)
                    lfoPhase -= 1.0;
                if (needsLfo2Value)
                {
                    lfo2Phase += lfo2PhaseDelta;
                    if (params.lfo2OneShot)
                        lfo2Phase = juce::jmin(1.0, lfo2Phase);
                    else if (lfo2Phase >= 1.0)
                        lfo2Phase -= 1.0;
                }
            }
            noteAutomationState.advanceSample();
        }

        if (!adsr.isActive())
            clearCurrentNote();

        VoiceStats::RenderWork blockStats;
        blockStats.voiceBlocks = 1;
        blockStats.voiceSamples = numSamples;
        blockStats.oscillatorSamples = currentBlockOscillatorSamples;
        blockStats.wavetableVoiceSamples = currentBlockWavetableVoiceSamples;
        blockStats.aetherOscASamples = currentBlockAetherOscASamples;
        blockStats.aetherOscBSamples = currentBlockAetherOscBSamples;
        blockStats.aetherSubSamples = currentBlockAetherSubSamples;
        blockStats.aetherNoiseSamples = currentBlockAetherNoiseSamples;
        blockStats.filterSamples = (int64_t) numSamples * 2;
        blockStats.filterDriveSamples = currentBlockFilterDriveSamples;
        blockStats.filterCoefficientUpdates = currentBlockFilterCoefficientUpdates;
        blockStats.filterCutoffUpdates = currentBlockFilterCutoffUpdates;
        blockStats.filterResonanceUpdates = currentBlockFilterResonanceUpdates;
        blockStats.modulationSamples = modulationSamples;
        blockStats.realtimeRampSamples = realtimeRampSamples;
        blockStats.oscillatorRateCalculations = currentBlockOscillatorRateCalculations;
        blockStats.wavetableFrequencyUpdates = currentBlockWavetableFrequencyUpdates;
        blockStats.wavetablePositionUpdates = currentBlockWavetablePositionUpdates;
        VoiceRenderStats::recordBlock(blockStats);
    }

    float InstrumentVoice::shapedEnvelope(float rawEnvelope) noexcept
    {
        return EnvelopeShaper::shapeAdsrSample(rawEnvelope, previousRawEnvelope, params.sustain, params.attackCurve, params.decayCurve, params.releaseCurve);
    }

    float InstrumentVoice::env1LoopValue() noexcept
    {
        const auto result = EnvelopeShaper::renderLoop(
            env1LoopState,
            { params.attackMs, params.decayMs, params.sustain, params.releaseMs, params.attackCurve, params.decayCurve, params.releaseCurve },
            sampleRate,
            previousRawEnvelope);
        if (result.releaseComplete)
            adsr.reset();
        return result.value;
    }

    float InstrumentVoice::env2LoopValue() noexcept
    {
        return EnvelopeShaper::renderLoop(
            env2LoopState,
            { params.env2AttackMs, params.env2DecayMs, params.env2Sustain, params.env2ReleaseMs, params.env2AttackCurve, params.env2DecayCurve, params.env2ReleaseCurve },
            sampleRate,
            previousRawEnv2Envelope).value;
    }

    void InstrumentVoice::configureWavetableOscillators(double frequencyHz) noexcept
    {
        WavetableOscillatorBank::configure(wavetableOscillators, wavetableTable.get(), params.wavetable, sampleRate, frequencyHz);
        WavetableUnison::invalidate(wavetableUnisonPlan);
        activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
    }

    bool InstrumentVoice::legacyWavetableNeedsSetup() const noexcept
    {
        return !params.hasAether
            && params.waveform == 5;
    }

    bool InstrumentVoice::aetherOscillatorNeedsWavetable(const Params::AetherOscillator& osc) const noexcept
    {
        return params.hasAether
            && osc.enabled
            && osc.waveform == 5;
    }

    float InstrumentVoice::renderWavetableStack(
        double frequencyHz,
        float positionMod,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        const auto result = WavetableOscillatorBank::render(
            wavetableOscillators,
            wavetableUnisonPlan,
            params.wavetable,
            frequencyHz,
            baseFrequencyHz,
            sampleRate,
            positionMod,
            detuneCentsMod,
            spreadMod);
        currentBlockWavetableVoiceSamples += result.voiceSamples;
        currentBlockWavetableFrequencyUpdates += result.frequencyUpdates;
        currentBlockWavetablePositionUpdates += result.positionUpdates;
        return result.sample;
    }

    void InstrumentVoice::refreshCachedPanGains() noexcept
    {
        cachedPanGains = VoiceAetherCache::panGainsFor(params);
    }

    void InstrumentVoice::refreshCachedPitchRates() noexcept
    {
        cachedPitchRates = VoiceAetherCache::pitchRatesFor(params);
    }

    void InstrumentVoice::refreshCachedDynamicModulationFlags() noexcept
    {
        cachedDynamicTargets = DynamicModulation::targetActivityFlags(params.dynamicModulation);
    }

}
