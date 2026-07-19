#pragma once

#include <juce_core/juce_core.h>

#include <array>
#include <cmath>

namespace beat::WavetableUnison
{
    struct Plan
    {
        int unison { 0 };
        float detuneCents { -1.0f };
        float spread { -1.0f };
        float weightSum { 1.0f };
        float appliedBasePan { 2.0f };
        std::array<double, 8> rates {};
        std::array<double, 8> appliedFrequencyHz {};
        std::array<float, 8> centered {};
        std::array<float, 8> weights {};
        std::array<float, 8> phaseSpread {};
        std::array<float, 8> appliedPosition {};
        std::array<float, 8> leftGains {};
        std::array<float, 8> rightGains {};
    };

    inline void invalidate(Plan& plan) noexcept
    {
        plan.appliedFrequencyHz.fill(-1.0);
        plan.appliedPosition.fill(-1.0f);
    }

    inline Plan& update(Plan& plan,
                        int configUnison,
                        float configDetuneCents,
                        float configBlend,
                        float detuneCentsMod,
                        float spreadMod) noexcept
    {
        const int unison = juce::jlimit(1, 8, configUnison);
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
        invalidate(plan);
        return plan;
    }
}
