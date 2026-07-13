#pragma once

#include "../Modulation/DynamicModulation.h"
#include "../Wavetable/WavetableOscillator.h"
#include "../Wavetable/WavetableOscillatorBank.h"
#include "../Wavetable/WavetableUnisonPlan.h"
#include "BasicOscillator.h"
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
        VoiceStats::RenderWork work {};
    };

    template <typename Params, typename TargetActivityFlags>
    Result render(
        const Params& params,
        const TargetActivityFlags& targets,
        const VoiceAetherCache::PanGains& panGains,
        const VoiceAetherCache::PitchRates& pitchRates,
        std::array<WavetableOscillator, 8>& oscillatorsA,
        std::array<WavetableOscillator, 8>& oscillatorsB,
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
        juce::uint32& noiseState) noexcept
    {
        Result result;
        const bool useDynamicModulation = params.dynamicModulation.active && targets.any;
        const float unisonDetuneMod = useDynamicModulation && targets.unisonDetune
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 100.0f)
            : 0.0f;
        const float unisonSpreadMod = useDynamicModulation && targets.unisonSpread
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
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
        } renderedA, renderedB;

        const auto add = [&](float value, float level, float pan, std::pair<float, float> staticPanGains, bool panIsDynamic, int routing)
        {
            const float safeLevel = VoiceMath::clamp01(level);
            const auto [leftGain, rightGain] = panIsDynamic ? VoiceMath::equalPowerPanGains(pan) : staticPanGains;
            auto& destinationLeft = routing == 1 ? directLeftSum : routing == 2 ? filter1LeftSum : routing == 3 ? filter2LeftSum : leftSum;
            auto& destinationRight = routing == 1 ? directRightSum : routing == 2 ? filter1RightSum : routing == 3 ? filter2RightSum : rightSum;
            destinationLeft += value * safeLevel * leftGain;
            destinationRight += value * safeLevel * rightGain;
            levelSum += safeLevel;
        };

        const auto renderOsc = [&](
            const auto& osc,
            std::array<WavetableOscillator, 8>& oscillators,
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
            RenderedOscillator& rendered)
        {
            const float modulatedLevel = VoiceMath::clamp01(osc.level + (useDynamicModulation && levelIsDynamic
                ? DynamicModulation::targetOffset(levelTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? DynamicModulation::targetOffset(panTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));

            const float positionMod = useDynamicModulation && positionIsDynamic
                ? DynamicModulation::targetOffset(positionTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f;
            if (osc.waveform == 4)
            {
                ++result.work.oscillatorSamples;
                ++componentSampleCounter;
                add(VoiceMath::nextNoise(noiseState), modulatedLevel, modulatedPan, staticPanGains, panIsDynamic, osc.routing);
                return;
            }

            double rate = staticRate;
            if (fineIsDynamic)
            {
                const float fineOffsetCents = DynamicModulation::targetOffset(fineTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 100.0f);
                rate *= std::exp2((double) fineOffsetCents / 1200.0);
                ++result.work.oscillatorRateCalculations;
            }

            float value = 0.0f;
            if (osc.waveform == 5)
            {
                const float oscillatorDetuneMod = useDynamicModulation && unisonDetuneIsDynamic
                    ? DynamicModulation::targetOffset(unisonDetuneTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 100.0f)
                    : 0.0f;
                const float oscillatorSpreadMod = useDynamicModulation && unisonSpreadIsDynamic
                    ? DynamicModulation::targetOffset(unisonSpreadTarget, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                    : 0.0f;
                const auto tableResult = WavetableOscillatorBank::render(
                    oscillators,
                    unisonPlan,
                    osc.wavetable,
                    frequencyHz * rate,
                    baseFrequencyHz,
                    sampleRate,
                    positionMod,
                    unisonDetuneMod + oscillatorDetuneMod,
                    unisonSpreadMod + oscillatorSpreadMod);
                value = tableResult.sample;
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
            rendered = { value, modulatedLevel, leftGain, rightGain, osc.routing, true };
            add(value, modulatedLevel, modulatedPan, staticPanGains, panIsDynamic, osc.routing);
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
            renderedA);
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
            renderedB);

        const float interactionAmount = VoiceMath::clamp01(params.aetherInteractionAmount);
        if (params.aetherInteractionMode != 0 && interactionAmount > 0.0f && renderedA.active && renderedB.active)
        {
            const float interacted = params.aetherInteractionMode == 1
                ? renderedA.value * (0.5f + 0.5f * renderedB.value)
                : renderedA.value * renderedB.value;
            const float delta = std::isfinite(interacted)
                ? (interacted - renderedA.value) * interactionAmount
                : 0.0f;
            auto& destinationLeft = renderedA.routing == 1 ? directLeftSum : renderedA.routing == 2 ? filter1LeftSum : renderedA.routing == 3 ? filter2LeftSum : leftSum;
            auto& destinationRight = renderedA.routing == 1 ? directRightSum : renderedA.routing == 2 ? filter1RightSum : renderedA.routing == 3 ? filter2RightSum : rightSum;
            destinationLeft += delta * renderedA.level * renderedA.leftGain;
            destinationRight += delta * renderedA.level * renderedA.rightGain;
            ++result.work.nonlinearSamples;
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
                params.aetherSub.routing);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            ++result.work.oscillatorSamples;
            ++result.work.aetherNoiseSamples;
            const float noise = VoiceMath::nextNoise(noiseState);
            add(noise * (0.35f + VoiceMath::clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level, 0.0f, VoiceMath::centerPanGains, false, params.aetherNoise.routing);
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
        result.frame.left = juce::jlimit(-1.0f, 1.0f, result.filteredFrame.left + result.filter1Frame.left + result.filter2Frame.left + result.directFrame.left);
        result.frame.right = juce::jlimit(-1.0f, 1.0f, result.filteredFrame.right + result.filter1Frame.right + result.filter2Frame.right + result.directFrame.right);
        return result;
    }
}
