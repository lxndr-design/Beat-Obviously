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
        constexpr float aurumMaximumRouteAmount = 1.0f;
        constexpr float aurumMaximumFmSum = 6.0f;
        constexpr float aurumMaximumRingGain = 1.0f;
        constexpr float aurumMaximumFeedbackSample = 1.0f;
        constexpr float aurumFmPhaseScale = 1.9f;

        float aurumRouteAmount(float amount) noexcept
        {
            return std::isfinite(amount)
                ? juce::jlimit(-aurumMaximumRouteAmount, aurumMaximumRouteAmount, amount)
                : 0.0f;
        }

        float aurumFeedbackSample(float sample) noexcept
        {
            return std::isfinite(sample)
                ? juce::jlimit(-aurumMaximumFeedbackSample, aurumMaximumFeedbackSample, sample)
                : 0.0f;
        }

        float aurumWavefold(float sample, float amount) noexcept
        {
            const float depth = VoiceMath::clamp01(amount);
            if (depth <= 0.0001f)
                return sample;
            const float driven = juce::jlimit(-1.0f, 1.0f, sample) * (1.0f + depth * 3.0f);
            return std::asin(std::sin(driven * juce::MathConstants<float>::halfPi))
                / juce::MathConstants<float>::halfPi;
        }

        float aurumHeldEnvelope(float attackMs, float decayMs, float sustain, float timeMs) noexcept
        {
            const float attack = juce::jmax(0.0f, attackMs);
            if (attack > 0.0f && timeMs < attack)
                return timeMs / attack;
            const float decay = juce::jmax(0.0f, decayMs);
            const float decayTime = timeMs - attack;
            if (decay > 0.0f && decayTime < decay)
                return 1.0f + (VoiceMath::clamp01(sustain) - 1.0f) * (decayTime / decay);
            return VoiceMath::clamp01(sustain);
        }

        float aurumEnvelope(float attackMs,
                            float decayMs,
                            float sustain,
                            float releaseMs,
                            float timeMs,
                            float releaseTimeMs,
                            float releaseLevel,
                            bool releasing) noexcept
        {
            if (!releasing)
                return aurumHeldEnvelope(attackMs, decayMs, sustain, timeMs);
            const float release = juce::jmax(0.0f, releaseMs);
            return release > 0.0f
                ? releaseLevel * juce::jmax(0.0f, 1.0f - releaseTimeMs / release)
                : 0.0f;
        }

        float aurumResponseCurve(const std::array<float, 5>& curve, float input) noexcept
        {
            const float position = VoiceMath::clamp01(input) * 4.0f;
            const auto lower = (size_t) juce::jlimit(0, 4, (int) std::floor(position));
            const auto upper = juce::jmin((size_t) 4, lower + 1);
            const float mix = position - (float) lower;
            return juce::jmap(
                mix,
                VoiceMath::clamp01(curve[lower]),
                VoiceMath::clamp01(curve[upper]));
        }

        float aurumOperatorSample(
            const InstrumentVoice::Params::AurumOperator& op,
            double phase,
            double phaseDelta) noexcept
        {
            if (op.waveform != 4)
                return aurumWavefold(BasicOscillator::sample(op.waveform, phase, phaseDelta), op.wavefold);
            float sample = 0.0f;
            float weight = 0.0f;
            for (size_t index = 0; index < op.harmonics.size(); ++index)
            {
                const auto harmonic = (double) index + 1.0;
                if (harmonic * std::abs(phaseDelta) >= 0.5) break;
                const float amplitude = VoiceMath::clamp01(op.harmonics[index]);
                if (amplitude <= 0.0001f) continue;
                sample += std::sin(juce::MathConstants<double>::twoPi * phase * harmonic) * amplitude;
                weight += amplitude;
            }
            return aurumWavefold(weight > 0.0f ? sample / weight : 0.0f, op.wavefold);
        }

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
        aurumFilterBState.prepare(sr, blockSize, params.aurumFilters[1].type);
    }

    void InstrumentVoice::setParams(const Params& p)
    {
        baseParams = p;
        params = p;
        aurumOutputBusMask = 0;
        for (const auto& sends : params.aurumOutputSends)
        {
            if (std::abs(sends[0]) > 0.0001f) aurumOutputBusMask |= 1;
            if (std::abs(sends[1]) > 0.0001f) aurumOutputBusMask |= 2;
            if (std::abs(sends[2]) > 0.0001f) aurumOutputBusMask |= 4;
        }
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

        if (p.hasAurum)
        {
            filterState.configure(p.aurumFilters[0].type, p.aurumFilters[0].cutoff01, p.aurumFilters[0].resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
            aurumFilterBState.configure(p.aurumFilters[1].type, p.aurumFilters[1].cutoff01, p.aurumFilters[1].resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        }
        else
        {
            filterState.configure(p.filterType, p.cutoff01, p.resonance01, sampleRate, p.filterKeytrack, baseFrequencyHz);
        }
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
        aurumAgeSamples = 0;
        aurumReleaseAgeSamples = -1;
        aurumReleaseLevels.fill(0.0f);
        aurumPitchReleaseLevels.fill(0.0f);
        aurumPhaseReleaseLevels.fill(0.0f);
        aurumOutputs.fill(0.0f);
        for (size_t index = 0; index < aurumPhases.size(); ++index)
            aurumPhases[index] = std::fmod(
                juce::jlimit(0.0, 1.0, (double) params.aurumOperators[index % 6].phase)
                    + (double) (index / 6) * 0.071,
                1.0);
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
            if (params.hasAurum && aurumReleaseAgeSamples < 0)
            {
                const float timeMs = (float) ((double) aurumAgeSamples * 1000.0 / sampleRate);
                for (size_t index = 0; index < aurumReleaseLevels.size(); ++index)
                {
                    const auto& op = params.aurumOperators[index];
                    aurumReleaseLevels[index] = aurumHeldEnvelope(op.attackMs, op.decayMs, op.sustain, timeMs);
                    aurumPitchReleaseLevels[index] = aurumHeldEnvelope(op.pitchAttackMs, op.pitchDecayMs, op.pitchSustain, timeMs);
                    aurumPhaseReleaseLevels[index] = aurumHeldEnvelope(op.phaseAttackMs, op.phaseDecayMs, op.phaseSustain, timeMs);
                }
                aurumReleaseAgeSamples = 0;
            }
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
            aurumReleaseAgeSamples = -1;
            aurumReleaseLevels.fill(0.0f);
            aurumPitchReleaseLevels.fill(0.0f);
            aurumPhaseReleaseLevels.fill(0.0f);
            clearCurrentNote();
        }
    }

    void InstrumentVoice::renderNextBlock(juce::AudioBuffer<float>& out,
                                          int startSample, int numSamples)
    {
        juce::ScopedNoDenormals noDenormals;
        if (params.hasAurum)
        {
            if (aurumReleaseAgeSamples >= 0 && !aurumReleaseTailActive())
            {
                clearCurrentNote();
                return;
            }
        }
        else if (!adsr.isActive())
        {
            return;
        }

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
            StereoSample aurumFilterAInput;
            StereoSample aurumFilterBInput;
            StereoSample aurumDirectInput;
            if (params.hasAurum)
            {
                const float timeMs = (float) ((double) aurumAgeSamples * 1000.0 / sampleRate);
                const int voiceCount = juce::jlimit(1, 8, params.aurumUnison);
                const int oversampling = params.aurumOversampling >= 4 ? 4 : params.aurumOversampling >= 2 ? 2 : 1;
                float accumulatedALeft = 0.0f;
                float accumulatedARight = 0.0f;
                float accumulatedBLeft = 0.0f;
                float accumulatedBRight = 0.0f;
                float accumulatedDirectLeft = 0.0f;
                float accumulatedDirectRight = 0.0f;
                for (int substep = 0; substep < oversampling; ++substep)
                {
                    std::array<float, 48> nextOutputs {};
                    float aLeft = 0.0f;
                    float aRight = 0.0f;
                    float bLeft = 0.0f;
                    float bRight = 0.0f;
                    float directLeft = 0.0f;
                    float directRight = 0.0f;
                    for (int voice = 0; voice < voiceCount; ++voice)
                    {
                    const size_t voiceOffset = (size_t) voice * 6;
                    const float centered = voiceCount == 1 ? 0.0f : ((float) voice / (float) (voiceCount - 1)) * 2.0f - 1.0f;
                    const double voiceRate = std::exp2((double) centered * params.aurumDetuneCents / 1200.0);
                    for (size_t target = 0; target < 6; ++target)
                    {
                        const auto& op = params.aurumOperators[target];
                        if (!op.enabled) continue;
                        float fm = 0.0f;
                        for (size_t source = 0; source < 6; ++source)
                            fm += aurumFeedbackSample(aurumOutputs[voiceOffset + source])
                                * aurumRouteAmount(params.aurumMatrix[source][target]);
                        fm = juce::jlimit(-aurumMaximumFmSum, aurumMaximumFmSum, fm);

                        const bool releasing = aurumReleaseAgeSamples >= 0;
                        const float releaseTimeMs = releasing
                            ? (float) ((double) aurumReleaseAgeSamples * 1000.0 / sampleRate)
                            : 0.0f;
                        const float opEnvelope = aurumEnvelope(
                            op.attackMs, op.decayMs, op.sustain, op.releaseMs,
                            timeMs, releaseTimeMs, aurumReleaseLevels[target], releasing);
                        const float pitchEnvelope = aurumEnvelope(
                            op.pitchAttackMs, op.pitchDecayMs, op.pitchSustain, op.pitchReleaseMs,
                            timeMs, releaseTimeMs, aurumPitchReleaseLevels[target], releasing);
                        const float phaseEnvelope = aurumEnvelope(
                            op.phaseAttackMs, op.phaseDecayMs, op.phaseSustain, op.phaseReleaseMs,
                            timeMs, releaseTimeMs, aurumPhaseReleaseLevels[target], releasing);
                        const double ratio = juce::jlimit(0.125, 32.0, (double) op.ratio);
                        const double tuning = std::exp2((double) op.coarse / 12.0 + (double) op.fineCents / 1200.0);
                        const double pitchEnvelopeRate = std::exp2(
                            (double) pitchEnvelope * juce::jlimit(-48.0f, 48.0f, op.pitchEnvelopeSemitones) / 12.0);
                        const double delta = currentFrequency * voiceRate * ratio * tuning * pitchEnvelopeRate / (sampleRate * (double) oversampling);
                        float rmGain = 1.0f;
                        for (size_t source = 0; source < 6; ++source)
                        {
                            const float amount = aurumRouteAmount(params.aurumRmMatrix[source][target]);
                            if (std::abs(amount) <= 0.0001f) continue;
                            rmGain *= 1.0f - std::abs(amount)
                                + aurumFeedbackSample(aurumOutputs[voiceOffset + source]) * amount;
                            rmGain = juce::jlimit(-aurumMaximumRingGain, aurumMaximumRingGain, rmGain);
                        }
                        nextOutputs[voiceOffset + target] = aurumFeedbackSample(
                            aurumOperatorSample(
                                op,
                                aurumPhases[voiceOffset + target]
                                    + phaseEnvelope * juce::jlimit(-180.0f, 180.0f, op.phaseEnvelopeDegrees) / 360.0f
                                    + fm * aurumFmPhaseScale,
                                delta)
                                * VoiceMath::clamp01(op.level)
                                * opEnvelope
                                * aurumResponseCurve(op.velocityCurve, level)
                                * aurumResponseCurve(op.keytrackCurve, noteKeytrack)
                                * rmGain);
                        aurumPhases[voiceOffset + target] = std::fmod(aurumPhases[voiceOffset + target] + delta, 1.0);
                        currentBlockWork.addOscillatorSamples(1);
                    }

                        float voiceALeft = 0.0f;
                        float voiceARight = 0.0f;
                        float voiceBLeft = 0.0f;
                        float voiceBRight = 0.0f;
                        float voiceDirectLeft = 0.0f;
                        float voiceDirectRight = 0.0f;
                        float weightA = 0.0f;
                        float weightB = 0.0f;
                        float weightDirect = 0.0f;
                        for (size_t source = 0; source < 6; ++source)
                        {
                            const float output = nextOutputs[voiceOffset + source];
                            const float amountA = aurumRouteAmount(params.aurumOutputSends[source][0]);
                            const float amountB = aurumRouteAmount(params.aurumOutputSends[source][1]);
                            const float amountDirect = aurumRouteAmount(params.aurumOutputSends[source][2]);
                            const float pan = juce::jlimit(-1.0f, 1.0f, params.aurumOperators[source].pan + centered * params.aurumStereoSpread);
                            const float angle = (pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f;
                            const float leftGain = std::cos(angle);
                            const float rightGain = std::sin(angle);
                            voiceALeft += output * amountA * leftGain;
                            voiceARight += output * amountA * rightGain;
                            voiceBLeft += output * amountB * leftGain;
                            voiceBRight += output * amountB * rightGain;
                            voiceDirectLeft += output * amountDirect * leftGain;
                            voiceDirectRight += output * amountDirect * rightGain;
                            weightA += std::abs(amountA);
                            weightB += std::abs(amountB);
                            weightDirect += std::abs(amountDirect);
                        }
                        const float normalizationA = juce::jmax(1.0f, std::sqrt(weightA));
                        const float normalizationB = juce::jmax(1.0f, std::sqrt(weightB));
                        const float normalizationDirect = juce::jmax(1.0f, std::sqrt(weightDirect));
                        aLeft += voiceALeft / normalizationA;
                        aRight += voiceARight / normalizationA;
                        bLeft += voiceBLeft / normalizationB;
                        bRight += voiceBRight / normalizationB;
                        directLeft += voiceDirectLeft / normalizationDirect;
                        directRight += voiceDirectRight / normalizationDirect;
                    }
                    aurumOutputs = nextOutputs;
                    accumulatedALeft += aLeft;
                    accumulatedARight += aRight;
                    accumulatedBLeft += bLeft;
                    accumulatedBRight += bRight;
                    accumulatedDirectLeft += directLeft;
                    accumulatedDirectRight += directRight;
                }
                ++aurumAgeSamples;
                if (aurumReleaseAgeSamples >= 0)
                    ++aurumReleaseAgeSamples;
                const float normalization = 1.0f / (std::sqrt((float) voiceCount) * (float) oversampling);
                aurumFilterAInput = { accumulatedALeft * normalization, accumulatedARight * normalization };
                aurumFilterBInput = { accumulatedBLeft * normalization, accumulatedBRight * normalization };
                aurumDirectInput = { accumulatedDirectLeft * normalization, accumulatedDirectRight * normalization };
                raw = aurumFilterAInput;
            }
            else if (params.hasAether)
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

            const float filterDriveMod = useDynamicModulation && cachedDynamicTargets.filterDrive
                ? DynamicModulation::targetOffset(params.dynamicModulation.filterDrive, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f;
            const float filterCutoffMod = hasFilterMod
                ? (useDynamicModulation && cachedDynamicTargets.filterCutoff
                    ? DynamicModulation::targetOffset(params.dynamicModulation.filterCutoff, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 0.35f)
                    : filterLfo * params.lfoToFilter * 0.35f + env * params.envToFilter * 0.35f)
                : 0.0f;
            const float filterResonanceMod = useDynamicModulation && cachedDynamicTargets.filterResonance
                ? DynamicModulation::targetOffset(params.dynamicModulation.filterResonance, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f;

            const auto processFilter = [&] (
                float inputLeft,
                float inputRight,
                float cutoff,
                float resonance,
                float drive,
                FilterStage::State& filter,
                DriveStage::State& driveStage)
            {
                const float drivenAmount = VoiceMath::clamp01(drive + filterDriveMod);
                if (drivenAmount > 0.0001f)
                {
                    const auto driven = DriveStage::processOversampled(driveStage, { inputLeft, inputRight }, 1.0f + drivenAmount * 6.0f);
                    inputLeft = driven.left;
                    inputRight = driven.right;
                    currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
                }
                else
                {
                    driveStage.reset({ inputLeft, inputRight });
                }
                if (hasFilterMod)
                {
                    currentBlockWork.addFilterCutoffUpdates(filter.updateCutoffIfChanged(
                        cutoff + filterCutoffMod,
                        sampleRate,
                        params.filterKeytrack,
                        baseFrequencyHz,
                        6.0f));
                    if (useDynamicModulation && cachedDynamicTargets.filterResonance)
                        currentBlockWork.addFilterResonanceUpdates(filter.updateResonanceIfChanged(
                            VoiceMath::clamp01(resonance + filterResonanceMod),
                            0.001f));
                }
                return filter.process(inputLeft, inputRight);
            };

            if (params.hasAurum)
            {
                const auto& filterA = params.aurumFilters[0];
                const auto& filterB = params.aurumFilters[1];
                const bool filterAActive = (aurumOutputBusMask & 1) != 0;
                const bool filterBActive = (aurumOutputBusMask & 2) != 0;
                const bool directActive = (aurumOutputBusMask & 4) != 0;
                if (params.aurumFilterRouting == 1)
                {
                    float mixedLeft = 0.0f;
                    float mixedRight = 0.0f;
                    int branchCount = 0;
                    if (filterAActive)
                    {
                        const auto branch = filterA.enabled
                            ? processFilter(aurumFilterAInput.left, aurumFilterAInput.right, filterA.cutoff01, filterA.resonance01, filterA.drive01, filterState, driveState)
                            : FilterStage::StereoFrame { aurumFilterAInput.left, aurumFilterAInput.right };
                        mixedLeft += branch.left;
                        mixedRight += branch.right;
                        ++branchCount;
                    }
                    if (filterBActive)
                    {
                        const auto branch = filterB.enabled
                            ? processFilter(aurumFilterBInput.left, aurumFilterBInput.right, filterB.cutoff01, filterB.resonance01, filterB.drive01, aurumFilterBState, aurumFilterBDriveState)
                            : FilterStage::StereoFrame { aurumFilterBInput.left, aurumFilterBInput.right };
                        mixedLeft += branch.left;
                        mixedRight += branch.right;
                        ++branchCount;
                    }
                    if (directActive)
                    {
                        mixedLeft += aurumDirectInput.left;
                        mixedRight += aurumDirectInput.right;
                        ++branchCount;
                    }
                    left = branchCount > 0 ? mixedLeft / (float) branchCount : 0.0f;
                    right = branchCount > 0 ? mixedRight / (float) branchCount : 0.0f;
                }
                else
                {
                    auto filterAOutput = FilterStage::StereoFrame { aurumFilterAInput.left, aurumFilterAInput.right };
                    if (filterAActive && filterA.enabled)
                        filterAOutput = processFilter(filterAOutput.left, filterAOutput.right, filterA.cutoff01, filterA.resonance01, filterA.drive01, filterState, driveState);
                    const int filterBInputCount = (int) filterAActive + (int) filterBActive;
                    auto filterBOutput = FilterStage::StereoFrame {
                        filterBInputCount > 0 ? (filterAOutput.left + aurumFilterBInput.left) / (float) filterBInputCount : 0.0f,
                        filterBInputCount > 0 ? (filterAOutput.right + aurumFilterBInput.right) / (float) filterBInputCount : 0.0f,
                    };
                    if (filterBInputCount > 0 && filterB.enabled)
                        filterBOutput = processFilter(filterBOutput.left, filterBOutput.right, filterB.cutoff01, filterB.resonance01, filterB.drive01, aurumFilterBState, aurumFilterBDriveState);
                    const int outputCount = (int) (filterAActive || filterBActive) + (int) directActive;
                    left = outputCount > 0 ? (filterBOutput.left + aurumDirectInput.left) / (float) outputCount : 0.0f;
                    right = outputCount > 0 ? (filterBOutput.right + aurumDirectInput.right) / (float) outputCount : 0.0f;
                }
            }
            else
            {
                const auto filtered = processFilter(left, right, params.cutoff01, params.resonance01, params.drive01, filterState, driveState);
                left = filtered.left;
                right = filtered.right;
            }

            const float ampLevel = VoiceMath::clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? DynamicModulation::targetOffset(params.dynamicModulation.ampLevel, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + DynamicModulation::targetOffset(params.dynamicModulation.ampPan, rawLfo, rawLfo2, env, env2, level, noteKeytrack, modWheel, params.macroValues, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? VoiceMath::equalPowerPanGains(ampPan) : cachedPanGains.amp;
            const float voiceGain = (params.hasAurum ? 1.0f : env) * level * 0.4f * ampLevel;
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

        if (params.hasAurum)
        {
            if (aurumReleaseAgeSamples >= 0 && !aurumReleaseTailActive())
                clearCurrentNote();
        }
        else if (!adsr.isActive())
        {
            clearCurrentNote();
        }

        VoiceRenderStats::recordBlock(currentBlockWork.snapshot());
    }

    bool InstrumentVoice::aurumReleaseTailActive() const noexcept
    {
        if (!params.hasAurum || aurumReleaseAgeSamples < 0 || sampleRate <= 0.0)
            return false;
        float longestReleaseMs = 0.0f;
        for (const auto& op : params.aurumOperators)
            if (op.enabled)
                longestReleaseMs = juce::jmax(longestReleaseMs, juce::jmax(0.0f, op.releaseMs));
        const auto releaseSamples = (int64_t) std::ceil((double) longestReleaseMs * sampleRate / 1000.0);
        return aurumReleaseAgeSamples < releaseSamples;
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
