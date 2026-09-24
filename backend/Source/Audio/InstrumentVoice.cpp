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

        float normalizedTriangleFold(float input) noexcept
        {
            const float wrapped = input - 4.0f * std::floor((input + 2.0f) * 0.25f);
            if (wrapped > 1.0f)
                return 2.0f - wrapped;
            if (wrapped < -1.0f)
                return -2.0f - wrapped;
            return wrapped;
        }

        float aurumWavefold(float sample, float amount) noexcept
        {
            const float depth = VoiceMath::clamp01(amount);
            if (depth <= 0.0001f)
                return sample;
            const float driven = juce::jlimit(-1.0f, 1.0f, sample) * (1.0f + depth * 3.0f);
            return normalizedTriangleFold(driven);
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

        struct RuntimeWarpConfig
        {
            float drive { 0.0f };
            float gain { 1.0f };
            float mix { 0.0f };
            float exponent { 1.0f };
            float mirrorScale { juce::MathConstants<float>::pi };
            float tanhGain { 1.0f };
            int mode { 0 };
            bool active { false };
        };

        RuntimeWarpConfig makeRuntimeWarpConfig(float amount, int mode) noexcept
        {
            RuntimeWarpConfig config;
            config.drive = VoiceMath::clamp01(amount);
            config.mode = mode;
            config.active = config.drive > 0.0001f;
            if (!config.active)
                return config;

            if (mode == 1)
            {
                config.gain = 1.0f + config.drive * 5.5f;
                config.mix = 0.35f + config.drive * 0.65f;
            }
            else if (mode == 2)
            {
                config.exponent = 1.0f + config.drive * 3.2f;
                config.mix = 0.4f + config.drive * 0.6f;
            }
            else if (mode == 3)
            {
                config.mirrorScale = juce::MathConstants<float>::pi * (1.0f + config.drive * 2.2f);
                config.mix = 0.32f + config.drive * 0.68f;
            }
            else
            {
                config.gain = 1.0f + config.drive * 8.0f;
                config.tanhGain = std::tanh(config.gain);
            }
            return config;
        }

        float runtimeWarpShape(float input, const RuntimeWarpConfig& config) noexcept
        {
            if (!config.active)
                return input;

            const float x = juce::jlimit(-1.0f, 1.0f, input);
            if (config.mode == 1)
            {
                const float folded = normalizedTriangleFold(x * config.gain);
                return juce::jlimit(-1.0f, 1.0f, x + (folded - x) * config.mix);
            }
            if (config.mode == 2)
            {
                const float shaped = (x < 0.0f ? -1.0f : 1.0f) * std::pow(std::abs(x), config.exponent);
                return juce::jlimit(-1.0f, 1.0f, x + (shaped - x) * config.mix);
            }
            if (config.mode == 3)
            {
                const float mirrored = std::sin(x * config.mirrorScale)
                    * (1.0f - std::abs(x) * config.drive * 0.35f);
                return juce::jlimit(-1.0f, 1.0f, x + (mirrored - x) * config.mix);
            }

            return juce::jlimit(-1.0f, 1.0f, std::tanh(x * config.gain) / config.tanhGain);
        }

        float runtimeWarpMonoOversampled(DriveStage::State& state, float sample, const RuntimeWarpConfig& config) noexcept
        {
            constexpr float downsampleAlpha = 0.72f;
            const float midpoint = 0.5f * (state.previousInput.left + sample);
            const float downsampled = 0.5f * (
                runtimeWarpShape(midpoint, config)
                + runtimeWarpShape(sample, config));

            state.downsample.left = DriveStage::denormalSafe(state.downsample.left
                + downsampleAlpha * (downsampled - state.downsample.left));
            state.previousInput.left = sample;
            return state.downsample.left;
        }

        DriveStage::StereoFrame processRuntimeWarpOversampled(
            DriveStage::State& state,
            DriveStage::StereoFrame sample,
            const RuntimeWarpConfig& config) noexcept
        {
            if (sample.left == 0.0f && sample.right == 0.0f
                && state.previousInput.left == 0.0f && state.previousInput.right == 0.0f
                && state.downsample.left == 0.0f && state.downsample.right == 0.0f)
                return {};

            DriveStage::State rightState;
            rightState.previousInput.left = state.previousInput.right;
            rightState.downsample.left = state.downsample.right;

            const DriveStage::StereoFrame processed {
                runtimeWarpMonoOversampled(state, sample.left, config),
                runtimeWarpMonoOversampled(rightState, sample.right, config),
            };

            state.previousInput.right = rightState.previousInput.left;
            state.downsample.right = rightState.downsample.left;
            return processed;
        }

        bool runtimeWarpNeedsWork(
            const DriveStage::State& state,
            DriveStage::StereoFrame sample) noexcept
        {
            return sample.left != 0.0f || sample.right != 0.0f
                || state.previousInput.left != 0.0f || state.previousInput.right != 0.0f
                || state.downsample.left != 0.0f || state.downsample.right != 0.0f;
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

    void InstrumentVoice::refreshPreparedRenderTopology() noexcept
    {
        PreparedRenderTopology next;
        next.kernel = params.hasAurum ? RenderKernel::Aurum
            : params.hasLumen ? RenderKernel::Lumen
            : params.hasAether ? RenderKernel::Aether
            : RenderKernel::Legacy;
        next.routeLaneMask = next.kernel == RenderKernel::Aether || next.kernel == RenderKernel::Lumen
            ? 0u : 1u;

        const auto includeRoute = [&next](bool active, int route)
        {
            if (active && route >= 0 && route < 4)
                next.routeLaneMask = (uint8_t) (next.routeLaneMask | (uint8_t) (1u << route));
        };

        if (next.kernel == RenderKernel::Aether || next.kernel == RenderKernel::Lumen)
        {
            includeRoute(params.aetherOscA.enabled, params.aetherOscA.routing);
            includeRoute(params.aetherOscB.enabled, params.aetherOscB.routing);
            includeRoute(params.aetherSub.enabled, params.aetherSub.routing);
            includeRoute(params.aetherNoise.enabled, params.aetherNoise.routing);

            next.aetherSample = params.aetherSampleSlot1.enabled
                && (params.aetherSampleSlot1.source || params.aetherSampleSlot1.sfzSource);
            next.aetherSampleUsesSfz = next.aetherSample && params.aetherSampleSlot1.sfzSource != nullptr;
            includeRoute(next.aetherSample, params.aetherSampleSlot1.routing);

            next.aetherGranular = params.aetherGranularSlot2.enabled
                && params.aetherGranularSlot2.source != nullptr;
            includeRoute(next.aetherGranular, params.aetherGranularSlot2.routing);
            next.sourceSends = params.hasAetherSourceSends;
        }

        if (next.kernel == RenderKernel::Lumen)
        {
            next.lumenOscC = params.lumenOscC.enabled;
            includeRoute(next.lumenOscC, params.lumenOscC.routing);
            for (size_t index = 0; index < params.lumenSampleSlots.size(); ++index)
            {
                const auto& slot = params.lumenSampleSlots[index];
                if (slot.enabled && (slot.source || slot.sfzSource))
                {
                    next.lumenSampleIndices[(size_t) next.lumenSampleCount++] = (uint8_t) index;
                    includeRoute(true, slot.routing);
                }
                const auto& granular = params.lumenGranularSlots[index];
                if (granular.enabled && granular.source)
                {
                    next.lumenGranularIndices[(size_t) next.lumenGranularCount++] = (uint8_t) index;
                    includeRoute(true, granular.routing);
                }
            }
        }

        preparedTopology = next;
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
        for (auto& osc : lumenOscillatorsC)
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
        aurumFilterBState.prepare(sr, blockSize, params.aurumFilters[1].type);
        stealTransition.prepare(sampleRate);
        for (auto& transition : sourceSendTransitions)
            transition.prepare(sampleRate);
        aetherSampleSlot1.prepare({ sampleRate, blockSize, 2 });
        aetherSfzSlot1.prepare({ sampleRate, blockSize, 2 });
        for (auto& slot : lumenSampleSlots) slot.prepare({ sampleRate, blockSize, 2 });
        for (auto& slot : lumenSfzSlots) slot.prepare({ sampleRate, blockSize, 2 });
        aetherGranularSlot2.prepare({ sampleRate, blockSize, 2 });
        for (auto& slot : lumenGranularSlots) slot.prepare({ sampleRate, blockSize, 2 });
    }

    void InstrumentVoice::setProcessingQuality(AudioQuality quality) noexcept
    {
        processingQuality = quality;
        for (auto& oscillator : wavetableOscillators) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsA) oscillator.setQuality(quality);
        for (auto& oscillator : aetherOscillatorsB) oscillator.setQuality(quality);
        for (auto& oscillator : lumenOscillatorsC) oscillator.setQuality(quality);
        aetherInteractionState.prepare(sampleRate, quality);
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
        if (params.hasAurum)
        {
            params.hasAether = false;
            params.hasLumen = false;
            const auto& filterA = params.aurumFilters[0];
            const auto& filterB = params.aurumFilters[1];
            params.filterType = filterA.type;
            params.cutoff01 = filterA.cutoff01;
            params.resonance01 = filterA.resonance01;
            params.drive01 = filterA.drive01;
            params.filter2Enabled = filterB.enabled;
            params.filter2Type = filterB.type;
            params.filter2Cutoff01 = filterB.cutoff01;
            params.filter2Resonance01 = filterB.resonance01;
            params.filter2Drive01 = filterB.drive01;
            params.filterRouting = params.aurumFilterRouting;
        }
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
        if (params.hasLumen && aetherOscillatorNeedsWavetable(params.lumenOscC))
        {
            auto nextTable = WavetableVoiceCache::sharedTableForConfig(params.lumenOscC.wavetable);
            if (nextTable.get() != lumenTableC.get())
            {
                retiredLumenTableC = std::move(lumenTableC);
                lumenTableC = std::move(nextTable);
            }
            WavetableOscillatorBank::configure(lumenOscillatorsC, lumenTableC.get(),
                params.lumenOscC.wavetable, sampleRate, baseFrequencyHz);
        }
        else
        {
            retiredLumenTableC = std::move(lumenTableC);
            WavetableOscillatorBank::clear(lumenOscillatorsC, lumenUnisonPlanC);
        }
        aetherInteractionState.configure(aetherTableA.get(), params.aetherOscA,
                                         aetherTableB.get(), params.aetherOscB,
                                         baseFrequencyHz);
        aetherSampleSlot1.allNotesOff(true);
        aetherSampleSlot1.configurePlayback(false, 1.0f, false, 4.0f);
        aetherSampleSlot1.publish(params.aetherSampleSlot1.enabled ? params.aetherSampleSlot1.source : nullptr);
        aetherSfzSlot1.allNotesOff(true);
        aetherSfzSlot1.configurePlayback(false, 1.0f, false, 4.0f, 0.0f, 1.0f);
        aetherSfzSlot1.publish(params.aetherSampleSlot1.enabled ? params.aetherSampleSlot1.sfzSource : nullptr);
        for (size_t index = 0; index < lumenSampleSlots.size(); ++index)
        {
            const auto& slotParams = params.lumenSampleSlots[index];
            lumenSampleSlots[index].allNotesOff(true);
            lumenSampleSlots[index].configurePlayback(slotParams.reverse, slotParams.playbackRate,
                slotParams.pingPongLoop, slotParams.releaseTailMs);
            lumenSampleSlots[index].publish(slotParams.enabled ? slotParams.source : nullptr);
            lumenSfzSlots[index].allNotesOff(true);
            lumenSfzSlots[index].configurePlayback(slotParams.reverse, slotParams.playbackRate,
                slotParams.pingPongLoop, slotParams.releaseTailMs,
                slotParams.sfzTrimStartRatio, slotParams.sfzTrimEndRatio);
            lumenSfzSlots[index].publish(slotParams.enabled ? slotParams.sfzSource : nullptr);
        }
        aetherGranularSlot2.allNotesOff(true);
        aetherGranularSlot2.publish(params.aetherGranularSlot2.enabled ? params.aetherGranularSlot2.source : nullptr);
        for (size_t index = 0; index < lumenGranularSlots.size(); ++index)
        {
            lumenGranularSlots[index].allNotesOff(true);
            lumenGranularSlots[index].publish(params.lumenGranularSlots[index].enabled
                ? params.lumenGranularSlots[index].source : nullptr);
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
        env3AdsrParams = { juce::jmax(0.001f, p.env3AttackMs * 0.001f), juce::jmax(0.001f, p.env3DecayMs * 0.001f), juce::jlimit(0.0f, 1.0f, p.env3Sustain), juce::jmax(0.001f, p.env3ReleaseMs * 0.001f) };
        env4AdsrParams = { juce::jmax(0.001f, p.env4AttackMs * 0.001f), juce::jmax(0.001f, p.env4DecayMs * 0.001f), juce::jlimit(0.0f, 1.0f, p.env4Sustain), juce::jmax(0.001f, p.env4ReleaseMs * 0.001f) };
        env3Adsr.setParameters(env3AdsrParams);
        env4Adsr.setParameters(env4AdsrParams);

        filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        filter2State.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        filter1RouteState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        filter2RouteState.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        aurumFilterBState.configure(params.aurumFilters[1].type, params.aurumFilters[1].cutoff01,
            params.aurumFilters[1].resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedPitchRates();
        refreshCachedDynamicModulationFlags();
        refreshPreparedRenderTopology();
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
            case RealtimeParam::OscAFine:
            case RealtimeParam::OscBFine:
                refreshCachedPitchRates();
                break;
            case RealtimeParam::FilterDrive:
            case RealtimeParam::AmpLevel:
            case RealtimeParam::OscAPosition:
            case RealtimeParam::OscBPosition:
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
        aurumNoteActive = params.hasAurum;
        realtimeRampState.resetFromParams(params);
        baseFrequencyHz = juce::MidiMessage::getMidiNoteInHertz(midiNoteNumber);
        level = velocity;
        noteKeytrack = juce::jlimit(0.0f, 1.0f, (float) midiNoteNumber / 127.0f);
        masterPitchWheelSemitones = 0.0f;
        pitchWheelMoved(currentPitchWheel == 0 ? 8192 : currentPitchWheel);
        aetherSampleSlot1.allNotesOff(true);
        aetherSfzSlot1.allNotesOff(true);
        for (auto& slot : lumenSampleSlots) slot.allNotesOff(true);
        for (auto& slot : lumenSfzSlots) slot.allNotesOff(true);
        aetherGranularSlot2.allNotesOff(true);
        for (auto& slot : lumenGranularSlots) slot.allNotesOff(true);
        if (params.hasAether && params.aetherSampleSlot1.enabled)
        {
            if (params.aetherSampleSlot1.sfzSource)
                aetherSfzSlot1.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
            else if (params.aetherSampleSlot1.source)
                aetherSampleSlot1.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
        }
        if (params.hasLumen)
        {
            for (size_t index = 0; index < lumenSampleSlots.size(); ++index)
            {
                const auto& slot = params.lumenSampleSlots[index];
                if (!slot.enabled) continue;
                if (slot.sfzSource) lumenSfzSlots[index].noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
                else if (slot.source) lumenSampleSlots[index].noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
            }
        }
        if (params.hasAether && params.aetherGranularSlot2.enabled && params.aetherGranularSlot2.source)
            aetherGranularSlot2.noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });
        if (params.hasLumen)
            for (size_t index = 0; index < lumenGranularSlots.size(); ++index)
                if (params.lumenGranularSlots[index].enabled && params.lumenGranularSlots[index].source)
                    lumenGranularSlots[index].noteOn({ midiNoteNumber, velocity, (uint64_t) stableVoiceId });

        if (legatoRetune)
        {
            const int glideSamples = params.glideMs > 0.0f && sampleRate > 0.0
                ? juce::jmax(1, (int) std::round((params.glideMs / 1000.0f) * (float) sampleRate))
                : 0;
            filterState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter2State.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter1RouteState.configure(params.filterType, params.cutoff01, params.resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            filter2RouteState.configure(params.filter2Type, params.filter2Cutoff01, params.filter2Resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
            aurumFilterBState.configure(params.aurumFilters[1].type, params.aurumFilters[1].cutoff01,
                params.aurumFilters[1].resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
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
        aurumFilterBState.configure(params.aurumFilters[1].type, params.aurumFilters[1].cutoff01,
            params.aurumFilters[1].resonance01, sampleRate, params.filterKeytrack, baseFrequencyHz);
        refreshCachedPanGains();
        refreshCachedDynamicModulationFlags();

        WavetableUnison::PhaseArray rememberedAetherPhasesA {};
        WavetableUnison::PhaseArray rememberedAetherPhasesB {};
        WavetableUnison::PhaseArray rememberedLumenPhasesC {};
        for (size_t index = 0; index < rememberedAetherPhasesA.size(); ++index)
        {
            rememberedAetherPhasesA[index] = aetherOscillatorsA[index].getPhase();
            rememberedAetherPhasesB[index] = aetherOscillatorsB[index].getPhase();
            rememberedLumenPhasesC[index] = lumenOscillatorsC[index].getPhase();
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
        if (params.hasLumen && params.lumenOscC.phaseMode == 0)
        {
            lumenOscCPhaseOffset = juce::jlimit(0.0, 1.0, (double) params.lumenOscC.phase)
                + VoiceMath::deterministicPhaseJitter(noiseState ^ 0xd4e12b87u)
                    * juce::jlimit(0.0, 1.0, (double) params.lumenOscC.randomPhase);
        }
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
        if (params.hasLumen && aetherOscillatorNeedsWavetable(params.lumenOscC))
        {
            WavetableOscillatorBank::configure(lumenOscillatorsC, lumenTableC.get(),
                params.lumenOscC.wavetable, sampleRate, baseFrequencyHz);
            for (size_t index = 0; index < lumenOscillatorsC.size(); ++index)
                lumenOscillatorsC[index].setPhase(params.lumenOscC.phaseMode == 1
                    ? rememberedLumenPhasesC[index]
                    : lumenOscCPhaseOffset);
        }
        else
            WavetableOscillatorBank::clear(lumenOscillatorsC, lumenUnisonPlanC);
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
            for (auto& slot : lumenSampleSlots) slot.noteOff((uint64_t) stableVoiceId);
            for (auto& slot : lumenSfzSlots) slot.noteOff((uint64_t) stableVoiceId);
            aetherGranularSlot2.noteOff((uint64_t) stableVoiceId);
            for (auto& slot : lumenGranularSlots) slot.noteOff((uint64_t) stableVoiceId);
        }
        else
        {
            aetherSampleSlot1.allNotesOff(true);
            aetherSfzSlot1.allNotesOff(true);
            for (auto& slot : lumenSampleSlots) slot.allNotesOff(true);
            for (auto& slot : lumenSfzSlots) slot.allNotesOff(true);
            aetherGranularSlot2.allNotesOff(true);
            for (auto& slot : lumenGranularSlots) slot.allNotesOff(true);
        }
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
            aurumReleaseAgeSamples = -1;
            aurumNoteActive = false;
            aurumReleaseLevels.fill(0.0f);
            aurumPitchReleaseLevels.fill(0.0f);
            aurumPhaseReleaseLevels.fill(0.0f);
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
        if (preparedTopology.kernel == RenderKernel::Aurum)
        {
            // juce::Synthesiser calls renderNextBlock for every allocated
            // voice. Aurum owns its envelope rather than using the JUCE ADSR
            // active flag, so track note ownership explicitly and reject an
            // unassigned voice before doing any DSP work.
            if (!aurumNoteActive)
                return;
            if (aurumReleaseAgeSamples >= 0 && !aurumReleaseTailActive())
            {
                aurumNoteActive = false;
                clearCurrentNote();
                return;
            }
        }
        else if (!adsr.isActive())
        {
            return;
        }

        switch (preparedTopology.kernel)
        {
            case RenderKernel::Aurum:
                renderPreparedBlock<RenderKernel::Aurum>(out, startSample, numSamples);
                break;
            case RenderKernel::Lumen:
                renderPreparedBlock<RenderKernel::Lumen>(out, startSample, numSamples);
                break;
            case RenderKernel::Aether:
                renderPreparedBlock<RenderKernel::Aether>(out, startSample, numSamples);
                break;
            case RenderKernel::Legacy:
                renderPreparedBlock<RenderKernel::Legacy>(out, startSample, numSamples);
                break;
        }
    }

    template <InstrumentVoice::RenderKernel kernel>
    void InstrumentVoice::renderPreparedBlock(juce::AudioBuffer<float>& out,
                                               int startSample,
                                               int numSamples)
    {
        constexpr bool rendersAurum = kernel == RenderKernel::Aurum;
        constexpr bool rendersAether = kernel == RenderKernel::Aether || kernel == RenderKernel::Lumen;
        constexpr bool rendersLumen = kernel == RenderKernel::Lumen;

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
        const float lfoRateHz = rendersLumen
            ? Lfo::keytrackedRateHz(params.lfoRateHz, params.lfoKeytrackRate, noteKeytrack)
            : juce::jmax(0.01f, params.lfoRateHz);
        const float lfo2RateHz = rendersLumen
            ? Lfo::keytrackedRateHz(params.lfo2RateHz, params.lfo2KeytrackRate, noteKeytrack)
            : juce::jmax(0.01f, params.lfo2RateHz);
        const double lfoPhaseDelta = lfoRateHz / sampleRate;
        const double lfo2PhaseDelta = lfo2RateHz / sampleRate;
        std::array<double, 8> extraLfoPhaseDeltas {};
        std::array<bool, 8> needsExtraLfoValues {};
        int activeExtraLfoCount = 0;
        for (size_t index = 0; index < params.extraLfos.size(); ++index)
        {
            needsExtraLfoValues[index] = modulationPlan.needsExtraLfoValue[index] && params.extraLfos[index].enabled;
            activeExtraLfoCount += needsExtraLfoValues[index] ? 1 : 0;
            const float rateHz = rendersLumen
                ? Lfo::keytrackedRateHz(params.extraLfos[index].rateHz,
                    params.extraLfos[index].keytrackRate, noteKeytrack)
                : juce::jmax(0.01f, params.extraLfos[index].rateHz);
            extraLfoPhaseDeltas[index] = rateHz / sampleRate;
        }
        const bool hasVoiceAutomation = noteAutomationState.active();
        currentBlockWork.begin(numSamples, 2);

        const double pitchWheelRate = std::exp2(
            (double) (pitchWheelSemitones + masterPitchWheelSemitones) / 12.0);
        const auto runtimeWarpConfig = makeRuntimeWarpConfig(
            params.aetherRuntimeWarp, params.aetherRuntimeWarpMode);
        const auto runtimeWarp2Config = makeRuntimeWarpConfig(
            params.aetherRuntimeWarp2, params.aetherRuntimeWarp2Mode);
        const int aurumVoiceCount = juce::jlimit(1, 8, params.aurumUnison);
        const int aurumOversampling = params.aurumOversampling >= 4 ? 4 : params.aurumOversampling >= 2 ? 2 : 1;
        const float aurumNormalization = 1.0f
            / (std::sqrt((float) aurumVoiceCount) * (float) aurumOversampling);
        std::array<int, 6> aurumEnabledOperators {};
        int aurumEnabledOperatorCount = 0;
        std::array<double, 8> aurumVoiceRates {};
        std::array<double, 6> aurumTuningRates {};
        std::array<double, 6> aurumRatios {};
        std::array<float, 6> aurumPitchEnvelopeDepths {};
        std::array<float, 6> aurumPhaseEnvelopeTurns {};
        std::array<float, 6> aurumOperatorLevels {};
        std::array<float, 6> aurumResponseGains {};
        std::array<std::array<float, 2>, 48> aurumPanGains {};
        std::array<std::array<float, 6>, 6> aurumFmAmounts {};
        std::array<std::array<float, 6>, 6> aurumRmAmounts {};
        std::array<std::array<int, 6>, 6> aurumFmSources {};
        std::array<std::array<int, 6>, 6> aurumRmSources {};
        std::array<int, 6> aurumFmSourceCounts {};
        std::array<int, 6> aurumRmSourceCounts {};
        std::array<std::array<float, 3>, 6> aurumOutputAmounts {};
        std::array<std::array<float, 2>, 4> aetherSourceSendGains {};
        std::array<float, 2> aetherSampleSendGains {};
        std::array<std::array<float, 2>, 3> lumenSampleSendGains {};
        std::array<float, 2> aetherGranularSendGains {};
        std::array<std::array<float, 2>, 3> lumenGranularSendGains {};
        std::array<float, 2> lumenOscCSendGains {};
        if constexpr (rendersAurum)
        {
            for (size_t opIndex = 0; opIndex < params.aurumOperators.size(); ++opIndex)
            {
                const auto& op = params.aurumOperators[opIndex];
                if (op.enabled)
                    aurumEnabledOperators[(size_t) aurumEnabledOperatorCount++] = (int) opIndex;
                aurumTuningRates[opIndex] = std::exp2((double) op.coarse / 12.0 + (double) op.fineCents / 1200.0);
                aurumRatios[opIndex] = juce::jlimit(0.125, 32.0, (double) op.ratio);
                aurumPitchEnvelopeDepths[opIndex] = juce::jlimit(-48.0f, 48.0f, op.pitchEnvelopeSemitones);
                aurumPhaseEnvelopeTurns[opIndex] = juce::jlimit(-180.0f, 180.0f, op.phaseEnvelopeDegrees) / 360.0f;
                aurumOperatorLevels[opIndex] = VoiceMath::clamp01(op.level);
                aurumResponseGains[opIndex] = aurumResponseCurve(op.velocityCurve, level)
                    * aurumResponseCurve(op.keytrackCurve, noteKeytrack);
                for (size_t source = 0; source < 6; ++source)
                {
                    aurumFmAmounts[source][opIndex] = aurumRouteAmount(params.aurumMatrix[source][opIndex]);
                    aurumRmAmounts[source][opIndex] = aurumRouteAmount(params.aurumRmMatrix[source][opIndex]);
                    if (std::abs(aurumFmAmounts[source][opIndex]) > 0.0001f)
                        aurumFmSources[opIndex][(size_t) aurumFmSourceCounts[opIndex]++] = (int) source;
                    if (std::abs(aurumRmAmounts[source][opIndex]) > 0.0001f)
                        aurumRmSources[opIndex][(size_t) aurumRmSourceCounts[opIndex]++] = (int) source;
                }
                for (size_t bus = 0; bus < 3; ++bus)
                    aurumOutputAmounts[opIndex][bus] = aurumRouteAmount(params.aurumOutputSends[opIndex][bus]);
            }
            for (int voice = 0; voice < aurumVoiceCount; ++voice)
            {
                const float centered = aurumVoiceCount == 1 ? 0.0f
                    : ((float) voice / (float) (aurumVoiceCount - 1)) * 2.0f - 1.0f;
                aurumVoiceRates[(size_t) voice] = std::exp2((double) centered * params.aurumDetuneCents / 1200.0);
                for (size_t opIndex = 0; opIndex < 6; ++opIndex)
                {
                    const float pan = juce::jlimit(-1.0f, 1.0f,
                        params.aurumOperators[opIndex].pan + centered * params.aurumStereoSpread);
                    const float angle = (pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f;
                    aurumPanGains[(size_t) voice * 6 + opIndex] = { std::cos(angle), std::sin(angle) };
                }
            }
        }
        if constexpr (rendersAether)
        {
          if (preparedTopology.sourceSends)
          {
            const std::array<std::array<float, 2>, 4> sourceSendLevels {{
                params.aetherOscA.fxSends,
                params.aetherOscB.fxSends,
                params.aetherSub.fxSends,
                params.aetherNoise.fxSends,
            }};
            for (size_t source = 0; source < sourceSendLevels.size(); ++source)
                for (size_t bus = 0; bus < AetherSourceBusContext::busCount; ++bus)
                    aetherSourceSendGains[source][bus] = VoiceMath::clamp01(sourceSendLevels[source][bus]);
            for (size_t bus = 0; bus < AetherSourceBusContext::busCount; ++bus)
            {
                aetherSampleSendGains[bus] = VoiceMath::clamp01(params.aetherSampleSlot1.fxSends[bus]);
                aetherGranularSendGains[bus] = VoiceMath::clamp01(params.aetherGranularSlot2.fxSends[bus]);
                lumenOscCSendGains[bus] = VoiceMath::clamp01(params.lumenOscC.fxSends[bus]);
                for (size_t index = 0; index < lumenSampleSendGains.size(); ++index)
                {
                    lumenSampleSendGains[index][bus] = VoiceMath::clamp01(params.lumenSampleSlots[index].fxSends[bus]);
                    lumenGranularSendGains[index][bus] = VoiceMath::clamp01(params.lumenGranularSlots[index].fxSends[bus]);
                }
            }
          }
        }

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
            DynamicModulation::InputFrame modulationFrame;
            if (useDynamicModulation)
                modulationFrame = DynamicModulation::makeInputFrame(
                    rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4,
                    level, noteKeytrack, modWheel, pressure, timbre, params.macroValues);
            const double currentPitchFrequency = juce::jmax(1.0f, pitchFrequencyRamp.next())
                * pitchWheelRate;
            double currentPhaseDelta = currentPitchFrequency / sampleRate;
            if (hasPitchMod)
                currentPhaseDelta *= std::exp2((pitchLfo * pitchMod) / 12.0);
            if constexpr (!rendersAether && !rendersAurum)
            {
                if (useDynamicModulation)
                {
                    const float oscAFineCents = cachedPreparedDynamicModulation.oscAFine.evaluate(modulationFrame, 100.0f);
                    currentPhaseDelta *= std::exp2(oscAFineCents / 1200.0f);
                }
            }
            const double currentFrequency = currentPhaseDelta * sampleRate;
            const float dynamicOscAPosition = useDynamicModulation && cachedDynamicTargets.oscAPosition
                ? cachedPreparedDynamicModulation.oscAPosition.evaluate(modulationFrame, 1.0f)
                : 0.0f;
            const float dynamicUnisonDetune = useDynamicModulation && cachedDynamicTargets.unisonDetune
                ? cachedPreparedDynamicModulation.unisonDetune.evaluate(modulationFrame, 100.0f)
                : 0.0f;
            const float dynamicUnisonSpread = useDynamicModulation && cachedDynamicTargets.unisonSpread
                ? cachedPreparedDynamicModulation.unisonSpread.evaluate(modulationFrame, 1.0f)
                : 0.0f;

            // Oscillator
            StereoSample raw;
            StereoSample directRaw;
            StereoSample filter1Raw;
            StereoSample filter2Raw;
            AetherTableStackRenderer::StereoFrame sampleSourceFrame {};
            std::array<AetherTableStackRenderer::StereoFrame, 3> lumenSampleFrames {};
            AetherTableStackRenderer::StereoFrame granularSourceFrame {};
            std::array<AetherTableStackRenderer::StereoFrame, 3> lumenGranularFrames {};
            AetherTableStackRenderer::StereoFrame lumenSourceFrameC {};
            std::array<AetherTableStackRenderer::StereoFrame, 4> sourceFrames {};
            if constexpr (rendersAurum)
            {
                auto currentOperatorLevels = aurumOperatorLevels;
                std::array<float, 6> currentOperatorPanOffsets {};
                std::array<float, 2> currentFilterCutoffOffsets {};
                std::array<float, 2> currentFilterResonanceOffsets {};
                std::array<float, 2> currentFilterDriveOffsets {};
                if (useDynamicModulation)
                {
                    for (size_t index = 0; index < currentOperatorLevels.size(); ++index)
                    {
                        if (cachedDynamicTargets.aurumOperatorLevel[index])
                            currentOperatorLevels[index] = VoiceMath::clamp01(currentOperatorLevels[index]
                                + cachedPreparedDynamicModulation.aurumOperatorLevel[index].evaluate(modulationFrame, 1.0f));
                        if (cachedDynamicTargets.aurumOperatorPan[index])
                            currentOperatorPanOffsets[index] = cachedPreparedDynamicModulation.aurumOperatorPan[index].evaluate(modulationFrame, 1.0f);
                    }
                    for (size_t index = 0; index < currentFilterCutoffOffsets.size(); ++index)
                    {
                        if (cachedDynamicTargets.aurumFilterCutoff[index])
                            currentFilterCutoffOffsets[index] = cachedPreparedDynamicModulation.aurumFilterCutoff[index].evaluate(modulationFrame, 1.0f);
                        if (cachedDynamicTargets.aurumFilterResonance[index])
                            currentFilterResonanceOffsets[index] = cachedPreparedDynamicModulation.aurumFilterResonance[index].evaluate(modulationFrame, 1.0f);
                        if (cachedDynamicTargets.aurumFilterDrive[index])
                            currentFilterDriveOffsets[index] = cachedPreparedDynamicModulation.aurumFilterDrive[index].evaluate(modulationFrame, 1.0f);
                    }
                }
                const float timeMs = (float) ((double) aurumAgeSamples * 1000.0 / sampleRate);
                const bool releasing = aurumReleaseAgeSamples >= 0;
                const float releaseTimeMs = releasing
                    ? (float) ((double) aurumReleaseAgeSamples * 1000.0 / sampleRate) : 0.0f;
                std::array<float, 6> opEnvelopes {};
                std::array<double, 6> pitchEnvelopeRates {};
                std::array<float, 6> phaseEnvelopeTurns {};
                for (int enabledIndex = 0; enabledIndex < aurumEnabledOperatorCount; ++enabledIndex)
                {
                    const auto target = (size_t) aurumEnabledOperators[(size_t) enabledIndex];
                    const auto& op = params.aurumOperators[target];
                    opEnvelopes[target] = aurumEnvelope(op.attackMs, op.decayMs, op.sustain,
                        op.releaseMs, timeMs, releaseTimeMs, aurumReleaseLevels[target], releasing);
                    if (aurumPitchEnvelopeDepths[target] != 0.0f)
                    {
                        const float pitchEnvelope = aurumEnvelope(op.pitchAttackMs, op.pitchDecayMs,
                            op.pitchSustain, op.pitchReleaseMs, timeMs, releaseTimeMs,
                            aurumPitchReleaseLevels[target], releasing);
                        pitchEnvelopeRates[target] = std::exp2(
                            (double) pitchEnvelope * aurumPitchEnvelopeDepths[target] / 12.0);
                    }
                    else pitchEnvelopeRates[target] = 1.0;
                    if (aurumPhaseEnvelopeTurns[target] != 0.0f)
                    {
                        const float phaseEnvelope = aurumEnvelope(op.phaseAttackMs, op.phaseDecayMs,
                            op.phaseSustain, op.phaseReleaseMs, timeMs, releaseTimeMs,
                            aurumPhaseReleaseLevels[target], releasing);
                        phaseEnvelopeTurns[target] = phaseEnvelope * aurumPhaseEnvelopeTurns[target];
                    }
                }
                StereoSample busA {};
                StereoSample busB {};
                StereoSample direct {};
                for (int substep = 0; substep < aurumOversampling; ++substep)
                {
                    std::array<float, 48> nextOutputs {};
                    StereoSample stepA {};
                    StereoSample stepB {};
                    StereoSample stepDirect {};
                    for (int voice = 0; voice < aurumVoiceCount; ++voice)
                    {
                        const size_t voiceOffset = (size_t) voice * 6;
                        for (int enabledIndex = 0; enabledIndex < aurumEnabledOperatorCount; ++enabledIndex)
                        {
                            const auto target = (size_t) aurumEnabledOperators[(size_t) enabledIndex];
                            const auto& op = params.aurumOperators[target];
                            float fm = 0.0f;
                            for (int routeIndex = 0; routeIndex < aurumFmSourceCounts[target]; ++routeIndex)
                            {
                                const auto source = (size_t) aurumFmSources[target][(size_t) routeIndex];
                                fm += aurumFeedbackSample(aurumOutputs[voiceOffset + source])
                                    * aurumFmAmounts[source][target];
                            }
                            fm = juce::jlimit(-aurumMaximumFmSum, aurumMaximumFmSum, fm);

                            const double delta = currentFrequency * aurumVoiceRates[(size_t) voice]
                                * aurumRatios[target] * aurumTuningRates[target] * pitchEnvelopeRates[target]
                                / (sampleRate * (double) aurumOversampling);
                            float rmGain = 1.0f;
                            for (int routeIndex = 0; routeIndex < aurumRmSourceCounts[target]; ++routeIndex)
                            {
                                const auto source = (size_t) aurumRmSources[target][(size_t) routeIndex];
                                const float amount = aurumRmAmounts[source][target];
                                rmGain *= 1.0f - std::abs(amount)
                                    + aurumFeedbackSample(aurumOutputs[voiceOffset + source]) * amount;
                                rmGain = juce::jlimit(-aurumMaximumRingGain, aurumMaximumRingGain, rmGain);
                            }
                            nextOutputs[voiceOffset + target] = aurumFeedbackSample(
                                aurumOperatorSample(op,
                                    aurumPhases[voiceOffset + target]
                                        + phaseEnvelopeTurns[target]
                                        + fm * aurumFmPhaseScale,
                                    delta)
                                * currentOperatorLevels[target]
                                * opEnvelopes[target]
                                * aurumResponseGains[target]
                                * rmGain);
                            const double nextPhase = aurumPhases[voiceOffset + target] + delta;
                            aurumPhases[voiceOffset + target] = nextPhase - std::floor(nextPhase);
                            currentBlockWork.addOscillatorSamples(1);
                        }

                        for (int enabledIndex = 0; enabledIndex < aurumEnabledOperatorCount; ++enabledIndex)
                        {
                            const auto source = (size_t) aurumEnabledOperators[(size_t) enabledIndex];
                            const float output = nextOutputs[voiceOffset + source];
                            auto panGains = aurumPanGains[voiceOffset + source];
                            if (cachedDynamicTargets.aurumOperatorPan[source])
                            {
                                const float centered = aurumVoiceCount == 1 ? 0.0f
                                    : ((float) voice / (float) (aurumVoiceCount - 1)) * 2.0f - 1.0f;
                                const float pan = juce::jlimit(-1.0f, 1.0f,
                                    params.aurumOperators[source].pan
                                        + centered * params.aurumStereoSpread
                                        + currentOperatorPanOffsets[source]);
                                const float angle = (pan + 1.0f) * juce::MathConstants<float>::pi * 0.25f;
                                panGains = { std::cos(angle), std::sin(angle) };
                            }
                            const auto addToBus = [&](StereoSample& bus, float amount)
                            {
                                const float routed = output * amount;
                                bus.left += routed * panGains[0];
                                bus.right += routed * panGains[1];
                            };
                            if (std::abs(aurumOutputAmounts[source][0]) > 0.0001f)
                                addToBus(stepA, aurumOutputAmounts[source][0]);
                            if (std::abs(aurumOutputAmounts[source][1]) > 0.0001f)
                                addToBus(stepB, aurumOutputAmounts[source][1]);
                            if (std::abs(aurumOutputAmounts[source][2]) > 0.0001f)
                                addToBus(stepDirect, aurumOutputAmounts[source][2]);
                        }
                    }
                    aurumOutputs = nextOutputs;
                    busA.left += stepA.left; busA.right += stepA.right;
                    busB.left += stepB.left; busB.right += stepB.right;
                    direct.left += stepDirect.left; direct.right += stepDirect.right;
                }
                ++aurumAgeSamples;
                if (aurumReleaseAgeSamples >= 0) ++aurumReleaseAgeSamples;
                for (auto* frame : { &busA, &busB, &direct })
                {
                    frame->left *= aurumNormalization;
                    frame->right *= aurumNormalization;
                }

                const auto processAurumFilter = [&](StereoSample input,
                                                    const Params::AurumFilter& config,
                                                    size_t filterIndex,
                                                    FilterStage::State& state,
                                                    DriveStage::State& driveState)
                {
                    if (!config.enabled) return input;
                    if (cachedDynamicTargets.aurumFilterCutoff[filterIndex])
                        currentBlockWork.addFilterCutoffUpdates(state.updateCutoffIfChanged(
                            VoiceMath::clamp01(config.cutoff01 + currentFilterCutoffOffsets[filterIndex]),
                            sampleRate, params.filterKeytrack, currentFrequency, 0.5f));
                    if (cachedDynamicTargets.aurumFilterResonance[filterIndex])
                        currentBlockWork.addFilterResonanceUpdates(state.updateResonanceIfChanged(
                            VoiceMath::clamp01(config.resonance01 + currentFilterResonanceOffsets[filterIndex]), 0.001f));
                    const float drive = VoiceMath::clamp01(config.drive01 + currentFilterDriveOffsets[filterIndex]);
                    if (drive > 0.0001f)
                    {
                        const auto driven = DriveStage::processOversampled(
                            driveState, input, 1.0f + drive * 6.0f);
                        input = { driven.left, driven.right };
                        currentBlockWork.addFilterDriveSamples(DriveStage::workSamplesForChannels(2));
                    }
                    else driveState.reset(input);
                    const auto filtered = state.process(input.left, input.right);
                    return StereoSample { filtered.left, filtered.right };
                };

                const bool hasA = (aurumOutputBusMask & 1) != 0;
                const bool hasB = (aurumOutputBusMask & 2) != 0;
                const bool hasDirect = (aurumOutputBusMask & 4) != 0;
                if (params.aurumFilterRouting == 1)
                {
                    const auto filteredA = hasA
                        ? processAurumFilter(busA, params.aurumFilters[0], 0, filterState, driveState)
                        : StereoSample {};
                    const auto filteredB = hasB
                        ? processAurumFilter(busB, params.aurumFilters[1], 1, aurumFilterBState, aurumFilterBDriveState)
                        : StereoSample {};
                    const int count = (int) hasA + (int) hasB + (int) hasDirect;
                    raw = count > 0 ? StereoSample {
                        (filteredA.left + filteredB.left + direct.left) / (float) count,
                        (filteredA.right + filteredB.right + direct.right) / (float) count,
                    } : StereoSample {};
                }
                else
                {
                    auto serial = hasA
                        ? processAurumFilter(busA, params.aurumFilters[0], 0, filterState, driveState)
                        : StereoSample {};
                    if (hasB) { serial.left += busB.left; serial.right += busB.right; }
                    if (hasA || hasB)
                        serial = processAurumFilter(serial, params.aurumFilters[1], 1, aurumFilterBState, aurumFilterBDriveState);
                    const int count = (int) (hasA || hasB) + (int) hasDirect;
                    raw = count > 0 ? StereoSample {
                        (serial.left + direct.left) / (float) count,
                        (serial.right + direct.right) / (float) count,
                    } : StereoSample {};
                }
            }
            else if constexpr (rendersAether)
            {
                const auto aetherResult = AetherTableStackRenderer::renderPrepared<rendersLumen>(
                    params,
                    cachedDynamicTargets,
                    cachedPreparedDynamicModulation,
                    modulationFrame,
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
                    noiseState,
                    &aetherInteractionState);
                raw = { aetherResult.filteredFrame.left, aetherResult.filteredFrame.right };
                directRaw = { aetherResult.directFrame.left, aetherResult.directFrame.right };
                filter1Raw = { aetherResult.filter1Frame.left, aetherResult.filter1Frame.right };
                filter2Raw = { aetherResult.filter2Frame.left, aetherResult.filter2Frame.right };
                sourceFrames = aetherResult.sourceFrames;
                currentBlockWork.add(aetherResult.work);
                if constexpr (rendersLumen)
                {
                  if (preparedTopology.lumenOscC)
                  {
                    const float sourceLevel = VoiceMath::clamp01(params.lumenOscC.level
                        + (useDynamicModulation && cachedDynamicTargets.oscCLevel
                            ? cachedPreparedDynamicModulation.oscCLevel.evaluate(modulationFrame, 1.0f) : 0.0f));
                    const float sourcePan = juce::jlimit(-1.0f, 1.0f, params.lumenOscC.pan
                        + (useDynamicModulation && cachedDynamicTargets.oscCPan
                            ? cachedPreparedDynamicModulation.oscCPan.evaluate(modulationFrame, 1.0f) : 0.0f));
                    double sourceRate = cachedPitchRates.oscC;
                    if (useDynamicModulation && cachedDynamicTargets.oscCFine)
                        sourceRate *= std::exp2((double) cachedPreparedDynamicModulation.oscCFine.evaluate(modulationFrame, 100.0f) / 1200.0);
                    const float positionMod = useDynamicModulation && cachedDynamicTargets.oscCPosition
                        ? cachedPreparedDynamicModulation.oscCPosition.evaluate(modulationFrame, 1.0f) : 0.0f;
                    const float detuneMod = useDynamicModulation && cachedDynamicTargets.oscCUnisonDetune
                        ? cachedPreparedDynamicModulation.oscCUnisonDetune.evaluate(modulationFrame, 100.0f) : 0.0f;
                    const float spreadMod = useDynamicModulation && cachedDynamicTargets.oscCUnisonSpread
                        ? cachedPreparedDynamicModulation.oscCUnisonSpread.evaluate(modulationFrame, 1.0f) : 0.0f;
                    const auto tableResult = WavetableOscillatorBank::renderStereo<rendersLumen>(
                        lumenOscillatorsC,
                        lumenUnisonPlanC,
                        params.lumenOscC.wavetable,
                        currentFrequency * sourceRate,
                        baseFrequencyHz,
                        sampleRate,
                        positionMod,
                        detuneMod,
                        spreadMod,
                        sourcePan);
                    lumenSourceFrameC = {
                        tableResult.left * sourceLevel,
                        tableResult.right * sourceLevel,
                    };
                    currentBlockWork.addWavetableRender(tableResult.voiceSamples,
                        tableResult.frequencyUpdates, tableResult.positionUpdates);
                    if (params.lumenOscC.routing == 1)
                    {
                        directRaw.left += lumenSourceFrameC.left;
                        directRaw.right += lumenSourceFrameC.right;
                    }
                    else if (params.lumenOscC.routing == 2)
                    {
                        filter1Raw.left += lumenSourceFrameC.left;
                        filter1Raw.right += lumenSourceFrameC.right;
                    }
                    else if (params.lumenOscC.routing == 3)
                    {
                        filter2Raw.left += lumenSourceFrameC.left;
                        filter2Raw.right += lumenSourceFrameC.right;
                    }
                    else if (params.lumenOscC.routing != 4)
                    {
                        raw.left += lumenSourceFrameC.left;
                        raw.right += lumenSourceFrameC.right;
                    }
                  }
                }
                if (preparedTopology.aetherSample)
                {
                    const auto mappedFrame = preparedTopology.aetherSampleUsesSfz
                        ? SampleSourceSlot::StereoFrame {}
                        : aetherSampleSlot1.renderFrame();
                    const auto sfzFrame = preparedTopology.aetherSampleUsesSfz
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
                if constexpr (rendersLumen)
                {
                    for (int activeIndex = 0; activeIndex < preparedTopology.lumenSampleCount; ++activeIndex)
                    {
                        const auto index = (size_t) preparedTopology.lumenSampleIndices[(size_t) activeIndex];
                        const auto& slot = params.lumenSampleSlots[index];
                        const auto mappedFrame = slot.sfzSource
                            ? SampleSourceSlot::StereoFrame {}
                            : lumenSampleSlots[index].renderFrame();
                        const auto sfzFrame = slot.sfzSource
                            ? lumenSfzSlots[index].renderFrame() : SfzSourceSlot::StereoFrame {};
                        const float sampleLeft = mappedFrame.left + sfzFrame.left;
                        const float sampleRight = mappedFrame.right + sfzFrame.right;
                        lumenSampleFrames[index] = { sampleLeft, sampleRight };
                        if (slot.routing == 1)
                        {
                            directRaw.left += sampleLeft; directRaw.right += sampleRight;
                        }
                        else if (slot.routing == 2)
                        {
                            filter1Raw.left += sampleLeft; filter1Raw.right += sampleRight;
                        }
                        else if (slot.routing == 3)
                        {
                            filter2Raw.left += sampleLeft; filter2Raw.right += sampleRight;
                        }
                        else if (slot.routing != 4)
                        {
                            raw.left += sampleLeft; raw.right += sampleRight;
                        }
                    }
                }
                if (preparedTopology.aetherGranular)
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
                if constexpr (rendersLumen)
                {
                    for (int activeIndex = 0; activeIndex < preparedTopology.lumenGranularCount; ++activeIndex)
                    {
                        const auto index = (size_t) preparedTopology.lumenGranularIndices[(size_t) activeIndex];
                        const auto& slot = params.lumenGranularSlots[index];
                        const auto granular = lumenGranularSlots[index].renderFrame();
                        const float granularLeft = granular.left * slot.level;
                        const float granularRight = granular.right * slot.level;
                        lumenGranularFrames[index] = { granularLeft, granularRight };
                        if (slot.routing == 1) { directRaw.left += granularLeft; directRaw.right += granularRight; }
                        else if (slot.routing == 2) { filter1Raw.left += granularLeft; filter1Raw.right += granularRight; }
                        else if (slot.routing == 3) { filter2Raw.left += granularLeft; filter2Raw.right += granularRight; }
                        else if (slot.routing != 4) { raw.left += granularLeft; raw.right += granularRight; }
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

            const auto processActiveWarp = [&](DriveStage::State& state,
                                               float& laneLeft,
                                               float& laneRight,
                                               const RuntimeWarpConfig& config)
            {
                const StereoSample input { laneLeft, laneRight };
                if (config.active && runtimeWarpNeedsWork(state, input))
                {
                    currentBlockWork.addNonlinearSamples(DriveStage::workSamplesForChannels(2));
                    const auto warped = processRuntimeWarpOversampled(state, input, config);
                    laneLeft = warped.left;
                    laneRight = warped.right;
                }
                else if (!config.active)
                {
                    state.reset(input);
                }
            };

            const auto processPreparedWarpLane = [&](uint8_t lane,
                                                     DriveStage::State& state,
                                                     float& laneLeft,
                                                     float& laneRight,
                                                     const RuntimeWarpConfig& config)
            {
                if ((preparedTopology.routeLaneMask & lane) != 0)
                    processActiveWarp(state, laneLeft, laneRight, config);
                else
                    state.reset({ laneLeft, laneRight });
            };

            if constexpr (rendersAether)
            {
                processPreparedWarpLane(1u, aetherRuntimeWarpState, left, right, runtimeWarpConfig);
                processPreparedWarpLane(2u, aetherDirectRuntimeWarpState, directLeft, directRight, runtimeWarpConfig);
                processPreparedWarpLane(4u, aetherFilter1RuntimeWarpState, filter1RouteLeft, filter1RouteRight, runtimeWarpConfig);
                processPreparedWarpLane(8u, aetherFilter2RuntimeWarpState, filter2RouteLeft, filter2RouteRight, runtimeWarpConfig);
                processPreparedWarpLane(1u, aetherRuntimeWarp2State, left, right, runtimeWarp2Config);
                processPreparedWarpLane(2u, aetherDirectRuntimeWarp2State, directLeft, directRight, runtimeWarp2Config);
                processPreparedWarpLane(4u, aetherFilter1RuntimeWarp2State, filter1RouteLeft, filter1RouteRight, runtimeWarp2Config);
                processPreparedWarpLane(8u, aetherFilter2RuntimeWarp2State, filter2RouteLeft, filter2RouteRight, runtimeWarp2Config);
            }
            else
            {
                aetherRuntimeWarpState.reset({ left, right });
                aetherDirectRuntimeWarpState.reset({ directLeft, directRight });
                aetherFilter1RuntimeWarpState.reset({ filter1RouteLeft, filter1RouteRight });
                aetherFilter2RuntimeWarpState.reset({ filter2RouteLeft, filter2RouteRight });
                aetherRuntimeWarp2State.reset({ left, right });
                aetherDirectRuntimeWarp2State.reset({ directLeft, directRight });
                aetherFilter1RuntimeWarp2State.reset({ filter1RouteLeft, filter1RouteRight });
                aetherFilter2RuntimeWarp2State.reset({ filter2RouteLeft, filter2RouteRight });
            }

            if constexpr (!rendersAurum)
            {
            const float filterInputLeft = left;
            const float filterInputRight = right;

            // Drive (soft clipping)
            const float drive = VoiceMath::clamp01(params.drive01 + (useDynamicModulation && cachedDynamicTargets.filterDrive
                ? cachedPreparedDynamicModulation.filterDrive.evaluate(modulationFrame, 1.0f)
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
                    ? cachedPreparedDynamicModulation.filterCutoff.evaluate(modulationFrame, 0.35f)
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
                        + cachedPreparedDynamicModulation.filterResonance.evaluate(modulationFrame, 1.0f));
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

            if constexpr (rendersAether)
            {
              if ((preparedTopology.routeLaneMask & 4u) != 0
                  && (filter1RouteLeft != 0.0f || filter1RouteRight != 0.0f))
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
            }
            else filter1RouteDriveState.reset();

            if constexpr (rendersAether)
            {
              if ((preparedTopology.routeLaneMask & 8u) != 0
                  && (filter2RouteLeft != 0.0f || filter2RouteRight != 0.0f))
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
            }
            else filter2RouteDriveState.reset();

            if constexpr (rendersAether)
            {
                if ((preparedTopology.routeLaneMask & 2u) != 0
                    && (directLeft != 0.0f || directRight != 0.0f))
                {
                    left += directLeft;
                    right += directRight;
                }
            }
            }

            const float ampLevel = VoiceMath::clamp01(params.ampLevel + (useDynamicModulation && cachedDynamicTargets.ampLevel
                ? cachedPreparedDynamicModulation.ampLevel.evaluate(modulationFrame, 1.0f)
                : 0.0f));
            const float ampPan = hasAmpPanMod
                ? juce::jlimit(-1.0f, 1.0f, params.ampPan + cachedPreparedDynamicModulation.ampPan.evaluate(modulationFrame, 1.0f))
                : params.ampPan;
            const auto panGains = hasAmpPanMod ? VoiceMath::equalPowerPanGains(ampPan) : cachedPanGains.amp;
            const float voiceGain = (rendersAurum ? 1.0f : env) * level * 0.4f * ampLevel;
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

            if constexpr (rendersAether)
            {
              if (preparedTopology.sourceSends)
              {
                for (size_t bus = 0; bus < AetherSourceBusContext::busCount; ++bus)
                {
                    VoiceTransition::Stereo send {};
                    for (size_t source = 0; source < sourceFrames.size(); ++source)
                    {
                        const float sendGain = aetherSourceSendGains[source][bus];
                        send.left += sourceFrames[source].left * sendGain;
                        send.right += sourceFrames[source].right * sendGain;
                    }
                    const float sampleSendGain = aetherSampleSendGains[bus];
                    send.left += sampleSourceFrame.left * sampleSendGain;
                    send.right += sampleSourceFrame.right * sampleSendGain;
                    if constexpr (rendersLumen)
                    {
                        for (size_t index = 0; index < lumenSampleFrames.size(); ++index)
                        {
                            const float gain = lumenSampleSendGains[index][bus];
                            send.left += lumenSampleFrames[index].left * gain;
                            send.right += lumenSampleFrames[index].right * gain;
                        }
                    }
                    const float granularSendGain = aetherGranularSendGains[bus];
                    send.left += granularSourceFrame.left * granularSendGain;
                    send.right += granularSourceFrame.right * granularSendGain;
                    if constexpr (rendersLumen)
                        for (size_t index = 0; index < lumenGranularFrames.size(); ++index)
                        {
                            const float gain = lumenGranularSendGains[index][bus];
                            send.left += lumenGranularFrames[index].left * gain;
                            send.right += lumenGranularFrames[index].right * gain;
                        }
                    const float lumenSendGain = lumenOscCSendGains[bus];
                    send.left += lumenSourceFrameC.left * lumenSendGain;
                    send.right += lumenSourceFrameC.right * lumenSendGain;
                    send.left *= leftGain * voiceGain;
                    send.right *= rightGain * voiceGain;
                    const auto transitionedSend = sourceSendTransitions[bus].process(send);
                    lastSourceSendOutputs[bus] = transitionedSend;
                    AetherSourceBusContext::add(bus, startSample + i,
                        VoiceMath::denormalSafe(transitionedSend.left),
                        VoiceMath::denormalSafe(transitionedSend.right));
                }
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

        if constexpr (rendersAurum)
        {
            if (aurumReleaseAgeSamples >= 0 && !aurumReleaseTailActive())
            {
                aurumNoteActive = false;
                clearCurrentNote();
            }
        }
        else if (!adsr.isActive())
        {
            clearCurrentNote();
        }

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
            && !params.hasAurum
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
        cachedPreparedDynamicModulation = DynamicModulation::prepare(params.dynamicModulation);
    }

}
