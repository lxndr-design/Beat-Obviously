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
        for (auto& osc : lumusOscillatorsC)
            osc.prepare(sampleRate);
        aetherInteractionState.prepare(sampleRate, processingQuality);
        adsr.setSampleRate(sr);
        env2Adsr.setSampleRate(sr);
        env3Adsr.setSampleRate(sr);
        env4Adsr.setSampleRate(sr);
        filterState.prepare(sr, blockSize, params.filterType);
        filter2State.prepare(sr, blockSize, params.filter2Type);
        filter1RouteState.prepare(sr, blockSize, params.filterType);
        filter2RouteState.prepare(sr, blockSize, params.filter2Type);
        stealTransition.prepare(sampleRate);
        for (auto& transition : sourceSendTransitions)
            transition.prepare(sampleRate);
        aetherSampleSlot1.prepare({ sampleRate, blockSize, 2 });
        aetherSfzSlot1.prepare({ sampleRate, blockSize, 2 });
        aetherGranularSlot2.prepare({ sampleRate, blockSize, 2 });
    }

    void InstrumentVoice::setProcessingQuality(AudioQuality quality) noexcept
    {
        processingQuality = quality;
        for (auto& oscillator : wavetableOscillators) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsA) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsB) oscillator.setQuality(quality);
        for (auto& oscillator : lumusOscillatorsC) oscillator.setQuality(quality);
        aetherInteractionState.prepare(sampleRate, quality);
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        baseParams = p;
        params = p;
        modWheel = juce::jlimit(0.0f, 1.0f, p.modWheel);
        pitchWheelSemitones = 0.0f;
        masterPitchWheelSemitones = 0.0f;
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
            activeWavetableUnison = juce::jlimit(1, WavetableUnison::maxVoices, params.wavetable.unison);
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
        if (params.hasLumus && aetherOscillatorNeedsWavetable(params.lumusOscC))
        {
            auto nextTable = WavetableVoiceCache::sharedTableForConfig(params.lumusOscC.wavetable);
            if (nextTable.get() != lumusTableC.get())
            {
                retiredLumusTableC = std::move(lumusTableC);
                lumusTableC = std::move(nextTable);
            }
            WavetableOscillatorBank::configure(lumusOscillatorsC, lumusTableC.get(),
                params.lumusOscC.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            retiredLumusTableC = std::move(lumusTableC);
            WavetableOscillatorBank::clear(lumusOscillatorsC, lumusUnisonPlanC);
        }
        aetherInteractionState.configure(aetherTableA.get(), params.aetherOscA,
                                         aetherTableB.get(), params.aetherOscB,
                                         baseFrequencyHz);
        aetherSampleSlot1.allNotesOff(true);
        aetherSampleSlot1.publish(params.aetherSampleSlot1.enabled ? params.aetherSampleSlot1.source : nullptr);
        aetherSfzSlot1.allNotesOff(true);
        aetherSfzSlot1.publish(params.aetherSampleSlot1.enabled ? params.aetherSampleSlot1.sfzSource : nullptr);
        aetherGranularSlot2.allNotesOff(true);
        aetherGranularSlot2.publish(params.aetherGranularSlot2.enabled ? params.aetherGranularSlot2.source : nullptr);
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
        env3AdsrParams = { juce::jmax(0.001f, p.env3AttackMs * 0.001f), juce::jmax(0.001f, p.env3DecayMs * 0.001f), juce::jlimit(0.0f, 1.0f, p.env3Sustain), juce::jmax(0.001f, p.env3ReleaseMs * 0.001f) };
        env4AdsrParams = { juce::jmax(0.001f, p.env4AttackMs * 0.001f), juce::jmax(0.001f, p.env4DecayMs * 0.001f), juce::jlimit(0.0f, 1.0f, p.env4Sustain), juce::jmax(0.001f, p.env4ReleaseMs * 0.001f) };
        env3Adsr.setParameters(env3AdsrParams);
        env4Adsr.setParameters(env4AdsrParams);

        filterState.configure(p.filterType, p.cutoff01, p.resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        filter2State.configure(p.filter2Type, p.filter2Cutoff01, p.filter2Resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        filter1RouteState.configure(p.filterType, p.cutoff01, p.resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        filter2RouteState.configure(p.filter2Type, p.filter2Cutoff01, p.filter2Resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedPitchRates();
        refreshCachedDynamicModulationFlags();
        realtimeRampState.resetFromParams(params);
    }

    void InstrumentVoice::controllerMoved(int controllerNumber, int controllerValue)
    {
        if (controllerNumber == 1)
            modWheel = juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f);
        else if (controllerNumber == 74)
            timbre = juce::jlimit(0.0f, 1.0f, (float) controllerValue / 127.0f);
    }

    void InstrumentVoice::aftertouchChanged(int newAftertouchValue)
    {
        pressure = juce::jlimit(0.0f, 1.0f, (float) newAftertouchValue / 127.0f);
    }

    void InstrumentVoice::channelPressureChanged(int newChannelPressureValue)
    {
        pressure = juce::jlimit(0.0f, 1.0f, (float) newChannelPressureValue / 127.0f);
    }

    void InstrumentVoice::pitchWheelMoved(int newPitchWheelValue)
    {
        currentPitchWheelValue = juce::jlimit(0, 16383, newPitchWheelValue);
        const float range = memberPitchBendRangeSemitones >= 0.0f
            ? juce::jlimit(0.0f, 96.99f, memberPitchBendRangeSemitones)
            : juce::jlimit(0.0f, 24.0f, params.pitchBendRangeSemitones);
        pitchWheelSemitones = VoiceMath::pitchWheelRatio(newPitchWheelValue)
            * range;
    }

    void InstrumentVoice::setMemberPitchBendRange(float semitones) noexcept
    {
        memberPitchBendRangeSemitones = semitones < 0.0f
            ? -1.0f
            : juce::jlimit(0.0f, 96.99f, semitones);
        pitchWheelMoved(currentPitchWheelValue);
    }

    void InstrumentVoice::setMasterPitchWheel(int wheelValue, float semitones) noexcept
    {
        const float range = semitones >= 0.0f
            ? juce::jlimit(0.0f, 96.99f, semitones)
            : juce::jlimit(0.0f, 24.0f, params.pitchBendRangeSemitones);
        masterPitchWheelSemitones = VoiceMath::pitchWheelRatio(juce::jlimit(0, 16383, wheelValue))
            * range;
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
            case RealtimeParam::Macro5:
            case RealtimeParam::Macro6:
            case RealtimeParam::Macro7:
            case RealtimeParam::Macro8:
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
        {
            stealTransition.beginFrom(lastOutput);
            for (size_t bus = 0; bus < sourceSendTransitions.size(); ++bus)
                sourceSendTransitions[bus].beginFrom(lastSourceSendOutputs[bus]);
        }
        else
        {
            stealTransition.reset();
            for (auto& transition : sourceSendTransitions)
                transition.reset();
        }
        stealPrepared = false;
        const bool legatoRetune = baseParams.legato && adsr.isActive();
        params = baseParams;
        realtimeRampState.resetFromParams(params);
        baseFrequencyHz = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
        level = velocity;
        noteKeytrack = juce::jlimit(0.0f, 1.0f, (float) midiNoteNumber / 127.0f);
        masterPitchWheelSemitones = 0.0f;
        pitchWheelMoved(currentPitchWheel == 0 ? 8192 : currentPitchWheel);
        aetherSampleSlot1.allNotesOff(true);
        aetherSfzSlot1.allNotesOff(true);
        aetherGranularSlot2.allNotesOff(true);
        if (params.hasAether && params.aetherSampleSlot1.enabled)
        {
            if (params.aetherSampleSlot1.sfzSource)
                aetherSfzSlot1.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
            else if (params.aetherSampleSlot1.source)
                aetherSampleSlot1.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
        }
        if (params.hasAether && params.aetherGranularSlot2.enabled && params.aetherGranularSlot2.source)
            aetherGranularSlot2.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });

        if (legatoRetune)
        {
            const int glideSamples = params.glideMs > 0.0f && sampleRate > 0.0
                ? juce::jmax(1, (int) std::round((params.glideMs / 1000.0f) * (float) sampleRate))
                : 0;
            filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter2State.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter1RouteState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter2RouteState.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
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
        filter1RouteState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        filter2RouteState.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedDynamicModulationFlags();

        WavetableUnison::PhaseArray rememberedAetherPhasesA {};
        WavetableUnison::PhaseArray rememberedAetherPhasesB {};
        WavetableUnison::PhaseArray rememberedLumusPhasesC {};
        for (size_t index = 0; index < rememberedAetherPhasesA.size(); ++index)
        {
            rememberedAetherPhasesA[index] = aetherOscillatorsA[index].getPhase();
            rememberedAetherPhasesB[index] = aetherOscillatorsB[index].getPhase();
            rememberedLumusPhasesC[index] = lumusOscillatorsC[index].getPhase();
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
        if (params.hasLumus && params.lumusOscC.phaseMode == 0)
        {
            lumusOscCPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.lumusOscC.phase)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0xd4e12b87u)
                    * juce::jlimit(0.0, 1.0, (double) params.lumusOscC.randomPhase);
        }
        if (params.lfoRetrigger)
            lfoPhase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfoPhaseOffset)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x35a1d7bdu) * juce::jlimit(0.0, 1.0, (double) params.lfoRandomPhase),
                1.0);
        if (params.lfo2Retrigger)
            lfo2Phase = std::fmod(juce::jlimit(0.0, 1.0, (double) params.lfo2PhaseOffset)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0x91c2ef43u) * juce::jlimit(0.0, 1.0, (double) params.lfo2RandomPhase),
                1.0);
        for (size_t index = 0; index < params.extraLfos.size(); ++index)
        {
            const auto& lfo = params.extraLfos[index];
            if (lfo.retrigger)
                extraLfoPhases[index] = std::fmod(juce::jlimit(0.0, 1.0, (double) lfo.phaseOffset)
                    + VoiceMath::deterministicPhaseJitter(noiseState ^ (0x4f1bbcdcu + (juce::uint32) index * 0x9e3779b9u))
                        * juce::jlimit(0.0, 1.0, (double) lfo.randomPhase), 1.0);
        }
        phaseDelta = baseFrequencyHz / sampleRate;
        pitchFrequencyRamp.reset((float) baseFrequencyHz);
        aetherRuntimeWarpState.reset();
        aetherDirectRuntimeWarpState.reset();
        aetherFilter1RuntimeWarpState.reset();
        aetherFilter2RuntimeWarpState.reset();
        aetherRuntimeWarp2State.reset();
        aetherDirectRuntimeWarp2State.reset();
        aetherFilter1RuntimeWarp2State.reset();
        aetherFilter2RuntimeWarp2State.reset();
        driveState.reset();
        filter2DriveState.reset();
        previousRawEnvelope = 0.0f;
        previousRawEnv2Envelope = 0.0f;
        previousRawEnv3Envelope = 0.0f;
        previousRawEnv4Envelope = 0.0f;
        env1LoopState.reset();
        env2LoopState.reset();
        env3LoopState.reset();
        env4LoopState.reset();
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
        if (params.hasLumus && aetherOscillatorNeedsWavetable(params.lumusOscC))
        {
            WavetableOscillatorBank::configure(lumusOscillatorsC, lumusTableC.get(),
                params.lumusOscC.wavetable, sampleRate, baseFrequencyHz);
            for (size_t index = 0; index < lumusOscillatorsC.size(); ++index)
                lumusOscillatorsC[index].setPhase(params.lumusOscC.phaseMode == 1
                    ? rememberedLumusPhasesC[index]
                    : lumusOscCPhaseOffset);
        }
        else
            WavetableOscillatorBank::clear(lumusOscillatorsC, lumusUnisonPlanC);
        WavetableUnison::PhaseArray interactionPhasesA {};
        WavetableUnison::PhaseArray interactionPhasesB {};
        for (size_t index = 0; index < interactionPhasesA.size(); ++index)
        {
            interactionPhasesA[index] = aetherOscillatorsA[index].getPhase();
            interactionPhasesB[index] = aetherOscillatorsB[index].getPhase();
        }
        aetherInteractionState.configure(aetherTableA.get(), params.aetherOscA,
                                         aetherTableB.get(), params.aetherOscB,
                                         baseFrequencyHz);
        aetherInteractionState.setPhases(interactionPhasesA, interactionPhasesB, noiseState);
        refreshCachedPitchRates();
        loadPendingNoteAutomation(midiNoteNumber);
        adsr.noteOn();
        env2Adsr.noteOn();
        env3Adsr.noteOn();
        env4Adsr.noteOn();
    }

    void InstrumentVoice::stopNote(float, bool allowTailOff)
    {
        if (allowTailOff)
        {
            aetherSampleSlot1.noteOff((uint64_t) stableVoiceId);
            aetherSfzSlot1.noteOff((uint64_t) stableVoiceId);
            aetherGranularSlot2.noteOff((uint64_t) stableVoiceId);
        }
        else
        {
            aetherSampleSlot1.allNotesOff(true);
            aetherSfzSlot1.allNotesOff(true);
            aetherGranularSlot2.allNotesOff(true);
        }
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
            if (params.env3Loop) { const float value = env3LoopValue(); env3LoopState.beginRelease(value); previousRawEnv3Envelope = value; }
            else env3Adsr.noteOff();
            if (params.env4Loop) { const float value = env4LoopValue(); env4LoopState.beginRelease(value); previousRawEnv4Envelope = value; }
            else env4Adsr.noteOff();
        }
        else
        {
            adsr.reset();
            env2Adsr.reset();
            env3Adsr.reset();
            env4Adsr.reset();
            env1LoopState.reset();
            env2LoopState.reset();
            env3LoopState.reset();
            env4LoopState.reset();
            clearCurrentNote();
            if (!stealPrepared)
            {
                stealTransition.reset();
                lastOutput = {};
                for (size_t bus = 0; bus < sourceSendTransitions.size(); ++bus)
                {
                    sourceSendTransitions[bus].reset();
                    lastSourceSendOutputs[bus] = {};
                }
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
        const bool needsEnv3Value = modulationPlan.needsEnv3Value;
        const bool needsEnv4Value = modulationPlan.needsEnv4Value;
        const bool hasAmpPanMod = modulationPlan.hasAmpPanMod;
        const double lfoPhaseDelta = juce::jmax(0.01f, params.lfoRateHz) / sampleRate;
        const double lfo2PhaseDelta = juce::jmax(0.01f, params.lfo2RateHz) / sampleRate;
        std::array<double, 8> extraLfoPhaseDeltas {};
        std::array<bool, 8> needsExtraLfoValues {};
        int activeExtraLfoCount = 0;
        for (size_t index = 0; index < params.extraLfos.size(); ++index)
        {
            needsExtraLfoValues[index] = modulationPlan.needsExtraLfoValue[index] && params.extraLfos[index].enabled;
            activeExtraLfoCount += needsExtraLfoValues[index] ? 1 : 0;
            extraLfoPhaseDeltas[index] = juce::jmax(0.01f, params.extraLfos[index].rateHz) / sampleRate;
        }
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
            std::array<float, 8> rawExtraLfos {};
            for (size_t index = 0; index < rawExtraLfos.size(); ++index)
                if (needsExtraLfoValues[index])
                    rawExtraLfos[index] = Lfo::value(params.extraLfos[index].waveform, extraLfoPhases[index],
                        params.extraLfos[index].smoothing, params.extraLfos[index].oneShot);
            if (needsLfoValue || useDynamicModulation)
                currentBlockWork.addModulationSamples(1);
            currentBlockWork.addModulationSamples(activeExtraLfoCount);
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
            const float env3 = needsEnv3Value
                ? (params.env3Loop ? env3LoopValue() : EnvelopeShaper::shapeAdsrSample(env3Adsr.getNextSample(), previousRawEnv3Envelope,
                    params.env3Sustain, params.env3AttackCurve, params.env3DecayCurve, params.env3ReleaseCurve))
                : 0.0f;
            const float env4 = needsEnv4Value
                ? (params.env4Loop ? env4LoopValue() : EnvelopeShaper::shapeAdsrSample(env4Adsr.getNextSample(), previousRawEnv4Envelope,
                    params.env4Sustain, params.env4AttackCurve, params.env4DecayCurve, params.env4ReleaseCurve))
                : 0.0f;
            const double currentPitchFrequency = juce::jmax(1.0f, pitchFrequencyRamp.next())
                * std::exp2((double) (pitchWheelSemitones + masterPitchWheelSemitones) / 12.0);
            double currentPhaseDelta = currentPitchFrequency / sampleRate;
            if (hasPitchMod)
                currentPhaseDelta *= std::exp2((pitchLfo * pitchMod) / 12.0);
            if (useDynamicModulation && !params.hasAether)
            {
                const float oscAFineCents = DynamicModulation::targetOffset(params.dynamicModulation.oscAFine, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 100.0f);
                currentPhaseDelta *= std::exp2(oscAFineCents / 1200.0f);
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation && cachedDynamicTargets.oscAPosition
                ? DynamicModulation::targetOffset(params.dynamicModulation.oscAPosition, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation && cachedDynamicTargets.unisonDetune
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation && cachedDynamicTargets.unisonSpread
                ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f;

            // Oscillator
            StereoSample raw;
            StereoSample directRaw;
            StereoSample filter1Raw;
            StereoSample filter2Raw;
            AetherTableStackRenderer::StereoFrame sampleSourceFrame {};
            AetherTableStackRenderer::StereoFrame granularSourceFrame {};
            AetherTableStackRenderer::StereoFrame lumusSourceFrameC {};
            std::array<AetherTableStackRenderer::StereoFrame, 4> sourceFrames {};
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
                    rawExtraLfos,
                    env,
                    env2,
                    env3,
                    env4,
                    level,
                    noteKeytrack,
                    modWheel,
                    noiseState,
                    pressure,
                    timbre,
                    &aetherInteractionState);
                raw = { aetherResult.filteredFrame.left, aetherResult.filteredFrame.right };
                directRaw = { aetherResult.directFrame.left, aetherResult.directFrame.right };
                filter1Raw = { aetherResult.filter1Frame.left, aetherResult.filter1Frame.right };
                filter2Raw = { aetherResult.filter2Frame.left, aetherResult.filter2Frame.right };
                sourceFrames = aetherResult.sourceFrames;
                currentBlockWork.add(aetherResult.work);
                if (params.hasLumus && params.lumusOscC.enabled)
                {
                    const auto targetOffset = [&](const auto& target, float scale)
                    {
                        return DynamicModulation::targetOffset(target, rawLfo, rawLfo2, rawExtraLfos,
                            env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre,
                            params.macroValues, scale);
                    };
                    const float sourceLevel = VoiceMath::clamp01(params.lumusOscC.level
                        + (useDynamicModulation && cachedDynamicTargets.oscCLevel
                            ? targetOffset(params.dynamicModulation.oscCLevel, 1.0f) : 0.0f));
                    const float sourcePan = juce::jlimit(-1.0f, 1.0f, params.lumusOscC.pan
                        + (useDynamicModulation && cachedDynamicTargets.oscCPan
                            ? targetOffset(params.dynamicModulation.oscCPan, 1.0f) : 0.0f));
                    double sourceRate = cachedPitchRates.oscC;
                    if (useDynamicModulation && cachedDynamicTargets.oscCFine)
                        sourceRate *= std::exp2((double) targetOffset(params.dynamicModulation.oscCFine, 100.0f) / 1200.0);
                    const float positionMod = useDynamicModulation && cachedDynamicTargets.oscCPosition
                        ? targetOffset(params.dynamicModulation.oscCPosition, 1.0f) : 0.0f;
                    const float detuneMod = useDynamicModulation && cachedDynamicTargets.oscCUnisonDetune
                        ? targetOffset(params.dynamicModulation.oscCUnisonDetune, 100.0f) : 0.0f;
                    const float spreadMod = useDynamicModulation && cachedDynamicTargets.oscCUnisonSpread
                        ? targetOffset(params.dynamicModulation.oscCUnisonSpread, 1.0f) : 0.0f;
                    const auto tableResult = WavetableOscillatorBank::renderStereo(
                        lumusOscillatorsC,
                        lumusUnisonPlanC,
                        params.lumusOscC.wavetable,
                        currentFrequency * sourceRate,
                        baseFrequencyHz,
                        sampleRate,
                        positionMod,
                        detuneMod,
                        spreadMod,
                        sourcePan);
                    lumusSourceFrameC = {
                        tableResult.left * sourceLevel,
                        tableResult.right * sourceLevel,
                    };
                    currentBlockWork.addWavetableRender(tableResult.voiceSamples,
                        tableResult.frequencyUpdates, tableResult.positionUpdates);
                    if (params.lumusOscC.routing == 1)
                    {
                        directRaw.left += lumusSourceFrameC.left;
                        directRaw.right += lumusSourceFrameC.right;
                    }
                    else if (params.lumusOscC.routing == 2)
                    {
                        filter1Raw.left += lumusSourceFrameC.left;
                        filter1Raw.right += lumusSourceFrameC.right;
                    }
                    else if (params.lumusOscC.routing == 3)
                    {
                        filter2Raw.left += lumusSourceFrameC.left;
                        filter2Raw.right += lumusSourceFrameC.right;
                    }
                    else if (params.lumusOscC.routing != 4)
                    {
                        raw.left += lumusSourceFrameC.left;
                        raw.right += lumusSourceFrameC.right;
                    }
                }
                if (params.aetherSampleSlot1.enabled
                    && (params.aetherSampleSlot1.source || params.aetherSampleSlot1.sfzSource))
                {
                    const auto mappedFrame = params.aetherSampleSlot1.sfzSource
                        ? SampleSourceSlot::StereoFrame {}
                        : aetherSampleSlot1.renderFrame();
                    const auto sfzFrame = params.aetherSampleSlot1.sfzSource
                        ? aetherSfzSlot1.renderFrame() : SfzSourceSlot::StereoFrame {};
                    const float sampleLeft = mappedFrame.left + sfzFrame.left;
                    const float sampleRight = mappedFrame.right + sfzFrame.right;
                    sampleSourceFrame = { sampleLeft, sampleRight };
                    if (params.aetherSampleSlot1.routing == 1)
                    {
                        directRaw.left += sampleLeft; directRaw.right += sampleRight;
                    }
                    else if (params.aetherSampleSlot1.routing == 2)
                    {
                        filter1Raw.left += sampleLeft; filter1Raw.right += sampleRight;
                    }
                    else if (params.aetherSampleSlot1.routing == 3)
                    {
                        filter2Raw.left += sampleLeft; filter2Raw.right += sampleRight;
                    }
                    else
                    {
                        raw.left += sampleLeft; raw.right += sampleRight;
                    }
                }
                if (params.aetherGranularSlot2.enabled && params.aetherGranularSlot2.source)
                {
                    const auto granular = aetherGranularSlot2.renderFrame();
                    const float granularLeft = granular.left * params.aetherGranularSlot2.level;
                    const float granularRight = granular.right * params.aetherGranularSlot2.level;
                    granularSourceFrame = { granularLeft, granularRight };
                    if (params.aetherGranularSlot2.routing == 1)
                    {
                        directRaw.left += granularLeft; directRaw.right += granularRight;
                    }
                    else if (params.aetherGranularSlot2.routing == 2)
                    {
                        filter1Raw.left += granularLeft; filter1Raw.right += granularRight;
                    }
                    else if (params.aetherGranularSlot2.routing == 3)
                    {
                        filter2Raw.left += granularLeft; filter2Raw.right += granularRight;
                    }
                    else
                    {
                        raw.left += granularLeft; raw.right += granularRight;
                    }
                }
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
            float directLeft = directRaw.left;
            float directRight = directRaw.right;
            float filter1RouteLeft = filter1Raw.left;
            float filter1RouteRight = filter1Raw.right;
            float filter2RouteLeft = filter2Raw.left;
            float filter2RouteRight = filter2Raw.right;

            if (params.hasAether && params.aetherRuntimeWarp > 0.0001f)
            {
                currentBlockWork.addNonlinearSamples(4 * DriveStage::workSamplesForChannels(2));
                const auto warped = processRuntimeWarpOversampled(
                    aetherRuntimeWarpState,
                    { left, right },
                    params.aetherRuntimeWarp,
                    params.aetherRuntimeWarpMode);
                left = warped.left;
                right = warped.right;
                const auto directWarped = processRuntimeWarpOversampled(
                    aetherDirectRuntimeWarpState,
                    { directLeft, directRight },
                    params.aetherRuntimeWarp,
                    params.aetherRuntimeWarpMode);
                directLeft = directWarped.left;
                directRight = directWarped.right;
                const auto filter1Warped = processRuntimeWarpOversampled(aetherFilter1RuntimeWarpState,
                    { filter1RouteLeft, filter1RouteRight }, params.aetherRuntimeWarp, params.aetherRuntimeWarpMode);
                const auto filter2Warped = processRuntimeWarpOversampled(aetherFilter2RuntimeWarpState,
                    { filter2RouteLeft, filter2RouteRight }, params.aetherRuntimeWarp, params.aetherRuntimeWarpMode);
                filter1RouteLeft = filter1Warped.left;
                filter1RouteRight = filter1Warped.right;
                filter2RouteLeft = filter2Warped.left;
                filter2RouteRight = filter2Warped.right;
            }
            else
            {
                aetherRuntimeWarpState.reset({ left, right });
                aetherDirectRuntimeWarpState.reset({ directLeft, directRight });
                aetherFilter1RuntimeWarpState.reset({ filter1RouteLeft, filter1RouteRight });
                aetherFilter2RuntimeWarpState.reset({ filter2RouteLeft, filter2RouteRight });
            }

            const auto processSecondWarp = [&](DriveStage::State& state, float& laneLeft, float& laneRight)
            {
                if (params.hasAether && params.aetherRuntimeWarp2 > 0.0001f)
                {
                    currentBlockWork.addNonlinearSamples(DriveStage::workSamplesForChannels(2));
                    const auto warped = processRuntimeWarpOversampled(state, { laneLeft, laneRight },
                        params.aetherRuntimeWarp2, params.aetherRuntimeWarp2Mode);
                    laneLeft = warped.left;
                    laneRight = warped.right;
                }
                else state.reset({ laneLeft, laneRight });
            };
            processSecondWarp(aetherRuntimeWarp2State, left, right);
            processSecondWarp(aetherDirectRuntimeWarp2State, directLeft, directRight);
            processSecondWarp(aetherFilter1RuntimeWarp2State, filter1RouteLeft, filter1RouteRight);
            processSecondWarp(aetherFilter2RuntimeWarp2State, filter2RouteLeft, filter2RouteRight);

            const float filterInputLeft = left;
            const float filterInputRight = right;

            // Drive (soft clipping)
            const float drive = VoiceMath::clamp01(params.drive01 + (useDynamicModulation && cachedDynamicTargets.filterDrive
                ? DynamicModulation::targetOffset(params.dynamicModulation.filterDrive, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
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
                    ? DynamicModulation::targetOffset(params.dynamicModulation.filterCutoff, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 0.35f)
                    : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f;
                const int cutoffUpdates = filterState.updateCutoffIfChanged(
                    params.cutoff01 + cutoffMod,
                    sampleRate,
                    params.filterKeytrack,
                    baseFrequencyHz,
                    6.0f);
                currentBlockWork.addFilterCutoffUpdates(cutoffUpdates);
                currentBlockWork.addFilterCutoffUpdates(filter1RouteState.updateCutoffIfChanged(
                    params.cutoff01 + cutoffMod, sampleRate, params.filterKeytrack, baseFrequencyHz, 6.0f));
                if (useDynamicModulation && cachedDynamicTargets.filterResonance)
                {
                    const float resonance = VoiceMath::clamp01(params.resonance01
                        + DynamicModulation::targetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f));
                    const int resonanceUpdates = filterState.updateResonanceIfChanged(resonance, 0.001f);
                    currentBlockWork.addFilterResonanceUpdates(resonanceUpdates);
                    currentBlockWork.addFilterResonanceUpdates(filter1RouteState.updateResonanceIfChanged(resonance, 0.001f));
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

            if (params.hasAether && (filter1RouteLeft != 0.0f || filter1RouteRight != 0.0f))
            {
                if (drive > 0.0001f)
                {
                    const auto driven = DriveStage::processOversampled(filter1RouteDriveState,
                        { filter1RouteLeft, filter1RouteRight }, 1.0f + drive * 6.0f);
                    filter1RouteLeft = driven.left;
                    filter1RouteRight = driven.right;
                    currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
                }
                else filter1RouteDriveState.reset({ filter1RouteLeft, filter1RouteRight });
                const auto routed = filter1RouteState.process(filter1RouteLeft, filter1RouteRight);
                left += routed.left;
                right += routed.right;
            }
            else filter1RouteDriveState.reset();

            if (params.hasAether && (filter2RouteLeft != 0.0f || filter2RouteRight != 0.0f))
            {
                const float routeDrive = VoiceMath::clamp01(params.filter2Drive01);
                if (routeDrive > 0.0001f)
                {
                    const auto driven = DriveStage::processOversampled(filter2RouteDriveState,
                        { filter2RouteLeft, filter2RouteRight }, 1.0f + routeDrive * 6.0f);
                    filter2RouteLeft = driven.left;
                    filter2RouteRight = driven.right;
                    currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
                }
                else filter2RouteDriveState.reset({ filter2RouteLeft, filter2RouteRight });
                const auto routed = filter2RouteState.process(filter2RouteLeft, filter2RouteRight);
                left += routed.left;
                right += routed.right;
            }
            else filter2RouteDriveState.reset();

            if (params.hasAether && (directLeft != 0.0f || directRight != 0.0f))
            {
                left += directLeft;
                right += directRight;
            }

            const float ampLevel = VoiceMath::clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? DynamicModulation::targetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + DynamicModulation::targetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, level, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f))
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

            if (params.hasAether && params.hasAetherSourceSends)
            {
                const std::array<std::array<float, 2>, 4> sendLevels {{
                    params.aetherOscA.fxSends,
                    params.aetherOscB.fxSends,
                    params.aetherSub.fxSends,
                    params.aetherNoise.fxSends,
                }};
                for (size_t bus = 0; bus < AetherSourceBusContext::busCount; ++bus)
                {
                    VoiceTransition::Stereo send {};
                    for (size_t source = 0; source < sourceFrames.size(); ++source)
                    {
                        const float sendGain = VoiceMath::clamp01(sendLevels[source][bus]);
                        send.left += sourceFrames[source].left * sendGain;
                        send.right += sourceFrames[source].right * sendGain;
                    }
                    const float sampleSendGain = VoiceMath::clamp01(params.aetherSampleSlot1.fxSends[bus]);
                    send.left += sampleSourceFrame.left * sampleSendGain;
                    send.right += sampleSourceFrame.right * sampleSendGain;
                    const float granularSendGain = VoiceMath::clamp01(params.aetherGranularSlot2.fxSends[bus]);
                    send.left += granularSourceFrame.left * granularSendGain;
                    send.right += granularSourceFrame.right * granularSendGain;
                    const float lumusSendGain = VoiceMath::clamp01(params.lumusOscC.fxSends[bus]);
                    send.left += lumusSourceFrameC.left * lumusSendGain;
                    send.right += lumusSourceFrameC.right * lumusSendGain;
                    send.left *= leftGain * voiceGain;
                    send.right *= rightGain * voiceGain;
                    const auto transitionedSend = sourceSendTransitions[bus].process(send);
                    lastSourceSendOutputs[bus] = transitionedSend;
                    AetherSourceBusContext::add(bus, startSample + i,
                        VoiceMath::denormalSafe(transitionedSend.left),
                        VoiceMath::denormalSafe(transitionedSend.right));
                }
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
            for (size_t index = 0; index < extraLfoPhases.size(); ++index)
            {
                if (!needsExtraLfoValues[index]) continue;
                extraLfoPhases[index] += extraLfoPhaseDeltas[index];
                if (params.extraLfos[index].oneShot) extraLfoPhases[index] = juce::jmin(1.0, extraLfoPhases[index]);
                else if (extraLfoPhases[index] >= 1.0) extraLfoPhases[index] -= 1.0;
            }
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

    float InstrumentVoice::env3LoopValue() noexcept
    {
        return EnvelopeShaper::renderLoop(env3LoopState,
            { params.env3AttackMs, params.env3DecayMs, params.env3Sustain, params.env3ReleaseMs, params.env3AttackCurve, params.env3DecayCurve, params.env3ReleaseCurve },
            sampleRate, previousRawEnv3Envelope).value;
    }

    float InstrumentVoice::env4LoopValue() noexcept
    {
        return EnvelopeShaper::renderLoop(env4LoopState,
            { params.env4AttackMs, params.env4DecayMs, params.env4Sustain, params.env4ReleaseMs, params.env4AttackCurve, params.env4DecayCurve, params.env4ReleaseCurve },
            sampleRate, previousRawEnv4Envelope).value;
    }

    void InstrumentVoice::configureWavetableOscillators(double frequencyHz) noexcept
    {
        WavetableOscillatorBank::configure(wavetableOscillators, wavetableTable.get(), params.wavetable, sampleRate, frequencyHz);
        WavetableUnison::invalidate(wavetableUnisonPlan);
        activeWavetableUnison = juce::jlimit(1, WavetableUnison::maxVoices, params.wavetable.unison);
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
