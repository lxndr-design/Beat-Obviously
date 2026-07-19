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
        double oscAPhaseOffset,
        double oscBPhaseOffset,
        float rawLfo,
        float rawLfo2,
        float env,
        float env2,
        float velocity,
        float noteKeytrack,
        float modWheel,
        juce::uint32& noiseState) noexcept
    {
        Result result;
        const bool useDynamicModulation = params.dynamicModulation.active && targets.any;
        const float unisonDetuneMod = useDynamicModulation && targets.unisonDetune
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonDetune, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 100.0f)
            : 0.0f;
        const float unisonSpreadMod = useDynamicModulation && targets.unisonSpread
            ? DynamicModulation::targetOffset(params.dynamicModulation.unisonSpread, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
            : 0.0f;
        float leftSum = 0.0f;
        float rightSum = 0.0f;
        float levelSum = 0.0f;

        const auto add = [&](float value, float level, float pan, std::pair<float, float> staticPanGains, bool panIsDynamic)
        {
            const float safeLevel = VoiceMath::clamp01(level);
            const auto [leftGain, rightGain] = panIsDynamic ? VoiceMath::equalPowerPanGains(pan) : staticPanGains;
            leftSum += value * safeLevel * leftGain;
            rightSum += value * safeLevel * rightGain;
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
            std::pair<float, float> staticPanGains,
            bool panIsDynamic,
            bool fineIsDynamic,
            bool positionIsDynamic,
            bool levelIsDynamic,
            double staticRate,
            double phaseOffset,
            int64_t& componentSampleCounter)
        {
            const float modulatedLevel = VoiceMath::clamp01(osc.level + (useDynamicModulation && levelIsDynamic
                ? DynamicModulation::targetOffset(levelTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));
            if (!osc.enabled || modulatedLevel <= 0.0f)
                return;
            const float modulatedPan = juce::jlimit(-1.0f, 1.0f, osc.pan + (useDynamicModulation
                ? DynamicModulation::targetOffset(panTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f));

            const float positionMod = useDynamicModulation && positionIsDynamic
                ? DynamicModulation::targetOffset(positionTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 1.0f)
                : 0.0f;
            if (osc.waveform == 4)
            {
                ++result.work.oscillatorSamples;
                ++componentSampleCounter;
                add(VoiceMath::nextNoise(noiseState), modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
                return;
            }

            double rate = staticRate;
            if (fineIsDynamic)
            {
                const float fineOffsetCents = DynamicModulation::targetOffset(fineTarget, rawLfo, rawLfo2, env, env2, velocity, noteKeytrack, modWheel, params.macroValues, 100.0f);
                rate *= std::exp2((double) fineOffsetCents / 1200.0);
                ++result.work.oscillatorRateCalculations;
            }

            float value = 0.0f;
            if (osc.waveform == 5)
            {
                const auto tableResult = WavetableOscillatorBank::renderStereo(
                    oscillators,
                    unisonPlan,
                    osc.wavetable,
                    frequencyHz * rate,
                    baseFrequencyHz,
                    sampleRate,
                    positionMod,
                    unisonDetuneMod,
                    unisonSpreadMod,
                    modulatedPan);
                leftSum += tableResult.left * modulatedLevel;
                rightSum += tableResult.right * modulatedLevel;
                levelSum += modulatedLevel;
                result.work.wavetableVoiceSamples += tableResult.voiceSamples;
                result.work.wavetableFrequencyUpdates += tableResult.frequencyUpdates;
                result.work.wavetablePositionUpdates += tableResult.positionUpdates;
                componentSampleCounter += tableResult.voiceSamples;
                return;
            }
            else
            {
                value = BasicOscillator::sample(osc.waveform, phase * rate + phaseOffset, (frequencyHz * rate) / sampleRate);
                ++result.work.oscillatorSamples;
                ++componentSampleCounter;
            }
            add(value, modulatedLevel, modulatedPan, staticPanGains, panIsDynamic);
        };

        renderOsc(
            params.aetherOscA,
            oscillatorsA,
            unisonPlanA,
            params.dynamicModulation.oscAPosition,
            params.dynamicModulation.oscAFine,
            params.dynamicModulation.oscALevel,
            params.dynamicModulation.oscAPan,
            panGains.oscA,
            targets.oscAPan,
            targets.oscAFine,
            targets.oscAPosition,
            targets.oscALevel,
            pitchRates.oscA,
            oscAPhaseOffset,
            result.work.aetherOscASamples);
        renderOsc(
            params.aetherOscB,
            oscillatorsB,
            unisonPlanB,
            params.dynamicModulation.oscBPosition,
            params.dynamicModulation.oscBFine,
            params.dynamicModulation.oscBLevel,
            params.dynamicModulation.oscBPan,
            panGains.oscB,
            targets.oscBPan,
            targets.oscBFine,
            targets.oscBPosition,
            targets.oscBLevel,
            pitchRates.oscB,
            oscBPhaseOffset,
            result.work.aetherOscBSamples);

        if (params.aetherSub.enabled && params.aetherSub.level > 0.0f)
        {
            ++result.work.oscillatorSamples;
            ++result.work.aetherSubSamples;
            add(BasicOscillator::sample(params.aetherSub.waveform, phase * pitchRates.sub, (frequencyHz * pitchRates.sub) / sampleRate),
                params.aetherSub.level,
                0.0f,
                VoiceMath::centerPanGains,
                false);
        }

        if (params.aetherNoise.enabled && params.aetherNoise.level > 0.0f)
        {
            ++result.work.oscillatorSamples;
            ++result.work.aetherNoiseSamples;
            const float noise = VoiceMath::nextNoise(noiseState);
            add(noise * (0.35f + VoiceMath::clamp01(params.aetherNoise.color) * 0.65f), params.aetherNoise.level, 0.0f, VoiceMath::centerPanGains, false);
        }

        if (levelSum <= 0.0f)
            return result;

        const float normalizer = juce::jmax(0.35f, levelSum);
        result.frame.left = juce::jlimit(-1.0f, 1.0f, leftSum / normalizer);
        result.frame.right = juce::jlimit(-1.0f, 1.0f, rightSum / normalizer);
        return result;
    }
}
