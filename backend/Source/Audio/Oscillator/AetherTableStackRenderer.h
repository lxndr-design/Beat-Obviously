#pragma once

#include "../Modulation/DynamicModulation.h"
#include "../Wavetable/WavetableOscillator.h"
#include "../Wavetable/WavetableOscillatorBank.h"
#include "../Wavetable/WavetableUnisonPlan.h"
#include "BasicOscillator.h"
#include "AetherInteractionStage.h"
#include "VoiceAetherCache.h"
#include "VoiceMath.h"
#include "VoiceStats.h"

#include <juce_core/juce_core.h>

#include <array>
#include <cmath>
#include <utility>

namespace beat::AetherTableStackRenderer
{
    struct StereoFrame
    {
        float left { 0.0f };
        float right { 0.0f };
    };

    struct Result
    {
        StereoFrame frame {};
        StereoFrame filteredFrame {};
        StereoFrame filter1Frame {};
        StereoFrame filter2Frame {};
        StereoFrame directFrame {};
        std::array<StereoFrame, 4> sourceFrames {}; // osc A, osc B, sub, noise
        VoiceStats::RenderWork work {};
    };

    struct InteractionState
    {
        AetherInteractionStage::State downsampler;
        WavetableOscillatorBank::Bank oscillatorsA;
        WavetableOscillatorBank::Bank oscillatorsB;
        WavetableUnison::Plan unisonPlanA;
        WavetableUnison::Plan unisonPlanB;
        juce::uint32 noiseStateA { 1 };
        juce::uint32 noiseStateB { 1 };
        double baseSampleRate { 44100.0 };

        void prepare(double sampleRate, AudioQuality quality) noexcept
        {
            baseSampleRate = std::isfinite(sampleRate) && sampleRate > 0.0 ? sampleRate : 44100.0;
            downsampler.prepare(baseSampleRate, quality);
            const double oversampledRate = baseSampleRate * (double) downsampler.factor;
            for (auto& oscillator : oscillatorsA)
            {
                oscillator.prepare(oversampledRate);
                oscillator.setQuality(quality);
            }
            for (auto& oscillator : oscillatorsB)
            {
                oscillator.prepare(oversampledRate);
                oscillator.setQuality(quality);
            }
            downsampler.reset();
        }

        template <typename Config>
        void configure(const Wavetable* tableA,
                       const Config& configA,
                       const Wavetable* tableB,
                       const Config& configB,
                       double frequencyHz) noexcept
        {
            const double oversampledRate = baseSampleRate * (double) downsampler.factor;
            if (configA.waveform == 5)
                WavetableOscillatorBank::configure(oscillatorsA, tableA, configA.wavetable, oversampledRate, frequencyHz);
            else
                WavetableOscillatorBank::clear(oscillatorsA, unisonPlanA);
            if (configB.waveform == 5)
                WavetableOscillatorBank::configure(oscillatorsB, tableB, configB.wavetable, oversampledRate, frequencyHz);
            else
                WavetableOscillatorBank::clear(oscillatorsB, unisonPlanB);
            WavetableUnison::invalidate(unisonPlanA);
            WavetableUnison::invalidate(unisonPlanB);
        }

        void setPhases(const WavetableUnison::PhaseArray& phasesA,
                       const WavetableUnison::PhaseArray& phasesB,
                       juce::uint32 noiseSeed) noexcept
        {
            for (size_t index = 0; index < oscillatorsA.size(); ++index)
            {
                oscillatorsA[index].setPhase(phasesA[index]);
                oscillatorsB[index].setPhase(phasesB[index]);
            }
            noiseStateA = noiseSeed ^ 0x38f2a6d1u;
            noiseStateB = noiseSeed ^ 0x9b71c45fu;
            downsampler.reset();
        }
    };

    template <typename Params, typename TargetActivityFlags>
    Result render(
        const Params& params,
        const TargetActivityFlags& targets,
        const VoiceAetherCache::PanGains& panGains,
        const VoiceAetherCache::PitchRates& pitchRates,
        WavetableOscillatorBank::Bank& oscillatorsA,
        WavetableOscillatorBank::Bank& oscillatorsB,
        WavetableUnison::Plan& unisonPlanA,
        WavetableUnison::Plan& unisonPlanB,
        double frequencyHz,
        double baseFrequencyHz,
        double sampleRate,
        double phase,
        double oscABasePhase,
        double oscBBasePhase,
        double oscAPhaseOffset,
        double oscBPhaseOffset,
        float rawLfo,
        float rawLfo2,
        const std::array<float, 8>& rawExtraLfos,
        float env,
        float env2,
        float env3,
        float env4,
        float velocity,
        float noteKeytrack,
        float modWheel,
        juce::uint32& noiseState,
        float pressure = 0.0f,
        float timbre = 0.0f,
        InteractionState* interactionState = nullptr) noexcept
    {
        Result result;
        const bool useDynamicModulation = params.dynamicModulation.active && targets.any;
        const float unisonDetuneMod = useDynamicModulation && targets.unisonDetune
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 100.0f)
            : 0.0f;
        const float unisonSpreadMod = useDynamicModulation && targets.unisonSpread
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
            : 0.0f;
        float leftSum = 0.0f;
        float rightSum = 0.0f;
        float directLeftSum = 0.0f;
        float directRightSum = 0.0f;
        float filter1LeftSum = 0.0f;
        float filter1RightSum = 0.0f;
        float filter2LeftSum = 0.0f;
        float filter2RightSum = 0.0f;
        float levelSum = 0.0f;

        struct RenderedOscillator
        {
            float value { 0.0f };
            float level { 0.0f };
            float leftGain { 0.0f };
            float rightGain { 0.0f };
            int routing { 0 };
            bool active { false };
            double rate { 1.0 };
            float positionMod { 0.0f };
            float unisonDetuneMod { 0.0f };
            float unisonSpreadMod { 0.0f };
        } renderedA, renderedB;

        const auto add = [&](float value, float level, float pan, std::pair<float, float> staticPanGains,
                             bool panIsDynamic, int routing, StereoFrame& sourceFrame)
        {
            const float safeLevel = VoiceMath::clamp01(level);
            const auto [leftGain, rightGain] = panIsDynamic ? VoiceMath::equalPowerPanGains(pan) : staticPanGains;
            auto& destinationLeft = routing == 1 ? directLeftSum : routing == 2 ? filter1LeftSum : routing == 3 ? filter2LeftSum : leftSum;
            auto& destinationRight = routing == 1 ? directRightSum : routing == 2 ? filter1RightSum : routing == 3 ? filter2RightSum : rightSum;
            const float sourceLeft = value * safeLevel * leftGain;
            const float sourceRight = value * safeLevel * rightGain;
            destinationLeft += sourceLeft;
            destinationRight += sourceRight;
            if (params.hasAetherSourceSends)
            {
                sourceFrame.left += sourceLeft;
                sourceFrame.right += sourceRight;
            }
            levelSum += safeLevel;
        };

        const auto addStereo = [&](float leftValue, float rightValue, float level, int routing, StereoFrame& sourceFrame)
        {
            const float safeLevel = VoiceMath::clamp01(level);
            auto& destinationLeft = routing == 1 ? directLeftSum : routing == 2 ? filter1LeftSum : routing == 3 ? filter2LeftSum : leftSum;
            auto& destinationRight = routing == 1 ? directRightSum : routing == 2 ? filter1RightSum : routing == 3 ? filter2RightSum : rightSum;
            const float sourceLeft = leftValue * safeLevel;
            const float sourceRight = rightValue * safeLevel;
            destinationLeft += sourceLeft;
            destinationRight += sourceRight;
            if (params.hasAetherSourceSends)
            {
                sourceFrame.left += sourceLeft;
                sourceFrame.right += sourceRight;
            }
            levelSum += safeLevel;
        };

        const auto renderOsc = [&](
            const auto& osc,
            WavetableOscillatorBank::Bank& oscillators,
            WavetableUnison::Plan& unisonPlan,
            const auto& positionTarget,
            const auto& fineTarget,
            const auto& levelTarget,
            const auto& panTarget,
            const auto& unisonDetuneTarget,
            const auto& unisonSpreadTarget,
            std::pair<float, float> staticPanGains,
            bool panIsDynamic,
            bool fineIsDynamic,
            bool positionIsDynamic,
            bool levelIsDynamic,
            bool unisonDetuneIsDynamic,
            bool unisonSpreadIsDynamic,
            double staticRate,
            double basePhase,
            double phaseOffset,
            int64_t& componentSampleCounter,
            RenderedOscillator& rendered,
            StereoFrame& sourceFrame)
        {
            const float modulatedLevel = VoiceMath::clamp01(osc.level + (useDynamicModulation && levelIsDynamic
                ? DynamicModulation::targetOffset(levelTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? DynamicModulation::targetOffset(panTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f));

            const float positionMod = useDynamicModulation && positionIsDynamic
                ? DynamicModulation::targetOffset(positionTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                : 0.0f;
            if (osc.waveform == 4)
            {
                ++result.work.oscillatorSamples;
                ++componentSampleCounter;
                const float value = VoiceMath::nextNoise(noiseState);
                const auto [leftGain, rightGain] = panIsDynamic
                    ? VoiceMath::equalPowerPanGains(modulatedPan)
                    : staticPanGains;
                rendered = { value, modulatedLevel, leftGain, rightGain, osc.routing, true };
                add(value, modulatedLevel, modulatedPan, staticPanGains,
                    panIsDynamic, osc.routing, sourceFrame);
                return;
            }

            double rate = staticRate;
            if (fineIsDynamic)
            {
                const float fineOffsetCents = DynamicModulation::targetOffset(fineTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 100.0f);
                rate *= std::exp2((double) fineOffsetCents / 1200.0);
                ++result.work.oscillatorRateCalculations;
            }

            float value = 0.0f;
            float oscillatorDetuneMod = 0.0f;
            float oscillatorSpreadMod = 0.0f;
            bool stereoAdded = false;
            if (osc.waveform == 5)
            {
                oscillatorDetuneMod = useDynamicModulation && unisonDetuneIsDynamic
                    ? DynamicModulation::targetOffset(unisonDetuneTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 100.0f)
                    : 0.0f;
                oscillatorSpreadMod = useDynamicModulation && unisonSpreadIsDynamic
                    ? DynamicModulation::targetOffset(unisonSpreadTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, pressure, timbre, params.macroValues, 1.0f)
                    : 0.0f;
                const auto tableResult = WavetableOscillatorBank::renderStereo(
                    oscillators,
                    unisonPlan,
                    osc.wavetable,
                    frequencyHz * rate,
                    baseFrequencyHz,
                    sampleRate,
                    positionMod,
                    unisonDetuneMod + oscillatorDetuneMod,
                    unisonSpreadMod + oscillatorSpreadMod,
                    modulatedPan);
                addStereo(tableResult.left, tableResult.right, modulatedLevel, osc.routing, sourceFrame);
                value = (tableResult.left + tableResult.right) * 0.5f;
                stereoAdded = true;
                result.work.wavetableVoiceSamples += tableResult.voiceSamples;
                result.work.wavetableFrequencyUpdates += tableResult.frequencyUpdates;
                result.work.wavetablePositionUpdates += tableResult.positionUpdates;
                componentSampleCounter += tableResult.voiceSamples;
            }
            else
            {
                value = BasicOscillator::sample(osc.waveform, basePhase * rate + phaseOffset, (frequencyHz * rate) / sampleRate);
                ++result.work.oscillatorSamples;
                ++componentSampleCounter;
            }
            const auto [leftGain, rightGain] = panIsDynamic ? VoiceMath::equalPowerPanGains(modulatedPan) : staticPanGains;
            rendered = { value, modulatedLevel, leftGain, rightGain, osc.routing, true,
                         rate, positionMod, unisonDetuneMod + oscillatorDetuneMod,
                         unisonSpreadMod + oscillatorSpreadMod };
            if (!stereoAdded)
                add(value, modulatedLevel, modulatedPan, staticPanGains, panIsDynamic, osc.routing, sourceFrame);
        };

        renderOsc(
            params.aetherOscA,
            oscillatorsA,
            unisonPlanA,
            params.dynamicModulation.oscAPosition,
            params.dynamicModulation.oscAFine,
            params.dynamicModulation.oscALevel,
            params.dynamicModulation.oscAPan,
            params.dynamicModulation.oscAUnisonDetune,
            params.dynamicModulation.oscAUnisonSpread,
            panGains.oscA,
            targets.oscAPan,
            targets.oscAFine,
            targets.oscAPosition,
            targets.oscALevel,
            targets.oscAUnisonDetune,
            targets.oscAUnisonSpread,
            pitchRates.oscA,
            oscABasePhase,
            oscAPhaseOffset,
            result.work.aetherOscASamples,
            renderedA,
            result.sourceFrames[0]);
        renderOsc(
            params.aetherOscB,
            oscillatorsB,
            unisonPlanB,
            params.dynamicModulation.oscBPosition,
            params.dynamicModulation.oscBFine,
            params.dynamicModulation.oscBLevel,
            params.dynamicModulation.oscBPan,
            params.dynamicModulation.oscBUnisonDetune,
            params.dynamicModulation.oscBUnisonSpread,
            panGains.oscB,
            targets.oscBPan,
            targets.oscBFine,
            targets.oscBPosition,
            targets.oscBLevel,
            targets.oscBUnisonDetune,
            targets.oscBUnisonSpread,
            pitchRates.oscB,
            oscBBasePhase,
            oscBPhaseOffset,
            result.work.aetherOscBSamples,
            renderedB,
            result.sourceFrames[1]);

        const float interactionAmount = VoiceMath::clamp01(params.aetherInteractionAmount);
        if (params.aetherInteractionMode != 0 && interactionAmount > 0.0f && renderedA.active && renderedB.active)
        {
            float interacted = 0.0f;
            if (interactionState != nullptr)
            {
                const double oversampledRate = sampleRate * (double) interactionState->downsampler.factor;
                const auto renderInteractionOscillator = [&](const auto& osc,
                                                             const RenderedOscillator& rendered,
                                                             WavetableOscillatorBank::Bank& oscillators,
                                                             WavetableUnison::Plan& plan,
                                                             juce::uint32& interactionNoiseState,
                                                             int64_t& componentSampleCounter,
                                                             double basePhase,
                                                             double phaseOffset,
                                                             int subsample,
                                                             int factor) noexcept
                {
                    if (osc.waveform == 4)
                    {
                        ++result.work.oscillatorSamples;
                        ++componentSampleCounter;
                        return VoiceMath::nextNoise(interactionNoiseState);
                    }
                    if (osc.waveform == 5)
                    {
                        const auto tableResult = WavetableOscillatorBank::render(
                            oscillators, plan, osc.wavetable, frequencyHz * rendered.rate,
                            baseFrequencyHz, oversampledRate, rendered.positionMod,
                            rendered.unisonDetuneMod, rendered.unisonSpreadMod);
                        result.work.wavetableVoiceSamples += tableResult.voiceSamples;
                        result.work.wavetableFrequencyUpdates += tableResult.frequencyUpdates;
                        result.work.wavetablePositionUpdates += tableResult.positionUpdates;
                        componentSampleCounter += tableResult.voiceSamples;
                        return tableResult.sample;
                    }
                    const double subsamplePhase = basePhase
                        + (frequencyHz / sampleRate) * ((double) subsample / (double) factor);
                    ++result.work.oscillatorSamples;
                    ++componentSampleCounter;
                    return BasicOscillator::sample(
                        osc.waveform,
                        subsamplePhase * rendered.rate + phaseOffset,
                        (frequencyHz * rendered.rate) / oversampledRate);
                };
                interacted = interactionState->downsampler.process(params.aetherInteractionMode,
                    [&](int subsample, int factor) noexcept
                    {
                        const float carrier = renderInteractionOscillator(
                            params.aetherOscA, renderedA, interactionState->oscillatorsA,
                            interactionState->unisonPlanA, interactionState->noiseStateA,
                            result.work.aetherOscASamples,
                            oscABasePhase, oscAPhaseOffset,
                            subsample, factor);
                        const float modulator = renderInteractionOscillator(
                            params.aetherOscB, renderedB, interactionState->oscillatorsB,
                            interactionState->unisonPlanB, interactionState->noiseStateB,
                            result.work.aetherOscBSamples,
                            oscBBasePhase, oscBPhaseOffset,
                            subsample, factor);
                        return std::pair { carrier, modulator };
                    });
                result.work.nonlinearSamples += interactionState->downsampler.factor;
            }
            else
            {
                interacted = params.aetherInteractionMode == 1
                    ? renderedA.value * (0.5f + 0.5f * renderedB.value)
                    : renderedA.value * renderedB.value;
                ++result.work.nonlinearSamples;
            }
            const float delta = std::isfinite(interacted)
                ? (interacted - renderedA.value) * interactionAmount
                : 0.0f;
            auto& destinationLeft = renderedA.routing == 1 ? directLeftSum : renderedA.routing == 2 ? filter1LeftSum : renderedA.routing == 3 ? filter2LeftSum : leftSum;
            auto& destinationRight = renderedA.routing == 1 ? directRightSum : renderedA.routing == 2 ? filter1RightSum : renderedA.routing == 3 ? filter2RightSum : rightSum;
            destinationLeft += delta * renderedA.level * renderedA.leftGain;
            destinationRight += delta * renderedA.level * renderedA.rightGain;
            if (params.hasAetherSourceSends)
            {
                result.sourceFrames[0].left += delta * renderedA.level * renderedA.leftGain;
                result.sourceFrames[0].right += delta * renderedA.level * renderedA.rightGain;
            }
        }

        if (params.aetherSub.enabled && params.aetherSub.level > 0.0f)
        {
            ++result.work.oscillatorSamples;
            ++result.work.aetherSubSamples;
            add(BasicOscillator::sample(params.aetherSub.waveform, phase * pitchRates.sub, (frequencyHz * pitchRates.sub) / sampleRate),
                params.aetherSub.level,
                0.0f,
                VoiceMath::centerPanGains,
                false,
                params.aetherSub.routing,
                result.sourceFrames[2]);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            ++result.work.oscillatorSamples;
            ++result.work.aetherNoiseSamples;
            const float noise = VoiceMath::nextNoise(noiseState);
            add(noise * (0.35f + VoiceMath::clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level,
                0.0f, VoiceMath::centerPanGains, false, params.aetherNoise.routing, result.sourceFrames[3]);
        }

        if (levelSum <= 0.0f)
            return result;

        const float normalizer = juce::jmax(0.35f, levelSum);
        result.filteredFrame.left = juce::jlimit(-1.0f, 1.0f, leftSum / normalizer);
        result.filteredFrame.right = juce::jlimit(-1.0f, 1.0f, rightSum / normalizer);
        result.directFrame.left = juce::jlimit(-1.0f, 1.0f, directLeftSum / normalizer);
        result.directFrame.right = juce::jlimit(-1.0f, 1.0f, directRightSum / normalizer);
        result.filter1Frame.left = juce::jlimit(-1.0f, 1.0f, filter1LeftSum / normalizer);
        result.filter1Frame.right = juce::jlimit(-1.0f, 1.0f, filter1RightSum / normalizer);
        result.filter2Frame.left = juce::jlimit(-1.0f, 1.0f, filter2LeftSum / normalizer);
        result.filter2Frame.right = juce::jlimit(-1.0f, 1.0f, filter2RightSum / normalizer);
        if (params.hasAetherSourceSends)
        {
            for (auto& sourceFrame : result.sourceFrames)
            {
                sourceFrame.left = juce::jlimit(-1.0f, 1.0f, sourceFrame.left / normalizer);
                sourceFrame.right = juce::jlimit(-1.0f, 1.0f, sourceFrame.right / normalizer);
            }
        }
        result.frame.left = juce::jlimit(-1.0f, 1.0f, result.filteredFrame.left + result.filter1Frame.left + result.filter2Frame.left + result.directFrame.left);
        result.frame.right = juce::jlimit(-1.0f, 1.0f, result.filteredFrame.right + result.filter1Frame.right + result.filter2Frame.right + result.directFrame.right);
        return result;
    }
}
