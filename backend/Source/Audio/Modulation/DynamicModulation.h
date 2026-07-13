#pragma once

#include "Lfo.h"

#include <algorithm>
#include <array>
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
        bool oscAUnisonDetune { false };
        bool oscAUnisonSpread { false };
        bool oscBUnisonDetune { false };
        bool oscBUnisonSpread { false };
        bool filterCutoff { false };
        bool filterResonance { false };
        bool filterDrive { false };
        bool ampLevel { false };
        bool unisonDetune { false };
        bool unisonSpread { false };
        bool lfo { false };
        bool lfo2 { false };
        bool env { false };
        bool env2 { false };
        bool velocity { false };
        bool keytrack { false };
        bool modWheel { false };
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
        bool needsEnv2Value { false };
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
            || std::abs(target.modWheel) > 0.0001f
            || std::abs(target.macro1) > 0.0001f
            || std::abs(target.macro2) > 0.0001f
            || std::abs(target.macro3) > 0.0001f
            || std::abs(target.macro4) > 0.0001f
            || std::abs(target.macro5) > 0.0001f
            || std::abs(target.macro6) > 0.0001f
            || std::abs(target.macro7) > 0.0001f
            || std::abs(target.macro8) > 0.0001f;
    }

    template <typename Target>
    void addSourceActivity(TargetActivityFlags& flags, const Target& target) noexcept
    {
        flags.lfo = flags.lfo || std::abs(target.lfo) > 0.0001f;
        flags.lfo2 = flags.lfo2 || std::abs(target.lfo2) > 0.0001f;
        flags.env = flags.env || std::abs(target.env) > 0.0001f;
        flags.env2 = flags.env2 || std::abs(target.env2) > 0.0001f;
        flags.velocity = flags.velocity || std::abs(target.velocity) > 0.0001f;
        flags.keytrack = flags.keytrack || std::abs(target.keytrack) > 0.0001f;
        flags.modWheel = flags.modWheel || std::abs(target.modWheel) > 0.0001f;
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
        const std::array<float, 8>& macroValues,
        float scale) noexcept
    {
        return (Lfo::routeValue(rawLfo, target.lfoBipolar) * target.lfo
            + Lfo::routeValue(rawLfo2, target.lfo2Bipolar) * target.lfo2
            + routeEnvValue(env, target.envBipolar) * target.env
            + routeEnvValue(env2, target.env2Bipolar) * target.env2
            + routeEnvValue(velocity, target.velocityBipolar) * target.velocity
            + routeEnvValue(keytrack, target.keytrackBipolar) * target.keytrack
            + routeEnvValue(modWheel, target.modWheelBipolar) * target.modWheel
            + macroValues[0] * target.macro1
            + macroValues[1] * target.macro2
            + macroValues[2] * target.macro3
            + macroValues[3] * target.macro4
            + macroValues[4] * target.macro5
            + macroValues[5] * target.macro6
            + macroValues[6] * target.macro7
            + macroValues[7] * target.macro8) * scale;
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
        flags.oscAUnisonDetune = targetActive(modulation.oscAUnisonDetune);
        flags.oscAUnisonSpread = targetActive(modulation.oscAUnisonSpread);
        flags.oscBUnisonDetune = targetActive(modulation.oscBUnisonDetune);
        flags.oscBUnisonSpread = targetActive(modulation.oscBUnisonSpread);
        flags.filterCutoff = targetActive(modulation.filterCutoff);
        flags.filterResonance = targetActive(modulation.filterResonance);
        flags.filterDrive = targetActive(modulation.filterDrive);
        flags.ampLevel = targetActive(modulation.ampLevel);
        flags.unisonDetune = targetActive(modulation.unisonDetune);
        flags.unisonSpread = targetActive(modulation.unisonSpread);
        addSourceActivity(flags, modulation.ampPan);
        addSourceActivity(flags, modulation.oscAPan);
        addSourceActivity(flags, modulation.oscBPan);
        addSourceActivity(flags, modulation.oscAFine);
        addSourceActivity(flags, modulation.oscBFine);
        addSourceActivity(flags, modulation.oscAPosition);
        addSourceActivity(flags, modulation.oscBPosition);
        addSourceActivity(flags, modulation.oscALevel);
        addSourceActivity(flags, modulation.oscBLevel);
        addSourceActivity(flags, modulation.oscAUnisonDetune);
        addSourceActivity(flags, modulation.oscAUnisonSpread);
        addSourceActivity(flags, modulation.oscBUnisonDetune);
        addSourceActivity(flags, modulation.oscBUnisonSpread);
        addSourceActivity(flags, modulation.filterCutoff);
        addSourceActivity(flags, modulation.filterResonance);
        addSourceActivity(flags, modulation.filterDrive);
        addSourceActivity(flags, modulation.ampLevel);
        addSourceActivity(flags, modulation.unisonDetune);
        addSourceActivity(flags, modulation.unisonSpread);
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
            || flags.oscAUnisonDetune
            || flags.oscAUnisonSpread
            || flags.oscBUnisonDetune
            || flags.oscBUnisonSpread
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
        const bool hasLegacyFilterLfoMod = !plan.useDynamicModulation && std::abs(lfoToFilter) > 0.0001f;
        const bool hasLegacyFilterEnvMod = !plan.useDynamicModulation && std::abs(envToFilter) > 0.0001f;
        plan.hasFilterMod = hasDynamicFilterCoefficientMod
            || hasLegacyFilterLfoMod
            || hasLegacyFilterEnvMod;
        plan.needsLfoValue = (plan.useDynamicModulation && flags.lfo) || plan.hasPitchMod || plan.hasPositionMod || hasLegacyFilterLfoMod;
        plan.needsLfo2Value = plan.useDynamicModulation && lfo2Enabled && flags.lfo2;
        plan.needsEnv2Value = plan.useDynamicModulation && flags.env2;
        plan.hasAmpPanMod = flags.ampPan;
        return plan;
    }
}
