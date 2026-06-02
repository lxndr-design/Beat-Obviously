#include "InstrumentVoice.h"

#include <cmath>
#include <utility>

namespace beat
{
    namespace
    {
        thread_local InstrumentVoice::NoteAutomationContext* pendingNoteAutomationContexts = nullptr;
        thread_local int pendingNoteAutomationContextCount = 0;

        float clamp01(float v)
        {
            return juce::jlimit(0.0f, 1.0f, v);
        }

        float oscillatorSample(int waveform, double phase)
        {
            const float p = (float) (phase - std::floor(phase));
            switch (waveform)
            {
                case 0:  return std::sin(p * juce::MathConstants<float>::twoPi);
                case 1:  return 2.f * p - 1.f;
                case 2:  return p < 0.5f ? 1.f : -1.f;
                case 3:  return 4.f * std::abs(p - 0.5f) - 1.f;
                default: return juce::Random::getSystemRandom().nextFloat() * 2.f - 1.f;
            }
        }

        float nextNoise(juce::uint32& state);

        float lfoValue(int waveform, double phase)
        {
            const float p = (float) (phase - std::floor(phase));
            switch (waveform)
            {
                case 1: return p < 0.5f ? p * 4.0f - 1.0f : 3.0f - p * 4.0f;
                case 2: return p * 2.0f - 1.0f;
                case 3: return p < 0.5f ? 1.0f : -1.0f;
                case 0:
                default: return std::sin(p * juce::MathConstants<float>::twoPi);
            }
        }

        float lfoRouteValue(float raw, bool bipolar) noexcept
        {
            return bipolar ? raw : (raw + 1.0f) * 0.5f;
        }

        float envRouteValue(float env, bool bipolar) noexcept
        {
            return bipolar ? env * 2.0f - 1.0f : env;
        }

        float dynamicTargetOffset(
            const InstrumentVoice::Params::DynamicModTarget& target,
            float rawLfo,
            float env,
            float scale) noexcept
        {
            return (lfoRouteValue(rawLfo, target.lfoBipolar) * target.lfo
                + envRouteValue(env, target.envBipolar) * target.env) * scale;
        }

        float cutoffHz(float normalized, double sampleRate)
        {
            const float minF = 20.0f;
            const float maxF = juce::jmin(20000.0f, (float) sampleRate * 0.45f);
            return minF * std::pow(maxF / minF, clamp01(normalized));
        }

        juce::dsp::StateVariableTPTFilterType filterTypeForParam(int type) noexcept
        {
            switch (type)
            {
                case 1: return juce::dsp::StateVariableTPTFilterType::bandpass;
                case 2: return juce::dsp::StateVariableTPTFilterType::highpass;
                case 0:
                default: return juce::dsp::StateVariableTPTFilterType::lowpass;
            }
        }

        std::pair<float, float> equalPowerPanGains(float pan) noexcept
        {
            const float normalized = (juce::jlimit(-1.0f, 1.0f, pan) + 1.0f) * 0.5f;
            const float angle = normalized * juce::MathConstants<float>::halfPi;
            return { std::cos(angle), std::sin(angle) };
        }

        float nextNoise(juce::uint32& state)
        {
            state = state * 1664525u + 1013904223u;
            return ((state >> 8) * (1.0f / 8388607.5f)) - 1.0f;
        }

        BasicWavetableShape basicShapeForBank(int bank) noexcept
        {
            switch (bank)
            {
                case 1: return BasicWavetableShape::Sine;
                case 2: return BasicWavetableShape::Square;
                case 3: return BasicWavetableShape::Triangle;
                case 4: return BasicWavetableShape::Pulse;
                case 0:
                default: return BasicWavetableShape::Saw;
            }
        }

        std::array<WavetableFactory::CustomFrame, 4> factoryCustomFrames(
            const InstrumentVoice::Params::WavetableConfig& config) noexcept
        {
            std::array<WavetableFactory::CustomFrame, 4> frames;
            for (size_t i = 0; i < frames.size(); ++i)
            {
                frames[i] = {
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].brightness),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].even),
                    juce::jlimit(0.0f, 1.0f, config.customFrames[i].fold),
                    juce::jlimit(-1.0f, 1.0f, config.customFrames[i].phase),
                };
            }
            return frames;
        }

        Wavetable createTableForConfig(const InstrumentVoice::Params::WavetableConfig& config)
        {
            if (config.custom || config.bank == 5)
                return WavetableFactory::createCustom(factoryCustomFrames(config));

            return WavetableFactory::createBasic(basicShapeForBank(config.bank));
        }
    }

    void InstrumentVoice::setPendingNoteAutomationContexts(NoteAutomationContext* contexts, int count) noexcept
    {
        pendingNoteAutomationContexts = contexts;
        pendingNoteAutomationContextCount = juce::jlimit(0, (int) maxPendingNoteAutomationContexts, count);
    }

    void InstrumentVoice::clearPendingNoteAutomationContexts() noexcept
    {
        pendingNoteAutomationContexts = nullptr;
        pendingNoteAutomationContextCount = 0;
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
        filterLeft.prepare({ sr, (juce::uint32) blockSize, 1u });
        filterRight.prepare({ sr, (juce::uint32) blockSize, 1u });
        filterLeft.setType(filterTypeForParam(params.filterType));
        filterRight.setType(filterTypeForParam(params.filterType));
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        baseParams = p;
        params = p;
        params.wavetable.bank = params.wavetableBank;
        params.wavetable.custom = params.wavetableBank == 5;
        params.wavetable.position = params.wavetablePosition;
        params.wavetable.warp = params.wavetableWarp;
        params.wavetable.unison = params.wavetableUnison;
        params.wavetable.detuneCents = params.wavetableDetuneCents;
        params.wavetable.blend = params.wavetableBlend;
        activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
        wavetableTable = createTableForConfig(params.wavetable);
        configureWavetableOscillatorBank(wavetableOscillators, wavetableTable, params.wavetable, baseFrequencyHz);

        aetherTableA = createTableForConfig(params.aetherOscA.wavetable);
        aetherTableB = createTableForConfig(params.aetherOscB.wavetable);
        configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA, params.aetherOscA.wavetable, baseFrequencyHz);
        configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB, params.aetherOscB.wavetable, baseFrequencyHz);
        adsrParams.attack  = juce::jmax(0.001f, p.attackMs  * 0.001f);
        adsrParams.decay   = juce::jmax(0.001f, p.decayMs   * 0.001f);
        adsrParams.sustain = juce::jlimit(0.0f, 1.0f, p.sustain);
        adsrParams.release = juce::jmax(0.001f, p.releaseMs * 0.001f);
        adsr.setParameters(adsrParams);

        filterLeft.setType(filterTypeForParam(p.filterType));
        filterRight.setType(filterTypeForParam(p.filterType));
        filterLeft.setCutoffFrequency(cutoffHz(p.cutoff01, sampleRate));
        filterRight.setCutoffFrequency(cutoffHz(p.cutoff01, sampleRate));
        cachedFilterHz = cutoffHz(p.cutoff01, sampleRate);
        filterLeft.setResonance(0.5f + p.resonance01 * 4.0f);
        filterRight.setResonance(0.5f + p.resonance01 * 4.0f);
        resetRealtimeRampsFromParams();
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
                const float nextFilterHz = cutoffHz(params.cutoff01, sampleRate);
                if (std::abs(nextFilterHz - cachedFilterHz) > 0.5f)
                {
                    filterLeft.setCutoffFrequency(nextFilterHz);
                    filterRight.setCutoffFrequency(nextFilterHz);
                    cachedFilterHz = nextFilterHz;
                }
                break;
            }
            case RealtimeParam::FilterResonance:
                filterLeft.setResonance(0.5f + params.resonance01 * 4.0f);
                filterRight.setResonance(0.5f + params.resonance01 * 4.0f);
                break;
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::AmpPan:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
            case RealtimeParam::OscALevel:
            case RealtimeParam::OscBLevel:
            case RealtimeParam::OscAPan:
            case RealtimeParam::OscBPan:
            case RealtimeParam::UnisonDetune:
            case RealtimeParam::UnisonSpread:
            case RealtimeParam::LfoRate:
            case RealtimeParam::LfoDepth:
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
        voiceAutomationEventCount = 0;
        voicePitchEventCount = 0;
        nextVoiceAutomationEvent = 0;
        nextVoicePitchEvent = 0;
        voiceSamplePosition = 0;

        if (pendingNoteAutomationContexts == nullptr || pendingNoteAutomationContextCount <= 0)
            return;

        for (int i = 0; i < pendingNoteAutomationContextCount; ++i)
        {
            auto& context = pendingNoteAutomationContexts[i];
            if (context.midiNoteNumber != midiNoteNumber)
                continue;

            voiceAutomationEventCount = juce::jlimit(0, (int) maxNoteAutomationEvents, context.eventCount);
            for (int eventIndex = 0; eventIndex < voiceAutomationEventCount; ++eventIndex)
                voiceAutomationEvents[(size_t) eventIndex] = context.events[(size_t) eventIndex];
            voicePitchEventCount = juce::jlimit(0, (int) maxNoteAutomationEvents, context.pitchEventCount);
            for (int eventIndex = 0; eventIndex < voicePitchEventCount; ++eventIndex)
                voicePitchEvents[(size_t) eventIndex] = context.pitchEvents[(size_t) eventIndex];

            context.midiNoteNumber = -1;
            context.eventCount = 0;
            context.pitchEventCount = 0;
            return;
        }
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
                                    juce::SynthesiserSound*, int)
    {
        params = baseParams;
        resetRealtimeRampsFromParams();
        filterLeft.setType(filterTypeForParam(params.filterType));
        filterRight.setType(filterTypeForParam(params.filterType));
        filterLeft.setCutoffFrequency(cutoffHz(params.cutoff01, sampleRate));
        filterRight.setCutoffFrequency(cutoffHz(params.cutoff01, sampleRate));
        cachedFilterHz = cutoffHz(params.cutoff01, sampleRate);
        filterLeft.setResonance(0.5f + params.resonance01 * 4.0f);
        filterRight.setResonance(0.5f + params.resonance01 * 4.0f);

        level     = velocity;
        phase     = 0.0;
        noiseState = (juce::uint32) (midiNoteNumber * 747796405u + 2891336453u);
        if (params.lfoRetrigger) lfoPhase = 0.0;
        baseFrequencyHz = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
        phaseDelta = baseFrequencyHz / sampleRate;
        pitchFrequencyRamp.reset((float) baseFrequencyHz);
        configureWavetableOscillators(baseFrequencyHz);
        configureWavetableOscillatorBank(aetherOscillatorsA, aetherTableA, params.aetherOscA.wavetable, baseFrequencyHz);
        configureWavetableOscillatorBank(aetherOscillatorsB, aetherTableB, params.aetherOscB.wavetable, baseFrequencyHz);
        loadPendingNoteAutomation(midiNoteNumber);
        adsr.noteOn();
    }

    void InstrumentVoice::stopNote(float, bool allowTailOff)
    {
        if (allowTailOff)
        {
            adsr.noteOff();
        }
        else
        {
            adsr.reset();
            clearCurrentNote();
        }
    }

    void InstrumentVoice::renderNextBlock(juce::AudioBuffer<float>& out,
                                          int startSample, int numSamples)
    {
        if (!adsr.isActive()) return;

        const float pitchMod = juce::jmax(0.0f, params.lfoToPitch);
        const bool useDynamicModulation = params.dynamicModulation.active;
        const bool hasPitchMod = !useDynamicModulation && pitchMod > 0.0001f;

        for (int i = 0; i < numSamples; ++i)
        {
            advanceVoiceAutomation();
            advanceRealtimeRamps();
            const bool hasPositionMod = !useDynamicModulation && std::abs(params.lfoDepth) > 0.0001f;
            const bool hasFilterMod = useDynamicModulation
                || std::abs(params.lfoToFilter) > 0.0001f
                || std::abs(params.envToFilter) > 0.0001f;
            const double lfoPhaseDelta = juce::jmax(0.01f, params.lfoRateHz) / sampleRate;
            const float rawLfo = lfoValue(params.lfoWaveform, lfoPhase);
            const float positionLfo = hasPositionMod ? lfoRouteValue(rawLfo, params.lfoPositionBipolar) * clamp01(params.lfoDepth) : 0.0f;
            const float pitchLfo = hasPitchMod ? lfoRouteValue(rawLfo, params.lfoPitchBipolar) : 0.0f;
            const float filterLfo = !useDynamicModulation && hasFilterMod ? lfoRouteValue(rawLfo, params.lfoFilterBipolar) : 0.0f;
            const float env = adsr.getNextSample();
            const double currentPitchFrequency = juce::jmax(1.0f, pitchFrequencyRamp.next());
            double currentPhaseDelta = currentPitchFrequency / sampleRate;
            if (hasPitchMod)
                currentPhaseDelta *= std::pow(2.0, (pitchLfo * pitchMod) / 12.0);
            if (useDynamicModulation && !params.hasAether)
            {
                const float oscAFineCents = dynamicTargetOffset(params.dynamicModulation.oscAFine, rawLfo, env, 100.0f);
                currentPhaseDelta *= std::pow(2.0, oscAFineCents / 1200.0f);
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.oscAPosition, rawLfo, env, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.unisonDetune, rawLfo, env, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.unisonSpread, rawLfo, env, 1.0f)
                : 0.0f;

            // Oscillator
            StereoSample raw;
            if (params.hasAether)
            {
                raw = renderAetherTableStack(currentFrequency, rawLfo, env);
            }
            else
            {
                const float mono = params.waveform == 5
                    ? renderWavetableStack(currentFrequency, positionLfo + dynamicOscAPosition, dynamicUnisonDetune, dynamicUnisonSpread)
                    : params.waveform == 4
                        ? nextNoise(noiseState)
                        : oscillatorSample(params.waveform, phase);
                raw = { mono, mono };
            }
            float left = raw.left;
            float right = raw.right;

            // Drive (soft clipping)
            const float drive = clamp01(params.drive01 + (useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.filterDrive, rawLfo, env, 1.0f)
                : 0.0f));
            left = std::tanh(left * (1.0f + drive * 6.0f));
            right = std::tanh(right * (1.0f + drive * 6.0f));

            if (hasFilterMod)
            {
                const float cutoffMod = useDynamicModulation
                    ? dynamicTargetOffset(params.dynamicModulation.filterCutoff, rawLfo, env, 0.35f)
                    : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f;
                const float nextFilterHz = cutoffHz(params.cutoff01 + cutoffMod, sampleRate);
                if (std::abs(nextFilterHz - cachedFilterHz) > 6.0f)
                {
                    filterLeft.setCutoffFrequency(nextFilterHz);
                    filterRight.setCutoffFrequency(nextFilterHz);
                    cachedFilterHz = nextFilterHz;
                }
                if (useDynamicModulation)
                {
                    const float resonance = clamp01(params.resonance01
                        + dynamicTargetOffset(params.dynamicModulation.filterResonance, rawLfo, env, 1.0f));
                    filterLeft.setResonance(0.5f + resonance * 4.0f);
                    filterRight.setResonance(0.5f + resonance * 4.0f);
                }
            }
            left = filterLeft.processSample(0, left);
            right = filterRight.processSample(0, right);

            const float ampLevel = clamp01(params.ampLevel + (useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.ampLevel, rawLfo, env, 1.0f)
                : 0.0f));
            const float ampPan = juce::jlimit(-1.0f, 1.0f, params.ampPan + (useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.ampPan, rawLfo, env, 1.0f)
                : 0.0f));
            const float voiceGain = env * level * 0.4f * ampLevel;
            const auto [leftGain, rightGain] = equalPowerPanGains(ampPan);

            for (int ch = 0; ch < out.getNumChannels(); ++ch)
            {
                const float sample = ch == 0 ? left * leftGain : ch == 1 ? right * rightGain : (left + right) * 0.5f;
                out.addSample(ch, startSample + i, sample * voiceGain);
            }

            phase += currentPhaseDelta;
            if (phase >= 1.0) phase -= 1.0;
            lfoPhase += lfoPhaseDelta;
            if (lfoPhase >= 1.0) lfoPhase -= 1.0;
            ++voiceSamplePosition;
        }

        if (!adsr.isActive())
            clearCurrentNote();
    }

    void InstrumentVoice::configureWavetableOscillators(double frequencyHz) noexcept
    {
        configureWavetableOscillatorBank(wavetableOscillators, wavetableTable, params.wavetable, frequencyHz);
        activeWavetableUnison = juce::jlimit(1, 8, params.wavetable.unison);
    }

    void InstrumentVoice::configureWavetableOscillatorBank(
        std::array<WavetableOscillator, 8>& oscillators,
        Wavetable& table,
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
            const double rate = std::pow(2.0, (centered * detuneCents) / 1200.0);
            osc.prepare(sampleRate);
            osc.setWavetable(&table);
            osc.setPosition(position);
            osc.setFrequency(frequencyHz * rate);
            osc.reset((double) voice * 0.071 * (double) blend);
        }
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

        const auto& renderPlan = updateWavetableUnisonPlan(plan, config, detuneCentsMod, spreadMod);
        const float modulatedPosition = clamp01(config.position + positionMod);
        float sum = 0.0f;

        for (int voice = 0; voice < renderPlan.unison; ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            osc.setFrequency(frequencyHz * renderPlan.rates[(size_t) voice]);
            osc.setPosition(modulatedPosition);
            osc.setPhase(osc.getPhase() + (double) renderPlan.phaseSpread[(size_t) voice]);
            sum += osc.renderSample() * renderPlan.weights[(size_t) voice];
        }

        return juce::jlimit(-1.0f, 1.0f, sum / juce::jmax(1.0f, renderPlan.weightSum));
    }

    const InstrumentVoice::WavetableUnisonPlan& InstrumentVoice::updateWavetableUnisonPlan(
        WavetableUnisonPlan& plan,
        const Params::WavetableConfig& config,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float detuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents + detuneCentsMod);
        const float spread = clamp01(config.blend + spreadMod);

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
                ? std::pow(2.0, ((double) centered * (double) detuneCents) / 1200.0)
                : 1.0;
            plan.weights[(size_t) voice] = voice < unison ? weight : 0.0f;
            plan.phaseSpread[(size_t) voice] = voice < unison ? centered * 0.00008f * spread : 0.0f;
            if (voice < unison)
                plan.weightSum += weight;
        }

        plan.weightSum = juce::jmax(1.0f, plan.weightSum);
        return plan;
    }

    InstrumentVoice::StereoSample InstrumentVoice::renderAetherTableStack(double frequencyHz, float rawLfo, float env) noexcept
    {
        const bool useDynamicModulation = params.dynamicModulation.active;
        float leftSum = 0.0f;
        float rightSum = 0.0f;
        float levelSum = 0.0f;

        const auto add = [&](float value, float level, float pan)
        {
            const float safeLevel = clamp01(level);
            const auto [leftGain, rightGain] = equalPowerPanGains(pan);
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
            const Params::DynamicModTarget& panTarget)
        {
            const float modulatedLevel = clamp01(osc.level + (useDynamicModulation
                ? dynamicTargetOffset(levelTarget, rawLfo, env, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? dynamicTargetOffset(panTarget, rawLfo, env, 1.0f)
                : 0.0f));

            const float fineCents = osc.fineCents + (useDynamicModulation
                ? dynamicTargetOffset(fineTarget, rawLfo, env, 100.0f)
                : 0.0f);
            const float positionMod = useDynamicModulation
                ? dynamicTargetOffset(positionTarget, rawLfo, env, 1.0f)
                : 0.0f;
            const float detuneMod = useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.unisonDetune, rawLfo, env, 100.0f)
                : 0.0f;
            const float spreadMod = useDynamicModulation
                ? dynamicTargetOffset(params.dynamicModulation.unisonSpread, rawLfo, env, 1.0f)
                : 0.0f;
            const double rate = std::pow(2.0, osc.octave + osc.semitone / 12.0 + fineCents / 1200.0);
            if (osc.waveform == 4)
            {
                add(nextNoise(noiseState), modulatedLevel, modulatedPan);
                return;
            }

            const float value = osc.waveform == 5
                ? renderWavetableOscillatorBank(
                    oscillators,
                    (&oscillators == &aetherOscillatorsA ? aetherUnisonPlanA : aetherUnisonPlanB),
                    osc.wavetable,
                    frequencyHz * rate,
                    positionMod,
                    detuneMod,
                    spreadMod)
                : oscillatorSample(osc.waveform, phase * rate);
            add(value, modulatedLevel, modulatedPan);
        };

        renderOsc(
            params.aetherOscA,
            aetherOscillatorsA,
            params.dynamicModulation.oscAPosition,
            params.dynamicModulation.oscAFine,
            params.dynamicModulation.oscALevel,
            params.dynamicModulation.oscAPan);
        renderOsc(
            params.aetherOscB,
            aetherOscillatorsB,
            params.dynamicModulation.oscBPosition,
            params.dynamicModulation.oscBFine,
            params.dynamicModulation.oscBLevel,
            params.dynamicModulation.oscBPan);

        if (params.aetherSub.enabled && params.aetherSub.level > 0.0f)
        {
            const double rate = std::pow(2.0, params.aetherSub.octave);
            add(oscillatorSample(params.aetherSub.waveform, phase * rate), params.aetherSub.level, 0.0f);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            const float noise = nextNoise(noiseState);
            add(noise * (0.35f + clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level, 0.0f);
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
