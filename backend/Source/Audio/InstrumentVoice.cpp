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
    namespace
    {
        float runtimeWarpShape(float input, float amount, int mode) noexcept
        {
            const float drive = VoiceMath::clamp01(amount);
            if (drive <= 0.0001f)
                return input;

            const float x = juce::jlimit(-1.0f, 1.0f, input);
            if (mode == 1)
            {
                const float gain = 1.0f + drive * 5.5f;
                const float folded = std::asin(std::sin(x * gain)) / juce::MathConstants<float>::halfPi;
                return juce::jlimit(-1.0f, 1.0f, x + (folded - x) * (0.35f + drive * 0.65f));
            }
            if (mode == 2)
            {
                const float shaped = (x < 0.0f ? -1.0f : 1.0f) * std::pow(std::abs(x), 1.0f + drive * 3.2f);
                return juce::jlimit(-1.0f, 1.0f, x + (shaped - x) * (0.4f + drive * 0.6f));
            }
            if (mode == 3)
            {
                const float mirrored = std::sin(x * juce::MathConstants<float>::pi * (1.0f + drive * 2.2f))
                    * (1.0f - std::abs(x) * drive * 0.35f);
                return juce::jlimit(-1.0f, 1.0f, x + (mirrored - x) * (0.32f + drive * 0.68f));
            }

            const float gain = 1.0f + drive * 8.0f;
            return juce::jlimit(-1.0f, 1.0f, std::tanh(x * gain) / std::tanh(gain));
        }

        float runtimeWarpMonoOversampled(DriveStage::State& state, float sample, float amount, int mode) noexcept
        {
            constexpr float downsampleAlpha = 0.72f;
            const float midpoint = 0.5f * (state.previousInput.left + sample);
            const float downsampled = 0.5f * (
                runtimeWarpShape(midpoint, amount, mode)
                + runtimeWarpShape(sample, amount, mode));

            state.downsample.left = DriveStage::denormalSafe(state.downsample.left
                + downsampleAlpha * (downsampled - state.downsample.left));
            state.previousInput.left = sample;
            return state.downsample.left;
        }

        DriveStage::StereoFrame processRuntimeWarpOversampled(
            DriveStage::State& state,
            DriveStage::StereoFrame sample,
            float amount,
            int mode) noexcept
        {
            DriveStage::State rightState;
            rightState.previousInput.left = state.previousInput.right;
            rightState.downsample.left = state.downsample.right;

            const DriveStage::StereoFrame processed {
                runtimeWarpMonoOversampled(state, sample.left, amount, mode),
                runtimeWarpMonoOversampled(rightState, sample.right, amount, mode),
            };

            state.previousInput.right = rightState.previousInput.left;
            state.downsample.right = rightState.downsample.left;
            return processed;
        }
    }

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
        sampleRate = std::isfinite(sr) && sr > 0.0 ? sr : 44100.0;
        phaseDelta = sampleRate > 0.0 ? baseFrequencyHz / sampleRate : 0.0;
        for (auto& osc : wavetableOscillators)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsA)
            osc.prepare(sampleRate);
        for (auto& osc : aetherOscillatorsB)
            osc.prepare(sampleRate);
        adsr.setSampleRate(sr);
        env2Adsr.setSampleRate(sr);
        filterState.prepare(sr, blockSize, params.filterType);
        filter2State.prepare(sr, blockSize, params.filter2Type);
        stealTransition.prepare(sampleRate);
    }

    void InstrumentVoice::setProcessingQuality(AudioQuality quality) noexcept
    {
        processingQuality = quality;
        for (auto& oscillator : wavetableOscillators) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsA) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsB) oscillator.setQuality(quality);
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
            auto nextTable = WavetableVoiceCache::sharedTableForConfig(params.wavetable);
            if (nextTable.get() != wavetableTable.get())
            {
                retiredWavetableTable = std::move(wavetableTable);
                wavetableTable = std::move(nextTable);
            }
            WavetableOscillatorBank::configure(wavetableOscillators, wavetableTable.get(), params.wavetable, sampleRate, baseFrequencyHz);
            WavetableUnison::invalidate(wavetableUnisonPlan);
        }
        else
        {
            activeWavetableUnison = 1;
            retiredWavetableTable = std::move(wavetableTable);
            WavetableOscillatorBank::clear(wavetableOscillators, wavetableUnisonPlan);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            auto nextTable = WavetableVoiceCache::sharedTableForConfig(params.aetherOscA.wavetable);
            if (nextTable.get() != aetherTableA.get())
            {
                retiredAetherTableA = std::move(aetherTableA);
                aetherTableA = std::move(nextTable);
            }
            WavetableOscillatorBank::configure(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            retiredAetherTableA = std::move(aetherTableA);
            WavetableOscillatorBank::clear(aetherOscillatorsA, aetherUnisonPlanA);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            auto nextTable = WavetableVoiceCache::sharedTableForConfig(params.aetherOscB.wavetable);
            if (nextTable.get() != aetherTableB.get())
            {
                retiredAetherTableB = std::move(aetherTableB);
                aetherTableB = std::move(nextTable);
            }
            WavetableOscillatorBank::configure(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            retiredAetherTableB = std::move(aetherTableB);
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
        filter2State.configure(p.filter2Type, p.filter2Cutoff01, p.filter2Resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
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
        rampSamples = ParameterPolicy::rampLengthFor((size_t) index, rampSamples);
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
            case RealtimeParam::Macro1:
            case RealtimeParam::Macro2:
            case RealtimeParam::Macro3:
            case RealtimeParam::Macro4:
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
        if (stealPrepared)
            stealTransition.beginFrom(lastOutput);
        else
            stealTransition.reset();
        stealPrepared = false;
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
            filter2State.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            refreshCachedPanGains();
            refreshCachedDynamicModulationFlags();
            refreshCachedPitchRates();
            pitchFrequencyRamp.setTarget((float) baseFrequencyHz, glideSamples);
            phaseDelta = baseFrequencyHz / sampleRate;
            loadPendingNoteAutomation(midiNoteNumber);
            return;
        }

        filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        filter2State.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedDynamicModulationFlags();

        std::array<double, 8> rememberedAetherPhasesA {};
        std::array<double, 8> rememberedAetherPhasesB {};
        for (size_t index = 0; index < rememberedAetherPhasesA.size(); ++index)
        {
            rememberedAetherPhasesA[index] = aetherOscillatorsA[index].getPhase();
            rememberedAetherPhasesB[index] = aetherOscillatorsB[index].getPhase();
        }
        phase     = 0.0;
        noiseState = (juce::uint32) (midiNoteNumber * 747796405u + 2891336453u);
        if (params.aetherOscA.phaseMode == 0)
        {
            aetherOscABasePhase = 0.0;
            aetherOscAPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscA.phase)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0xa9f14c31u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscA.randomPhase);
        }
        if (params.aetherOscB.phaseMode == 0)
        {
            aetherOscBBasePhase = 0.0;
            aetherOscBPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.aetherOscB.phase)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x6c8e9cf5u) * juce::jlimit(0.0, 1.0, (double) params.aetherOscB.randomPhase);
        }
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
        aetherRuntimeWarpState.reset();
        driveState.reset();
        filter2DriveState.reset();
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
            for (size_t index = 0; index < aetherOscillatorsA.size(); ++index)
                aetherOscillatorsA[index].setPhase(params.aetherOscA.phaseMode == 1
                    ? rememberedAetherPhasesA[index]
                    : aetherOscAPhaseOffset);
        }
        else
            WavetableOscillatorBank::clear(aetherOscillatorsA, aetherUnisonPlanA);

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            WavetableOscillatorBank::configure(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, sampleRate, baseFrequencyHz);
            for (size_t index = 0; index < aetherOscillatorsB.size(); ++index)
                aetherOscillatorsB[index].setPhase(params.aetherOscB.phaseMode == 1
                    ? rememberedAetherPhasesB[index]
                    : aetherOscBPhaseOffset);
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
            if (!stealPrepared)
            {
                stealTransition.reset();
                lastOutput = {};
            }
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
        currentBlockWork.begin(numSamples, 2);

        for (int i = 0; i < numSamples; ++i)
        {
            if (hasVoiceAutomation)
            {
                advanceVoiceAutomation();
                currentBlockWork.addModulationSamples(1);
            }
            if (realtimeRampState.activeCount > 0)
            {
                currentBlockWork.addRealtimeRampSamples(realtimeRampState.activeCount);
                advanceRealtimeRamps();
            }
            const float rawLfo = needsLfoValue ? Lfo::value(params.lfoWaveform, lfoPhase, params.lfoSmoothing, params.lfoOneShot) : 0.0f;
            const float rawLfo2 = needsLfo2Value ? Lfo::value(params.lfo2Waveform, lfo2Phase, params.lfo2Smoothing, params.lfo2OneShot) : 0.0f;
            if (needsLfoValue || useDynamicModulation)
                currentBlockWork.addModulationSamples(1);
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
                const float oscAFineCents = DynamicModulation::targetOffset(params.dynamicModulation.oscAFine, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 100.0f);
                currentPhaseDelta *= std::exp2(oscAFineCents / 1200.0f);
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation && cachedDynamicTargets.oscAPosition
                ? DynamicModulation::targetOffset(params.dynamicModulation.oscAPosition, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation && cachedDynamicTargets.unisonDetune
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation && cachedDynamicTargets.unisonSpread
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
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
                    aetherOscABasePhase,
                    aetherOscBBasePhase,
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
                currentBlockWork.add(aetherResult.work);
            }
            else
            {
                const float mono = params.waveform == 5
                    ? renderWavetableStack(currentFrequency, positionLfo + dynamicOscAPosition, dynamicUnisonDetune, dynamicUnisonSpread)
                    : params.waveform == 4
                        ? VoiceMath::nextNoise(noiseState)
                        : BasicOscillator::sample(params.waveform, phase, currentPhaseDelta);
                if (params.waveform != 5)
                    currentBlockWork.addOscillatorSamples(1);
                raw = { mono, mono };
            }
            float left = raw.left;
            float right = raw.right;

            if (params.hasAether && params.aetherRuntimeWarp > 0.0001f)
            {
                const auto warped = processRuntimeWarpOversampled(
                    aetherRuntimeWarpState,
                    { left, right },
                    params.aetherRuntimeWarp,
                    params.aetherRuntimeWarpMode);
                left = warped.left;
                right = warped.right;
            }
            else
            {
                aetherRuntimeWarpState.reset({ left, right });
            }

            const float filterInputLeft = left;
            const float filterInputRight = right;

            // Drive (soft clipping)
            const float drive = VoiceMath::clamp01(params.drive01 + (useDynamicModulation && cachedDynamicTargets.filterDrive
                ? DynamicModulation::targetOffset(params.dynamicModulation.filterDrive, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));
            if (drive > 0.0001f)
            {
                const float driveGain = 1.0f + drive * 6.0f;
                const auto driven = DriveStage::processOversampled(driveState, { left, right }, driveGain);
                left = driven.left;
                right = driven.right;
                currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
            }
            else
            {
                driveState.reset({ left, right });
            }

            if (hasFilterMod)
            {
                const float cutoffMod = useDynamicModulation && cachedDynamicTargets.filterCutoff
                    ? DynamicModulation::targetOffset(params.dynamicModulation.filterCutoff, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 0.35f)
                    : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f;
                const int cutoffUpdates = filterState.updateCutoffIfChanged(
                    params.cutoff01 + cutoffMod,
                    sampleRate,
                    params.filterKeytrack,
                    baseFrequencyHz,
                    6.0f);
                currentBlockWork.addFilterCutoffUpdates(cutoffUpdates);
                if (useDynamicModulation && cachedDynamicTargets.filterResonance)
                {
                    const float resonance = VoiceMath::clamp01(params.resonance01
                        + DynamicModulation::targetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f));
                    const int resonanceUpdates = filterState.updateResonanceIfChanged(resonance, 0.001f);
                    currentBlockWork.addFilterResonanceUpdates(resonanceUpdates);
                }
            }
            const auto filtered = filterState.process(left, right);
            left = filtered.left;
            right = filtered.right;

            if (params.filter2Enabled)
            {
                float filter2Left = params.filterRouting == 1 ? filterInputLeft : left;
                float filter2Right = params.filterRouting == 1 ? filterInputRight : right;
                const float filter2Drive = VoiceMath::clamp01(params.filter2Drive01);
                if (filter2Drive > 0.0001f)
                {
                    const float driveGain = 1.0f + filter2Drive * 6.0f;
                    const auto driven = DriveStage::processOversampled(filter2DriveState, { filter2Left, filter2Right }, driveGain);
                    filter2Left = driven.left;
                    filter2Right = driven.right;
                    currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
                }
                else
                {
                    filter2DriveState.reset({ filter2Left, filter2Right });
                }
                const auto filtered2 = filter2State.process(filter2Left, filter2Right);
                if (params.filterRouting == 1)
                {
                    left = (left + filtered2.left) * 0.5f;
                    right = (right + filtered2.right) * 0.5f;
                }
                else
                {
                    left = filtered2.left;
                    right = filtered2.right;
                }
            }
            else
            {
                filter2DriveState.reset({ left, right });
            }

            const float ampLevel = VoiceMath::clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? DynamicModulation::targetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + DynamicModulation::targetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? VoiceMath::equalPowerPanGains(ampPan) : cachedPanGains.amp;
            const float voiceGain = env * level * 0.4f * ampLevel;
            const auto [leftGain, rightGain] = panGains;

            const auto transitioned = stealTransition.process({
                left * leftGain * voiceGain,
                right * rightGain * voiceGain
            });
            lastOutput = transitioned;
            for (int ch = 0; ch < out.getNumChannels(); ++ch)
            {
                const float output = ch == 0 ? transitioned.left
                    : ch == 1 ? transitioned.right
                    : (transitioned.left + transitioned.right) * 0.5f;
                out.addSample(ch, startSample + i, VoiceMath::denormalSafe(output));
            }

            phase += currentPhaseDelta;
            if (phase >= 1.0) phase -= 1.0;
            aetherOscABasePhase += currentPhaseDelta;
            if (aetherOscABasePhase >= 1.0) aetherOscABasePhase -= 1.0;
            aetherOscBBasePhase += currentPhaseDelta;
            if (aetherOscBBasePhase >= 1.0) aetherOscBBasePhase -= 1.0;
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

        VoiceRenderStats::recordBlock(currentBlockWork.snapshot());
    }

    InstrumentVoice::AllocationState InstrumentVoice::allocationState() const noexcept
    {
        return {
            isVoiceActive(),
            isPlayingButReleased(),
            juce::jmax(std::abs(lastOutput.left), std::abs(lastOutput.right)),
            stableVoiceId
        };
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
        currentBlockWork.addWavetableRender(result.voiceSamples, result.frequencyUpdates, result.positionUpdates);
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
