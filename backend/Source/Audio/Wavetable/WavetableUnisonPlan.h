#pragma once

#include "WavetableUnisonConfig.h"

#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <cmath>

namespace beat::WavetableUnison
{
    using SimdFloat = juce::dsp::SIMDRegister<float>;
    inline constexpr int simdWidth = (int) SimdFloat::SIMDNumElements;
    static_assert(maxVoices % simdWidth == 0,
                  "The fixed unison bank must divide evenly into native SIMD groups");
    inline constexpr int simdGroupCapacity = (maxVoices + simdWidth - 1) / simdWidth;

    struct Plan
    {
        int unison { 0 };
        float detuneCents { -1.0f };
        float spread { -1.0f };
        float weightSum { 1.0f };
        float appliedBasePan { 2.0f };
        int requestedUnison { 0 };
        float requestedDetuneCents { -1.0f };
        float requestedBlend { -1.0f };
        float requestedDetuneMod { -1000.0f };
        float requestedSpreadMod { -1000.0f };
        double requestedFrequencyHz { -1.0 };
        double requestedSampleRate { -1.0 };
        float requestedPosition { -1.0f };
        std::array<double, capacity> rates {};
        std::array<double, capacity> appliedFrequencyHz {};
        std::array<float, capacity> centered {};
        alignas(64) std::array<float, capacity> weights {};
        std::array<float, capacity> phaseSpread {};
        std::array<float, capacity> appliedPosition {};
        alignas(64) std::array<float, capacity> leftGains {};
        alignas(64) std::array<float, capacity> rightGains {};
        std::array<SimdFloat, simdGroupCapacity> simdWeights {};
        std::array<SimdFloat, simdGroupCapacity> simdWeightedLeftGains {};
        std::array<SimdFloat, simdGroupCapacity> simdWeightedRightGains {};
    };

    inline void refreshSimdWeights(Plan& plan) noexcept
    {
        for (int group = 0; group < simdGroupCapacity; ++group)
            plan.simdWeights[(size_t) group] = SimdFloat::fromRawArray(
                plan.weights.data() + (size_t) group * (size_t) simdWidth);
    }

    inline void refreshSimdStereoGains(Plan& plan) noexcept
    {
        for (int group = 0; group < simdGroupCapacity; ++group)
        {
            const auto weights = plan.simdWeights[(size_t) group];
            plan.simdWeightedLeftGains[(size_t) group] = weights * SimdFloat::fromRawArray(
                plan.leftGains.data() + (size_t) group * (size_t) simdWidth);
            plan.simdWeightedRightGains[(size_t) group] = weights * SimdFloat::fromRawArray(
                plan.rightGains.data() + (size_t) group * (size_t) simdWidth);
        }
    }

    inline void invalidate(Plan& plan) noexcept
    {
        plan.appliedFrequencyHz.fill(-1.0);
        plan.appliedPosition.fill(-1.0f);
        plan.requestedFrequencyHz = -1.0;
        plan.requestedSampleRate = -1.0;
        plan.requestedPosition = -1.0f;
    }

    inline Plan& update(Plan& plan,
                        int configUnison,
                        float configDetuneCents,
                        float configBlend,
                        float detuneCentsMod,
                        float spreadMod) noexcept
    {
        if (plan.requestedUnison == configUnison
            && plan.requestedDetuneCents == configDetuneCents
            && plan.requestedBlend == configBlend
            && plan.requestedDetuneMod == detuneCentsMod
            && plan.requestedSpreadMod == spreadMod)
            return plan;

        plan.requestedUnison = configUnison;
        plan.requestedDetuneCents = configDetuneCents;
        plan.requestedBlend = configBlend;
        plan.requestedDetuneMod = detuneCentsMod;
        plan.requestedSpreadMod = spreadMod;
        const int unison = juce::jlimit(1, maxVoices, configUnison);
        const float rawDetuneCents = juce::jlimit(0.0f, 100.0f, configDetuneCents + detuneCentsMod);
        const float rawSpread = juce::jlimit(0.0f, 1.0f, configBlend + spreadMod);
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
        plan.appliedBasePan = 2.0f;

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
        refreshSimdWeights(plan);
        invalidate(plan);
        return plan;
    }
}
