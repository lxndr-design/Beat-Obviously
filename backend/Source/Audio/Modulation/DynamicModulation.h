#pragma once

#include "Lfo.h"

#include <algorithm>
#include <cmath>

namespace beat::DynamicModulation
{
    struct TargetActivityFlags
    {
        bool ampPan { false };
        bool oscAPan { false };
        bool oscBPan { false };
        bool oscAFine { false };
        bool oscBFine { false };
        bool oscAPosition { false };
        bool oscBPosition { false };
        bool oscALevel { false };
        bool oscBLevel { false };
        bool filterCutoff { false };
        bool filterResonance { false };
        bool filterDrive { false };
        bool ampLevel { false };
        bool unisonDetune { false };
        bool unisonSpread { false };
        bool any { false };
    };

    struct RenderPlan
    {
        float pitchMod { 0.0f };
        bool useDynamicModulation { false };
        bool hasPitchMod { false };
        bool hasPositionMod { false };
        bool hasFilterMod { false };
        bool needsLfoValue { false };
        bool needsLfo2Value { false };
        bool hasAmpPanMod { false };
    };

    inline float routeEnvValue(float env, bool bipolar) noexcept
    {
        return bipolar ? env * 2.0f - 1.0f : env;
    }

    template <typename Target>
    bool targetActive(const Target& target) noexcept
    {
        return std::abs(target.lfo) > 0.0001f
            || std::abs(target.lfo2) > 0.0001f
            || std::abs(target.env) > 0.0001f
            || std::abs(target.env2) > 0.0001f
            || std::abs(target.velocity) > 0.0001f
            || std::abs(target.keytrack) > 0.0001f
            || std::abs(target.modWheel) > 0.0001f;
    }

    template <typename Target>
    float targetOffset(
        const Target& target,
        float rawLfo,
        float rawLfo2,
        float env,
        float env2,
        float velocity,
        float keytrack,
        float modWheel,
        float scale) noexcept
    {
        return (Lfo::routeValue(rawLfo, target.lfoBipolar) * target.lfo
            + Lfo::routeValue(rawLfo2, target.lfo2Bipolar) * target.lfo2
            + routeEnvValue(env, target.envBipolar) * target.env
            + routeEnvValue(env2, target.env2Bipolar) * target.env2
            + routeEnvValue(velocity, target.velocityBipolar) * target.velocity
            + routeEnvValue(keytrack, target.keytrackBipolar) * target.keytrack
            + routeEnvValue(modWheel, target.modWheelBipolar) * target.modWheel) * scale;
    }

    template <typename Modulation>
    TargetActivityFlags targetActivityFlags(const Modulation& modulation) noexcept
    {
        if (!modulation.active)
            return {};

        TargetActivityFlags flags;
        flags.ampPan = targetActive(modulation.ampPan);
        flags.oscAPan = targetActive(modulation.oscAPan);
        flags.oscBPan = targetActive(modulation.oscBPan);
        flags.oscAFine = targetActive(modulation.oscAFine);
        flags.oscBFine = targetActive(modulation.oscBFine);
        flags.oscAPosition = targetActive(modulation.oscAPosition);
        flags.oscBPosition = targetActive(modulation.oscBPosition);
        flags.oscALevel = targetActive(modulation.oscALevel);
        flags.oscBLevel = targetActive(modulation.oscBLevel);
        flags.filterCutoff = targetActive(modulation.filterCutoff);
        flags.filterResonance = targetActive(modulation.filterResonance);
        flags.filterDrive = targetActive(modulation.filterDrive);
        flags.ampLevel = targetActive(modulation.ampLevel);
        flags.unisonDetune = targetActive(modulation.unisonDetune);
        flags.unisonSpread = targetActive(modulation.unisonSpread);
        flags.any =
            flags.ampPan
            || flags.oscAPan
            || flags.oscBPan
            || flags.oscAFine
            || flags.oscBFine
            || flags.oscAPosition
            || flags.oscBPosition
            || flags.oscALevel
            || flags.oscBLevel
            || flags.filterCutoff
            || flags.filterResonance
            || flags.filterDrive
            || flags.ampLevel
            || flags.unisonDetune
            || flags.unisonSpread;
        return flags;
    }

    inline bool hasFilterCoefficientMod(const TargetActivityFlags& flags) noexcept
    {
        return flags.filterCutoff || flags.filterResonance;
    }

    inline RenderPlan makeRenderPlan(
        const TargetActivityFlags& flags,
        bool dynamicModulationActive,
        bool lfo2Enabled,
        float lfoToPitch,
        float lfoDepth,
        float lfoToFilter,
        float envToFilter) noexcept
    {
        RenderPlan plan;
        plan.pitchMod = std::max(0.0f, lfoToPitch);
        plan.useDynamicModulation = dynamicModulationActive && flags.any;
        plan.hasPitchMod = !plan.useDynamicModulation && plan.pitchMod > 0.0001f;
        plan.hasPositionMod = !plan.useDynamicModulation && std::abs(lfoDepth) > 0.0001f;
        const bool hasDynamicFilterCoefficientMod = plan.useDynamicModulation && hasFilterCoefficientMod(flags);
        plan.hasFilterMod = hasDynamicFilterCoefficientMod
            || std::abs(lfoToFilter) > 0.0001f
            || std::abs(envToFilter) > 0.0001f;
        plan.needsLfoValue = plan.useDynamicModulation || plan.hasPitchMod || plan.hasPositionMod || plan.hasFilterMod;
        plan.needsLfo2Value = plan.useDynamicModulation && lfo2Enabled;
        plan.hasAmpPanMod = flags.ampPan;
        return plan;
    }
}
