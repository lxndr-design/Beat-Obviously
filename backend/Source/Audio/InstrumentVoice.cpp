#include "InstrumentVoice.h"

#include "Modulation/DynamicModulation.h"
#include "Modulation/Lfo.h"
#include "Oscillator/BasicOscillator.h"
#include "Oscillator/VoiceMath.h"
#include "Oscillator/VoiceRenderStats.h"
#include "Realtime/VoiceAutomationInbox.h"
#include "Wavetable/WavetableVoiceCache.h"

#include <cmath>

namespace beat
{
    namespace
    {
        float clamp01(float v)
        {
            return juce::jlimit(0.0f, 1.0f, v);
        }
    }

    void InstrumentVoice::setPendingNoteAutomationContexts(NoteAutomationContext* contexts, int count) noexcept
    {
        VoiceAutomationInbox::setPending(contexts, count);
    }

    void InstrumentVoice::clearPendingNoteAutomationContexts() noexcept
    {
        VoiceAutomationInbox::clearPending();
    }

    InstrumentVoice::WavetableCacheStats InstrumentVoice::getWavetableCacheStats() noexcept
    {
        return WavetableVoiceCache::stats();
    }

    InstrumentVoice::RenderWorkStats InstrumentVoice::consumeRenderWorkStats() noexcept
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
            configureWavetableOscillatorBank(wavetableOscillators, wavetableTable.get(), params.wavetable, baseFrequencyHz);
            invalidateWavetableBankCache(wavetableUnisonPlan);
        }
        else
        {
            activeWavetableUnison = 1;
            wavetableTable.reset();
            clearWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            aetherTableA = WavetableVoiceCache::sharedTableForConfig(params.aetherOscA.wavetable);
            configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, baseFrequencyHz);
        }
        else
        {
            aetherTableA.reset();
            clearWavetableOscillatorBank(aetherOscillatorsA, aetherUnisonPlanA);
        }

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            aetherTableB = WavetableVoiceCache::sharedTableForConfig(params.aetherOscB.wavetable);
            configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, baseFrequencyHz);
        }
        else
        {
            aetherTableB.reset();
            clearWavetableOscillatorBank(aetherOscillatorsB, aetherUnisonPlanB);
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
        resetRealtimeRampsFromParams();
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

    void InstrumentVoice::RealtimeRamp::reset(float value) noexcept
    {
        current = value;
        target = value;
        step = 0.0f;
        remaining = 0;
    }

    void InstrumentVoice::RealtimeRamp::setTarget(float value, int rampSamples) noexcept
    {
        target = value;
        remaining = juce::jmax(0, rampSamples);
        if (remaining == 0)
        {
            reset(value);
            return;
        }
        step = (target - current) / (float) remaining;
    }

    float InstrumentVoice::RealtimeRamp::next() noexcept
    {
        if (remaining <= 0)
            return current;
        current += step;
        --remaining;
        if (remaining == 0)
            current = target;
        return current;
    }

    namespace
    {
        int realtimeParamIndexForId(std::string_view parameterId) noexcept
        {
            if (parameterId == "filter.cutoff") return 0;
            if (parameterId == "filter.resonance") return 1;
            if (parameterId == "filter.drive") return 2;
            if (parameterId == "amp.level") return 3;
            if (parameterId == "amp.pan") return 4;
            if (parameterId == "osc.a.position") return 5;
            if (parameterId == "osc.b.position") return 6;
            if (parameterId == "osc.a.fine") return 7;
            if (parameterId == "osc.b.fine") return 8;
            if (parameterId == "osc.a.level") return 9;
            if (parameterId == "osc.b.level") return 10;
            if (parameterId == "osc.a.pan") return 11;
            if (parameterId == "osc.b.pan") return 12;
            if (parameterId == "unison.detune") return 13;
            if (parameterId == "unison.spread") return 14;
            if (parameterId == "lfo.1.rate") return 15;
            if (parameterId == "lfo.1.depth") return 16;
            return -1;
        }
    }

    void InstrumentVoice::resetRealtimeRampsFromParams() noexcept
    {
        realtimeRamps[(size_t) RealtimeParam::FilterCutoff].reset(params.cutoff01);
        realtimeRamps[(size_t) RealtimeParam::FilterResonance].reset(params.resonance01);
        realtimeRamps[(size_t) RealtimeParam::FilterDrive].reset(params.drive01);
        realtimeRamps[(size_t) RealtimeParam::AmpLevel].reset(params.ampLevel);
        realtimeRamps[(size_t) RealtimeParam::AmpPan].reset(params.ampPan);
        realtimeRamps[(size_t) RealtimeParam::OscAPosition].reset(params.aetherOscA.wavetable.position);
        realtimeRamps[(size_t) RealtimeParam::OscBPosition].reset(params.aetherOscB.wavetable.position);
        realtimeRamps[(size_t) RealtimeParam::OscAFine].reset(params.aetherOscA.fineCents);
        realtimeRamps[(size_t) RealtimeParam::OscBFine].reset(params.aetherOscB.fineCents);
        realtimeRamps[(size_t) RealtimeParam::OscALevel].reset(params.aetherOscA.level);
        realtimeRamps[(size_t) RealtimeParam::OscBLevel].reset(params.aetherOscB.level);
        realtimeRamps[(size_t) RealtimeParam::OscAPan].reset(params.aetherOscA.pan);
        realtimeRamps[(size_t) RealtimeParam::OscBPan].reset(params.aetherOscB.pan);
        realtimeRamps[(size_t) RealtimeParam::UnisonDetune].reset(params.wavetableDetuneCents);
        realtimeRamps[(size_t) RealtimeParam::UnisonSpread].reset(params.wavetableBlend);
        realtimeRamps[(size_t) RealtimeParam::LfoRate].reset(params.lfoRateHz);
        realtimeRamps[(size_t) RealtimeParam::LfoDepth].reset(params.lfoDepth);
        activeRealtimeRampCount = 0;
    }

    void InstrumentVoice::setRealtimeRamp(RealtimeParam param, float value, int rampSamples) noexcept
    {
        auto& ramp = realtimeRamps[(size_t) param];
        ramp.setTarget(value, rampSamples);
        if (rampSamples <= 0)
        {
            deactivateRealtimeRamp(param);
            applyRealtimeValue(param, ramp.current);
            return;
        }
        activateRealtimeRamp(param);
    }

    void InstrumentVoice::activateRealtimeRamp(RealtimeParam param) noexcept
    {
        const auto index = (size_t) param;
        for (int i = 0; i < activeRealtimeRampCount; ++i)
            if (activeRealtimeRampIndices[(size_t) i] == index)
                return;

        if (activeRealtimeRampCount >= (int) activeRealtimeRampIndices.size())
            return;

        activeRealtimeRampIndices[(size_t) activeRealtimeRampCount] = index;
        ++activeRealtimeRampCount;
    }

    void InstrumentVoice::deactivateRealtimeRamp(RealtimeParam param) noexcept
    {
        const auto index = (size_t) param;
        for (int i = 0; i < activeRealtimeRampCount; ++i)
        {
            if (activeRealtimeRampIndices[(size_t) i] != index)
                continue;

            --activeRealtimeRampCount;
            if (i != activeRealtimeRampCount)
                activeRealtimeRampIndices[(size_t) i] = activeRealtimeRampIndices[(size_t) activeRealtimeRampCount];
            return;
        }
    }

    bool InstrumentVoice::applyRealtimeParameter(std::string_view parameterId, float value, int rampSamples) noexcept
    {
        return setRealtimeParameterValue(parameterId, value, rampSamples, true);
    }

    bool InstrumentVoice::setRealtimeParameterValue(std::string_view parameterId, float value, int rampSamples, bool updateBaseline) noexcept
    {
        const auto normalized = clamp01(value);
        const int index = realtimeParamIndexForId(parameterId);
        if (index < 0)
            return false;

        const auto param = (RealtimeParam) index;
        if (!isVoiceActive())
            rampSamples = 0;
        if (updateBaseline)
            applyParamToParams(baseParams, param, value);
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
            case RealtimeParam::FilterResonance:
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
            case RealtimeParam::OscALevel:
            case RealtimeParam::OscBLevel:
            case RealtimeParam::UnisonSpread:
            case RealtimeParam::LfoDepth:
                setRealtimeRamp(param, normalized, rampSamples);
                return true;
            case RealtimeParam::AmpPan:
            case RealtimeParam::OscAPan:
            case RealtimeParam::OscBPan:
                setRealtimeRamp(param, juce::jlimit(-1.0f, 1.0f, value), rampSamples);
                return true;
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
                setRealtimeRamp(param, juce::jlimit(-100.0f, 100.0f, value), rampSamples);
                return true;
            case RealtimeParam::UnisonDetune:
                setRealtimeRamp(param, juce::jlimit(0.0f, 100.0f, value), rampSamples);
                return true;
            case RealtimeParam::LfoRate:
                setRealtimeRamp(param, juce::jlimit(0.01f, 50.0f, value), rampSamples);
                return true;
            case RealtimeParam::Count:
                break;
        }
        return false;
    }

    void InstrumentVoice::applyParamToParams(Params& target, RealtimeParam param, float value) noexcept
    {
        switch (param)
        {
            case RealtimeParam::FilterCutoff:
                target.cutoff01 = clamp01(value);
                break;
            case RealtimeParam::FilterResonance:
                target.resonance01 = clamp01(value);
                break;
            case RealtimeParam::FilterDrive:
                target.drive01 = clamp01(value);
                break;
            case RealtimeParam::AmpLevel:
                target.ampLevel = clamp01(value);
                break;
            case RealtimeParam::AmpPan:
                target.ampPan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::OscAPosition:
                target.wavetablePosition = clamp01(value);
                target.wavetable.position = target.wavetablePosition;
                target.aetherOscA.wavetable.position = target.wavetablePosition;
                break;
            case RealtimeParam::OscBPosition:
                target.aetherOscB.wavetable.position = clamp01(value);
                break;
            case RealtimeParam::OscAFine:
                target.aetherOscA.fineCents = juce::jlimit(-100.0f, 100.0f, value);
                break;
            case RealtimeParam::OscBFine:
                target.aetherOscB.fineCents = juce::jlimit(-100.0f, 100.0f, value);
                break;
            case RealtimeParam::OscALevel:
                target.aetherOscA.level = clamp01(value);
                break;
            case RealtimeParam::OscBLevel:
                target.aetherOscB.level = clamp01(value);
                break;
            case RealtimeParam::OscAPan:
                target.aetherOscA.pan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::OscBPan:
                target.aetherOscB.pan = juce::jlimit(-1.0f, 1.0f, value);
                break;
            case RealtimeParam::UnisonDetune:
                target.wavetableDetuneCents = juce::jlimit(0.0f, 100.0f, value);
                target.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscA.wavetable.detuneCents = target.wavetableDetuneCents;
                target.aetherOscB.wavetable.detuneCents = target.wavetableDetuneCents;
                break;
            case RealtimeParam::UnisonSpread:
                target.wavetableBlend = clamp01(value);
                target.wavetable.blend = target.wavetableBlend;
                target.aetherOscA.wavetable.blend = target.wavetableBlend;
                target.aetherOscB.wavetable.blend = target.wavetableBlend;
                break;
            case RealtimeParam::LfoRate:
                target.lfoRateHz = juce::jlimit(0.01f, 50.0f, value);
                break;
            case RealtimeParam::LfoDepth:
                target.lfoDepth = clamp01(value);
                break;
            case RealtimeParam::Count:
                break;
        }
    }

    void InstrumentVoice::applyRealtimeValue(RealtimeParam param, float value) noexcept
    {
        applyParamToParams(params, param, value);
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
            case RealtimeParam::Count:
                break;
        }
    }

    void InstrumentVoice::advanceRealtimeRamps() noexcept
    {
        int writeIndex = 0;
        for (int readIndex = 0; readIndex < activeRealtimeRampCount; ++readIndex)
        {
            const auto paramIndex = activeRealtimeRampIndices[(size_t) readIndex];
            auto& ramp = realtimeRamps[paramIndex];
            if (!ramp.active())
                continue;
            applyRealtimeValue((RealtimeParam) paramIndex, ramp.next());
            if (ramp.active())
            {
                activeRealtimeRampIndices[(size_t) writeIndex] = paramIndex;
                ++writeIndex;
            }
        }
        activeRealtimeRampCount = writeIndex;
    }

    void InstrumentVoice::loadPendingNoteAutomation(int midiNoteNumber) noexcept
    {
        nextVoiceAutomationEvent = 0;
        nextVoicePitchEvent = 0;
        voiceSamplePosition = 0;
        VoiceAutomationInbox::consumeForNote(
            midiNoteNumber,
            voiceAutomationEvents,
            voiceAutomationEventCount,
            voicePitchEvents,
            voicePitchEventCount);
    }

    void InstrumentVoice::advanceVoiceAutomation() noexcept
    {
        while (nextVoicePitchEvent < voicePitchEventCount)
        {
            const auto& event = voicePitchEvents[(size_t) nextVoicePitchEvent];
            if (event.sampleOffset > voiceSamplePosition)
                break;
            pitchFrequencyRamp.setTarget(juce::jlimit(1.0f, 24000.0f, event.frequencyHz), event.rampSamples);
            ++nextVoicePitchEvent;
        }

        while (nextVoiceAutomationEvent < voiceAutomationEventCount)
        {
            const auto& event = voiceAutomationEvents[(size_t) nextVoiceAutomationEvent];
            if (event.sampleOffset > voiceSamplePosition)
                break;
            setRealtimeParameterValue(event.parameterIdView(), event.value, event.rampSamples, false);
            ++nextVoiceAutomationEvent;
        }
    }

    void InstrumentVoice::startNote(int midiNoteNumber, float velocity,
                                    juce::SynthesiserSound*, int currentPitchWheel)
    {
        const bool legatoRetune = baseParams.legato && adsr.isActive();
        params = baseParams;
        resetRealtimeRampsFromParams();
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
            clearWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan);
        if (aetherOscillatorNeedsWavetable(params.aetherOscA))
        {
            configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA.get(), params.aetherOscA.wavetable, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsA)
                osc.setPhase(aetherOscAPhaseOffset);
        }
        else
            clearWavetableOscillatorBank(aetherOscillatorsA, aetherUnisonPlanA);

        if (aetherOscillatorNeedsWavetable(params.aetherOscB))
        {
            configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB.get(), params.aetherOscB.wavetable, baseFrequencyHz);
            for (auto& osc : aetherOscillatorsB)
                osc.setPhase(aetherOscBPhaseOffset);
        }
        else
            clearWavetableOscillatorBank(aetherOscillatorsB, aetherUnisonPlanB);
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
        const bool hasVoiceAutomation = voicePitchEventCount > 0 || voiceAutomationEventCount > 0;
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
            if (activeRealtimeRampCount > 0)
            {
                realtimeRampSamples += activeRealtimeRampCount;
                advanceRealtimeRamps();
            }
            const float rawLfo = needsLfoValue ? Lfo::value(params.lfoWaveform, lfoPhase, params.lfoSmoothing, params.lfoOneShot) : 0.0f;
            const float rawLfo2 = needsLfo2Value ? Lfo::value(params.lfo2Waveform, lfo2Phase, params.lfo2Smoothing, params.lfo2OneShot) : 0.0f;
            if (needsLfoValue || useDynamicModulation)
                ++modulationSamples;
            const float positionLfo = hasPositionMod ? Lfo::routeValue(rawLfo, params.lfoPositionBipolar) * clamp01(params.lfoDepth) : 0.0f;
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
                raw = renderAetherTableStack(currentFrequency, rawLfo, rawLfo2, env, env2, level);
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
            const float drive = clamp01(params.drive01 + (useDynamicModulation && cachedDynamicTargets.filterDrive
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
                    const float resonance = clamp01(params.resonance01
                        + DynamicModulation::targetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f));
                    const int resonanceUpdates = filterState.updateResonanceIfChanged(resonance, 0.001f);
                    currentBlockFilterResonanceUpdates += resonanceUpdates;
                    currentBlockFilterCoefficientUpdates += resonanceUpdates;
                }
            }
            const auto filtered = filterState.process(left, right);
            left = filtered.left;
            right = filtered.right;

            const float ampLevel = clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? DynamicModulation::targetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + DynamicModulation::targetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? VoiceMath::equalPowerPanGains(ampPan) : cachedAmpPanGains;
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
            ++voiceSamplePosition;
        }

        if (!adsr.isActive())
            clearCurrentNote();

        RenderWorkStats blockStats;
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
        configureWavetableOscillatorBank(wavetableOscillators, wavetableTable.get(), params.wavetable, frequencyHz);
        invalidateWavetableBankCache(wavetableUnisonPlan);
        activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
    }

    void InstrumentVoice::configureWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        const Wavetable* table,
        const Params::WavetableConfig& config,
        double frequencyHz) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float detuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents);
        const float blend = clamp01(config.blend);
        const float position = clamp01(config.position);

        for (int voice = 0; voice < (int) oscillators.size(); ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const float centered = unison == 1
                ? 0.0f
                : ((float) voice / (float) (unison - 1)) * 2.0f - 1.0f;
            const double rate = std::exp2((centered * detuneCents) / 1200.0);
            osc.prepare(sampleRate);
            osc.setWavetable(table);
            osc.setPosition(position);
            osc.setFrequency(frequencyHz * rate);
            osc.reset((double) voice * 0.071 * (double) blend + (double) centered * 0.00008 * (double) blend);
        }
    }

    void InstrumentVoice::clearWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        WavetableUnisonPlan& plan) noexcept
    {
        for (auto& osc : oscillators)
            osc.setWavetable(nullptr);
        invalidateWavetableBankCache(plan);
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
        return renderWavetableOscillatorBank(wavetableOscillators, wavetableUnisonPlan, params.wavetable, frequencyHz, positionMod, detuneCentsMod, spreadMod);
    }

    float InstrumentVoice::renderWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        WavetableUnisonPlan& plan,
        const Params::WavetableConfig& config,
        double frequencyHz,
        float positionMod,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        if (!std::isfinite(frequencyHz) || frequencyHz <= 0.0)
            frequencyHz = baseFrequencyHz;

        auto& renderPlan = updateWavetableUnisonPlan(plan, config, detuneCentsMod, spreadMod);
        const float modulatedPosition = VoiceMath::quantizeWavetablePosition(config.position + positionMod);
        float sum = 0.0f;
        currentBlockWavetableVoiceSamples += renderPlan.unison;

        for (int voice = 0; voice < renderPlan.unison; ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const auto index = (size_t) voice;
            const double phaseDriftHz = (double) renderPlan.phaseSpread[index] * sampleRate;
            const double nextFrequencyHz = VoiceMath::quantizeWavetableFrequency(frequencyHz * renderPlan.rates[index] + phaseDriftHz);
            if (std::abs(nextFrequencyHz - renderPlan.appliedFrequencyHz[index]) > 0.000001)
            {
                osc.setFrequency(nextFrequencyHz);
                renderPlan.appliedFrequencyHz[index] = nextFrequencyHz;
                ++currentBlockWavetableFrequencyUpdates;
            }

            if (std::abs(modulatedPosition - renderPlan.appliedPosition[index]) > 0.000001f)
            {
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++currentBlockWavetablePositionUpdates;
            }
            sum += osc.renderSample() * renderPlan.weights[(size_t) voice];
        }

        return juce::jlimit(-1.0f, 1.0f, sum / juce::jmax(1.0f, renderPlan.weightSum));
    }

    InstrumentVoice::WavetableUnisonPlan& InstrumentVoice::updateWavetableUnisonPlan(
        WavetableUnisonPlan& plan,
        const Params::WavetableConfig& config,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float rawDetuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents + detuneCentsMod);
        const float rawSpread = clamp01(config.blend + spreadMod);
        const float detuneCents = std::round(rawDetuneCents * 10.0f) * 0.1f;
        const float spread = std::round(rawSpread * 512.0f) / 512.0f;

        if (plan.unison == unison
            && std::abs(plan.detuneCents - detuneCents) < 0.0001f
            && std::abs(plan.spread - spread) < 0.0001f)
            return plan;

        plan.unison = unison;
        plan.detuneCents = detuneCents;
        plan.spread = spread;
        plan.weightSum = 0.0f;

        for (int voice = 0; voice < (int) plan.rates.size(); ++voice)
        {
            const float centered = unison == 1
                ? 0.0f
                : ((float) voice / (float) (unison - 1)) * 2.0f - 1.0f;
            const float weight = voice == 0 ? 1.0f : 0.72f;
            plan.centered[(size_t) voice] = centered;
            plan.rates[(size_t) voice] = voice < unison
                ? std::exp2(((double) centered * (double) detuneCents) / 1200.0)
                : 1.0;
            plan.weights[(size_t) voice] = voice < unison ? weight : 0.0f;
            plan.phaseSpread[(size_t) voice] = voice < unison ? centered * 0.00008f * spread : 0.0f;
            if (voice < unison)
                plan.weightSum += weight;
        }

        plan.weightSum = juce::jmax(1.0f, plan.weightSum);
        invalidateWavetableBankCache(plan);
        return plan;
    }

    void InstrumentVoice::invalidateWavetableBankCache(WavetableUnisonPlan& plan) noexcept
    {
        plan.appliedFrequencyHz.fill(-1.0);
        plan.appliedPosition.fill(-1.0f);
    }

    void InstrumentVoice::refreshCachedPanGains() noexcept
    {
        cachedAmpPanGains = VoiceMath::equalPowerPanGains(params.ampPan);
        cachedAetherOscAPanGains = VoiceMath::equalPowerPanGains(params.aetherOscA.pan);
        cachedAetherOscBPanGains = VoiceMath::equalPowerPanGains(params.aetherOscB.pan);
    }

    void InstrumentVoice::refreshCachedPitchRates() noexcept
    {
        cachedAetherOscARate = VoiceMath::pitchRate(params.aetherOscA.octave,
                                                    params.aetherOscA.semitone,
                                                    params.aetherOscA.fineCents);
        cachedAetherOscBRate = VoiceMath::pitchRate(params.aetherOscB.octave,
                                                    params.aetherOscB.semitone,
                                                    params.aetherOscB.fineCents);
        cachedAetherSubRate = std::exp2((double) params.aetherSub.octave);
    }

    void InstrumentVoice::refreshCachedDynamicModulationFlags() noexcept
    {
        cachedDynamicTargets = DynamicModulation::targetActivityFlags(params.dynamicModulation);
    }

    InstrumentVoice::StereoSample InstrumentVoice::renderAetherTableStack(double frequencyHz, float rawLfo, float rawLfo2, float env, float env2, float velocity) noexcept
    {
        const bool useDynamicModulation = params.dynamicModulation.active && cachedDynamicTargets.any;
        const float unisonDetuneMod = useDynamicModulation && cachedDynamicTargets.unisonDetune
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 100.0f)
            : 0.0f;
        const float unisonSpreadMod = useDynamicModulation && cachedDynamicTargets.unisonSpread
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 1.0f)
            : 0.0f;
        float leftSum = 0.0f;
        float rightSum = 0.0f;
        float levelSum = 0.0f;

        const auto add = [&](float value, float level, float pan, std::pair<float, float> staticPanGains, bool panIsDynamic)
        {
            const float safeLevel = clamp01(level);
            const auto [leftGain, rightGain] = panIsDynamic ? VoiceMath::equalPowerPanGains(pan) : staticPanGains;
            leftSum += value * safeLevel * leftGain;
            rightSum += value * safeLevel * rightGain;
            levelSum += safeLevel;
        };

        const auto renderOsc = [&](
            const Params::AetherOscillator& osc,
            std::array<WavetableOscillator, 8>& oscillators,
            const Params::DynamicModTarget& positionTarget,
            const Params::DynamicModTarget& fineTarget,
            const Params::DynamicModTarget& levelTarget,
            const Params::DynamicModTarget& panTarget,
            std::pair<float, float> staticPanGains,
            bool panIsDynamic,
            bool fineIsDynamic,
            bool positionIsDynamic,
            bool levelIsDynamic,
            double staticRate,
            double phaseOffset,
            int64_t& componentSampleCounter)
        {
            const float modulatedLevel = clamp01(osc.level + (useDynamicModulation && levelIsDynamic
                ? DynamicModulation::targetOffset(levelTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? DynamicModulation::targetOffset(panTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 1.0f)
                : 0.0f));

            const float positionMod = useDynamicModulation && positionIsDynamic
                ? DynamicModulation::targetOffset(positionTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 1.0f)
                : 0.0f;
            if (osc.waveform == 4)
            {
                ++currentBlockOscillatorSamples;
                ++componentSampleCounter;
                add(VoiceMath::nextNoise(noiseState), modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
                return;
            }

            double rate = staticRate;
            if (fineIsDynamic)
            {
                const float fineOffsetCents = DynamicModulation::targetOffset(fineTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, 100.0f);
                rate *= std::exp2((double) fineOffsetCents / 1200.0);
                ++currentBlockOscillatorRateCalculations;
            }

            float value = 0.0f;
            if (osc.waveform == 5)
            {
                const auto before = currentBlockWavetableVoiceSamples;
                value = renderWavetableOscillatorBank(
                    oscillators,
                    (&oscillators == &aetherOscillatorsA ? aetherUnisonPlanA : aetherUnisonPlanB),
                    osc.wavetable,
                    frequencyHz * rate,
                    positionMod,
                    unisonDetuneMod,
                    unisonSpreadMod);
                componentSampleCounter += currentBlockWavetableVoiceSamples - before;
            }
            else
            {
                value = BasicOscillator::sample(osc.waveform, phase * rate + phaseOffset, (frequencyHz * rate) / sampleRate);
                ++currentBlockOscillatorSamples;
                ++componentSampleCounter;
            }
            add(value, modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
        };

        renderOsc(
            params.aetherOscA,
            aetherOscillatorsA,
            params.dynamicModulation.oscAPosition,
            params.dynamicModulation.oscAFine,
            params.dynamicModulation.oscALevel,
            params.dynamicModulation.oscAPan,
            cachedAetherOscAPanGains,
            cachedDynamicTargets.oscAPan,
            cachedDynamicTargets.oscAFine,
            cachedDynamicTargets.oscAPosition,
            cachedDynamicTargets.oscALevel,
            cachedAetherOscARate,
            aetherOscAPhaseOffset,
            currentBlockAetherOscASamples);
        renderOsc(
            params.aetherOscB,
            aetherOscillatorsB,
            params.dynamicModulation.oscBPosition,
            params.dynamicModulation.oscBFine,
            params.dynamicModulation.oscBLevel,
            params.dynamicModulation.oscBPan,
            cachedAetherOscBPanGains,
            cachedDynamicTargets.oscBPan,
            cachedDynamicTargets.oscBFine,
            cachedDynamicTargets.oscBPosition,
            cachedDynamicTargets.oscBLevel,
            cachedAetherOscBRate,
            aetherOscBPhaseOffset,
            currentBlockAetherOscBSamples);

        if (params.aetherSub.enabled && params.aetherSub.level > 0.0f)
        {
            ++currentBlockOscillatorSamples;
            ++currentBlockAetherSubSamples;
            add(BasicOscillator::sample(params.aetherSub.waveform, phase * cachedAetherSubRate, (frequencyHz * cachedAetherSubRate) / sampleRate),
                params.aetherSub.level,
                0.0f,
                VoiceMath::centerPanGains,
                false);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            ++currentBlockOscillatorSamples;
            ++currentBlockAetherNoiseSamples;
            const float noise = VoiceMath::nextNoise(noiseState);
            add(noise * (0.35f + clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level, 0.0f, VoiceMath::centerPanGains, false);
        }

        if (levelSum <= 0.0f)
            return {};

        const float normalizer = juce::jmax(0.35f, levelSum);
        return {
            juce::jlimit(-1.0f, 1.0f, leftSum / normalizer),
            juce::jlimit(-1.0f, 1.0f, rightSum / normalizer),
        };
    }
}
