#pragma once

#include "Lfo.h"

#include <algorithm>
#include <array>
#include <cstdint>
#include <cmath>

namespace beat::DynamicModulation
{
    struct TargetActivityFlags
    {
        bool ampPan { false };
        bool oscAPan { false };
        bool oscBPan { false };
        bool oscCPan { false };
        bool oscAFine { false };
        bool oscBFine { false };
        bool oscCFine { false };
        bool oscAPosition { false };
        bool oscBPosition { false };
        bool oscCPosition { false };
        bool oscALevel { false };
        bool oscBLevel { false };
        bool oscCLevel { false };
        bool oscAUnisonDetune { false };
        bool oscAUnisonSpread { false };
        bool oscBUnisonDetune { false };
        bool oscBUnisonSpread { false };
        bool oscCUnisonDetune { false };
        bool oscCUnisonSpread { false };
        bool filterCutoff { false };
        bool filterResonance { false };
        bool filterDrive { false };
        bool ampLevel { false };
        bool unisonDetune { false };
        bool unisonSpread { false };
        std::array<bool, 6> aurumOperatorLevel {};
        std::array<bool, 6> aurumOperatorPan {};
        std::array<bool, 2> aurumFilterCutoff {};
        std::array<bool, 2> aurumFilterResonance {};
        std::array<bool, 2> aurumFilterDrive {};
        bool lfo { false };
        bool lfo2 { false };
        std::array<bool, 8> extraLfo {};
        bool env { false };
        bool env2 { false };
        bool env3 { false };
        bool env4 { false };
        bool velocity { false };
        bool keytrack { false };
        bool modWheel { false };
        bool pressure { false };
        bool timbre { false };
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
        std::array<bool, 8> needsExtraLfoValue {};
        bool needsEnv2Value { false };
        bool needsEnv3Value { false };
        bool needsEnv4Value { false };
        bool hasAmpPanMod { false };
    };

    enum class PreparedSource : uint8_t
    {
        lfo,
        lfo2,
        extraLfo1,
        extraLfo2,
        extraLfo3,
        extraLfo4,
        extraLfo5,
        extraLfo6,
        extraLfo7,
        extraLfo8,
        env,
        env2,
        env3,
        env4,
        velocity,
        keytrack,
        modWheel,
        pressure,
        timbre,
        macro1,
        macro2,
        macro3,
        macro4,
        macro5,
        macro6,
        macro7,
        macro8,
        count,
    };

    struct InputFrame
    {
        static constexpr size_t sourceCount = static_cast<size_t>(PreparedSource::count);
        std::array<float, sourceCount> values;

        float operator[](PreparedSource source) const noexcept
        {
            return values[static_cast<size_t>(source)];
        }
    };

    inline InputFrame makeInputFrame(
        float rawLfo,
        float rawLfo2,
        const std::array<float, 8>& rawExtraLfos,
        float env,
        float env2,
        float env3,
        float env4,
        float velocity,
        float keytrack,
        float modWheel,
        float pressure,
        float timbre,
        const std::array<float, 8>& macroValues) noexcept
    {
        InputFrame frame;
        frame.values = {
            rawLfo,
            rawLfo2,
            rawExtraLfos[0],
            rawExtraLfos[1],
            rawExtraLfos[2],
            rawExtraLfos[3],
            rawExtraLfos[4],
            rawExtraLfos[5],
            rawExtraLfos[6],
            rawExtraLfos[7],
            env,
            env2,
            env3,
            env4,
            velocity,
            keytrack,
            modWheel,
            pressure,
            timbre,
            macroValues[0],
            macroValues[1],
            macroValues[2],
            macroValues[3],
            macroValues[4],
            macroValues[5],
            macroValues[6],
            macroValues[7],
        };
        return frame;
    }

    struct PreparedRoute
    {
        PreparedSource source { PreparedSource::lfo };
        float amount { 0.0f };
        bool bipolar { false };
        uint8_t curve { 0 };
    };

    inline float applyRemapCurve(float value, uint8_t curve) noexcept
    {
        if (curve == 0) return value;
        const float sign = value < 0.0f ? -1.0f : 1.0f;
        const float x = std::clamp(std::abs(value), 0.0f, 1.0f);
        float shaped = x;
        if (curve == 1) shaped = x * x;
        else if (curve == 2) shaped = 1.0f - (1.0f - x) * (1.0f - x);
        else if (curve == 3) shaped = x * x * (3.0f - 2.0f * x);
        return sign * shaped;
    }

    inline float routeEnvValue(float env, bool bipolar) noexcept;

    struct PreparedTarget
    {
        std::array<PreparedRoute, 2> lfoRoutes {};
        std::array<PreparedRoute, 8> extraLfoRoutes {};
        std::array<PreparedRoute, 17> expressionRoutes {};
        uint8_t lfoRouteCount { 0 };
        uint8_t extraLfoRouteCount { 0 };
        uint8_t expressionRouteCount { 0 };

        bool active() const noexcept
        {
            return lfoRouteCount != 0 || extraLfoRouteCount != 0 || expressionRouteCount != 0;
        }

        int routeCount() const noexcept
        {
            return (int) lfoRouteCount + (int) extraLfoRouteCount + (int) expressionRouteCount;
        }

        float evaluate(const InputFrame& frame, float scale) const noexcept
        {
            const auto routeValue = [&frame](const PreparedRoute& route) noexcept
            {
                const float raw = frame[route.source];
                const auto sourceIndex = static_cast<size_t>(route.source);
                const auto firstEnvelope = static_cast<size_t>(PreparedSource::env);
                const auto firstMacro = static_cast<size_t>(PreparedSource::macro1);
                const float shaped = sourceIndex < firstEnvelope
                    ? Lfo::routeValue(raw, route.bipolar)
                    : sourceIndex < firstMacro
                        ? routeEnvValue(raw, route.bipolar)
                        : raw;
                return applyRemapCurve(shaped, route.curve) * route.amount;
            };

            float value = 0.0f;
            for (uint8_t index = 0; index < lfoRouteCount; ++index)
                value += routeValue(lfoRoutes[index]);

            // Preserve the legacy evaluator's separately accumulated extra-LFO
            // term so existing patches retain their floating-point order.
            float extraLfoValue = 0.0f;
            for (uint8_t index = 0; index < extraLfoRouteCount; ++index)
                extraLfoValue += routeValue(extraLfoRoutes[index]);
            value += extraLfoValue;

            for (uint8_t index = 0; index < expressionRouteCount; ++index)
                value += routeValue(expressionRoutes[index]);
            return value * scale;
        }
    };

    template <typename Target>
    PreparedTarget prepareTarget(const Target& target) noexcept
    {
        PreparedTarget prepared;
        const auto add = [&target](auto& routes, uint8_t& count, PreparedSource source, float amount, bool bipolar) noexcept
        {
            if (amount != 0.0f)
                routes[count++] = { source, amount, bipolar, target.curves[static_cast<size_t>(source)] };
        };

        add(prepared.lfoRoutes, prepared.lfoRouteCount, PreparedSource::lfo, target.lfo, target.lfoBipolar);
        add(prepared.lfoRoutes, prepared.lfoRouteCount, PreparedSource::lfo2, target.lfo2, target.lfo2Bipolar);
        for (size_t index = 0; index < target.extraLfo.size(); ++index)
            add(prepared.extraLfoRoutes, prepared.extraLfoRouteCount,
                static_cast<PreparedSource>(static_cast<size_t>(PreparedSource::extraLfo1) + index),
                target.extraLfo[index], target.extraLfoBipolar[index]);

        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::env, target.env, target.envBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::env2, target.env2, target.env2Bipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::env3, target.env3, target.env3Bipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::env4, target.env4, target.env4Bipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::velocity, target.velocity, target.velocityBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::keytrack, target.keytrack, target.keytrackBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::modWheel, target.modWheel, target.modWheelBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::pressure, target.pressure, target.pressureBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::timbre, target.timbre, target.timbreBipolar);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro1, target.macro1, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro2, target.macro2, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro3, target.macro3, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro4, target.macro4, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro5, target.macro5, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro6, target.macro6, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro7, target.macro7, false);
        add(prepared.expressionRoutes, prepared.expressionRouteCount, PreparedSource::macro8, target.macro8, false);
        return prepared;
    }

    struct PreparedState
    {
        PreparedTarget oscAPosition;
        PreparedTarget oscAFine;
        PreparedTarget oscALevel;
        PreparedTarget oscAPan;
        PreparedTarget oscBPosition;
        PreparedTarget oscBFine;
        PreparedTarget oscBLevel;
        PreparedTarget oscBPan;
        PreparedTarget oscCPosition;
        PreparedTarget oscCFine;
        PreparedTarget oscCLevel;
        PreparedTarget oscCPan;
        PreparedTarget oscAUnisonDetune;
        PreparedTarget oscAUnisonSpread;
        PreparedTarget oscBUnisonDetune;
        PreparedTarget oscBUnisonSpread;
        PreparedTarget oscCUnisonDetune;
        PreparedTarget oscCUnisonSpread;
        PreparedTarget filterCutoff;
        PreparedTarget filterResonance;
        PreparedTarget filterDrive;
        PreparedTarget ampLevel;
        PreparedTarget ampPan;
        PreparedTarget unisonDetune;
        PreparedTarget unisonSpread;
        std::array<PreparedTarget, 6> aurumOperatorLevel;
        std::array<PreparedTarget, 6> aurumOperatorPan;
        std::array<PreparedTarget, 2> aurumFilterCutoff;
        std::array<PreparedTarget, 2> aurumFilterResonance;
        std::array<PreparedTarget, 2> aurumFilterDrive;
        int activeRouteCount { 0 };
    };

    template <typename Modulation>
    PreparedState prepare(const Modulation& modulation) noexcept
    {
        PreparedState state;
        if (!modulation.active)
            return state;
        const auto assign = [&state](PreparedTarget& destination, const auto& source) noexcept
        {
            destination = prepareTarget(source);
            state.activeRouteCount += destination.routeCount();
        };
        assign(state.oscAPosition, modulation.oscAPosition);
        assign(state.oscAFine, modulation.oscAFine);
        assign(state.oscALevel, modulation.oscALevel);
        assign(state.oscAPan, modulation.oscAPan);
        assign(state.oscBPosition, modulation.oscBPosition);
        assign(state.oscBFine, modulation.oscBFine);
        assign(state.oscBLevel, modulation.oscBLevel);
        assign(state.oscBPan, modulation.oscBPan);
        assign(state.oscCPosition, modulation.oscCPosition);
        assign(state.oscCFine, modulation.oscCFine);
        assign(state.oscCLevel, modulation.oscCLevel);
        assign(state.oscCPan, modulation.oscCPan);
        assign(state.oscAUnisonDetune, modulation.oscAUnisonDetune);
        assign(state.oscAUnisonSpread, modulation.oscAUnisonSpread);
        assign(state.oscBUnisonDetune, modulation.oscBUnisonDetune);
        assign(state.oscBUnisonSpread, modulation.oscBUnisonSpread);
        assign(state.oscCUnisonDetune, modulation.oscCUnisonDetune);
        assign(state.oscCUnisonSpread, modulation.oscCUnisonSpread);
        assign(state.filterCutoff, modulation.filterCutoff);
        assign(state.filterResonance, modulation.filterResonance);
        assign(state.filterDrive, modulation.filterDrive);
        assign(state.ampLevel, modulation.ampLevel);
        assign(state.ampPan, modulation.ampPan);
        assign(state.unisonDetune, modulation.unisonDetune);
        assign(state.unisonSpread, modulation.unisonSpread);
        for (size_t index = 0; index < state.aurumOperatorLevel.size(); ++index)
        {
            assign(state.aurumOperatorLevel[index], modulation.aurumOperatorLevel[index]);
            assign(state.aurumOperatorPan[index], modulation.aurumOperatorPan[index]);
        }
        for (size_t index = 0; index < state.aurumFilterCutoff.size(); ++index)
        {
            assign(state.aurumFilterCutoff[index], modulation.aurumFilterCutoff[index]);
            assign(state.aurumFilterResonance[index], modulation.aurumFilterResonance[index]);
            assign(state.aurumFilterDrive[index], modulation.aurumFilterDrive[index]);
        }
        return state;
    }

    inline float routeEnvValue(float env, bool bipolar) noexcept
    {
        return bipolar ? env * 2.0f - 1.0f : env;
    }

    template <typename Target>
    float targetOffset(
        const Target&, float, float, const std::array<float, 8>&, float, float, float, float,
        float, float, float, float, float, const std::array<float, 8>&, float) noexcept;

    template <typename Target>
    bool targetActive(const Target& target) noexcept
    {
        return std::abs(target.lfo) > 0.0001f
            || std::abs(target.lfo2) > 0.0001f
            || std::any_of(target.extraLfo.begin(), target.extraLfo.end(), [](float value) { return std::abs(value) > 0.0001f; })
            || std::abs(target.env) > 0.0001f
            || std::abs(target.env2) > 0.0001f
            || std::abs(target.env3) > 0.0001f
            || std::abs(target.env4) > 0.0001f
            || std::abs(target.velocity) > 0.0001f
            || std::abs(target.keytrack) > 0.0001f
            || std::abs(target.modWheel) > 0.0001f
            || std::abs(target.pressure) > 0.0001f
            || std::abs(target.timbre) > 0.0001f
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
        for (size_t index = 0; index < flags.extraLfo.size(); ++index)
            flags.extraLfo[index] = flags.extraLfo[index] || std::abs(target.extraLfo[index]) > 0.0001f;
        flags.env = flags.env || std::abs(target.env) > 0.0001f;
        flags.env2 = flags.env2 || std::abs(target.env2) > 0.0001f;
        flags.env3 = flags.env3 || std::abs(target.env3) > 0.0001f;
        flags.env4 = flags.env4 || std::abs(target.env4) > 0.0001f;
        flags.velocity = flags.velocity || std::abs(target.velocity) > 0.0001f;
        flags.keytrack = flags.keytrack || std::abs(target.keytrack) > 0.0001f;
        flags.modWheel = flags.modWheel || std::abs(target.modWheel) > 0.0001f;
        flags.pressure = flags.pressure || std::abs(target.pressure) > 0.0001f;
        flags.timbre = flags.timbre || std::abs(target.timbre) > 0.0001f;
    }

    template <typename Target>
    float targetOffset(
        const Target& target, float rawLfo, float rawLfo2, float env, float env2, float env3, float env4,
        float velocity, float keytrack, float modWheel,
        const std::array<float, 8>& macroValues, float scale) noexcept
    {
        return targetOffset(target, rawLfo, rawLfo2, std::array<float, 8> {}, env, env2, env3, env4,
            velocity, keytrack, modWheel, 0.0f, 0.0f, macroValues, scale);
    }

    template <typename Target>
    float targetOffset(
        const Target& target, float rawLfo, float rawLfo2, const std::array<float, 8>& rawExtraLfos,
        float env, float env2, float env3, float env4, float velocity, float keytrack, float modWheel,
        const std::array<float, 8>& macroValues, float scale) noexcept
    {
        return targetOffset(target, rawLfo, rawLfo2, rawExtraLfos, env, env2, env3, env4,
            velocity, keytrack, modWheel, 0.0f, 0.0f, macroValues, scale);
    }

    template <typename Target>
    float targetOffset(
        const Target& target,
        float rawLfo,
        float rawLfo2,
        const std::array<float, 8>& rawExtraLfos,
        float env,
        float env2,
        float env3,
        float env4,
        float velocity,
        float keytrack,
        float modWheel,
        float pressure,
        float timbre,
        const std::array<float, 8>& macroValues,
        float scale) noexcept
    {
        float extraLfoOffset = 0.0f;
        for (size_t index = 0; index < rawExtraLfos.size(); ++index)
            extraLfoOffset += Lfo::routeValue(rawExtraLfos[index], target.extraLfoBipolar[index]) * target.extraLfo[index];
        return (Lfo::routeValue(rawLfo, target.lfoBipolar) * target.lfo
            + Lfo::routeValue(rawLfo2, target.lfo2Bipolar) * target.lfo2
            + extraLfoOffset
            + routeEnvValue(env, target.envBipolar) * target.env
            + routeEnvValue(env2, target.env2Bipolar) * target.env2
            + routeEnvValue(env3, target.env3Bipolar) * target.env3
            + routeEnvValue(env4, target.env4Bipolar) * target.env4
            + routeEnvValue(velocity, target.velocityBipolar) * target.velocity
            + routeEnvValue(keytrack, target.keytrackBipolar) * target.keytrack
            + routeEnvValue(modWheel, target.modWheelBipolar) * target.modWheel
            + routeEnvValue(pressure, target.pressureBipolar) * target.pressure
            + routeEnvValue(timbre, target.timbreBipolar) * target.timbre
            + macroValues[0] * target.macro1
            + macroValues[1] * target.macro2
            + macroValues[2] * target.macro3
            + macroValues[3] * target.macro4
            + macroValues[4] * target.macro5
            + macroValues[5] * target.macro6
            + macroValues[6] * target.macro7
            + macroValues[7] * target.macro8) * scale;
    }

    template <typename Target>
    float targetOffset(
        const Target& target, float rawLfo, float rawLfo2, float env, float env2,
        float velocity, float keytrack, float modWheel,
        const std::array<float, 8>& macroValues, float scale) noexcept
    {
        return targetOffset(target, rawLfo, rawLfo2, std::array<float, 8> {}, env, env2, 0.0f, 0.0f,
            velocity, keytrack, modWheel, 0.0f, 0.0f, macroValues, scale);
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
        flags.oscCPan = targetActive(modulation.oscCPan);
        flags.oscAFine = targetActive(modulation.oscAFine);
        flags.oscBFine = targetActive(modulation.oscBFine);
        flags.oscCFine = targetActive(modulation.oscCFine);
        flags.oscAPosition = targetActive(modulation.oscAPosition);
        flags.oscBPosition = targetActive(modulation.oscBPosition);
        flags.oscCPosition = targetActive(modulation.oscCPosition);
        flags.oscALevel = targetActive(modulation.oscALevel);
        flags.oscBLevel = targetActive(modulation.oscBLevel);
        flags.oscCLevel = targetActive(modulation.oscCLevel);
        flags.oscAUnisonDetune = targetActive(modulation.oscAUnisonDetune);
        flags.oscAUnisonSpread = targetActive(modulation.oscAUnisonSpread);
        flags.oscBUnisonDetune = targetActive(modulation.oscBUnisonDetune);
        flags.oscBUnisonSpread = targetActive(modulation.oscBUnisonSpread);
        flags.oscCUnisonDetune = targetActive(modulation.oscCUnisonDetune);
        flags.oscCUnisonSpread = targetActive(modulation.oscCUnisonSpread);
        flags.filterCutoff = targetActive(modulation.filterCutoff);
        flags.filterResonance = targetActive(modulation.filterResonance);
        flags.filterDrive = targetActive(modulation.filterDrive);
        flags.ampLevel = targetActive(modulation.ampLevel);
        flags.unisonDetune = targetActive(modulation.unisonDetune);
        flags.unisonSpread = targetActive(modulation.unisonSpread);
        for (size_t index = 0; index < flags.aurumOperatorLevel.size(); ++index)
        {
            flags.aurumOperatorLevel[index] = targetActive(modulation.aurumOperatorLevel[index]);
            flags.aurumOperatorPan[index] = targetActive(modulation.aurumOperatorPan[index]);
        }
        for (size_t index = 0; index < flags.aurumFilterCutoff.size(); ++index)
        {
            flags.aurumFilterCutoff[index] = targetActive(modulation.aurumFilterCutoff[index]);
            flags.aurumFilterResonance[index] = targetActive(modulation.aurumFilterResonance[index]);
            flags.aurumFilterDrive[index] = targetActive(modulation.aurumFilterDrive[index]);
        }
        addSourceActivity(flags, modulation.ampPan);
        addSourceActivity(flags, modulation.oscAPan);
        addSourceActivity(flags, modulation.oscBPan);
        addSourceActivity(flags, modulation.oscCPan);
        addSourceActivity(flags, modulation.oscAFine);
        addSourceActivity(flags, modulation.oscBFine);
        addSourceActivity(flags, modulation.oscCFine);
        addSourceActivity(flags, modulation.oscAPosition);
        addSourceActivity(flags, modulation.oscBPosition);
        addSourceActivity(flags, modulation.oscCPosition);
        addSourceActivity(flags, modulation.oscALevel);
        addSourceActivity(flags, modulation.oscBLevel);
        addSourceActivity(flags, modulation.oscCLevel);
        addSourceActivity(flags, modulation.oscAUnisonDetune);
        addSourceActivity(flags, modulation.oscAUnisonSpread);
        addSourceActivity(flags, modulation.oscBUnisonDetune);
        addSourceActivity(flags, modulation.oscBUnisonSpread);
        addSourceActivity(flags, modulation.oscCUnisonDetune);
        addSourceActivity(flags, modulation.oscCUnisonSpread);
        addSourceActivity(flags, modulation.filterCutoff);
        addSourceActivity(flags, modulation.filterResonance);
        addSourceActivity(flags, modulation.filterDrive);
        addSourceActivity(flags, modulation.ampLevel);
        addSourceActivity(flags, modulation.unisonDetune);
        addSourceActivity(flags, modulation.unisonSpread);
        for (size_t index = 0; index < flags.aurumOperatorLevel.size(); ++index)
        {
            addSourceActivity(flags, modulation.aurumOperatorLevel[index]);
            addSourceActivity(flags, modulation.aurumOperatorPan[index]);
        }
        for (size_t index = 0; index < flags.aurumFilterCutoff.size(); ++index)
        {
            addSourceActivity(flags, modulation.aurumFilterCutoff[index]);
            addSourceActivity(flags, modulation.aurumFilterResonance[index]);
            addSourceActivity(flags, modulation.aurumFilterDrive[index]);
        }
        flags.any =
            flags.ampPan
            || flags.oscAPan
            || flags.oscBPan
            || flags.oscCPan
            || flags.oscAFine
            || flags.oscBFine
            || flags.oscCFine
            || flags.oscAPosition
            || flags.oscBPosition
            || flags.oscCPosition
            || flags.oscALevel
            || flags.oscBLevel
            || flags.oscCLevel
            || flags.oscAUnisonDetune
            || flags.oscAUnisonSpread
            || flags.oscBUnisonDetune
            || flags.oscBUnisonSpread
            || flags.oscCUnisonDetune
            || flags.oscCUnisonSpread
            || flags.filterCutoff
            || flags.filterResonance
            || flags.filterDrive
            || flags.ampLevel
            || flags.unisonDetune
            || flags.unisonSpread
            || std::any_of(flags.aurumOperatorLevel.begin(), flags.aurumOperatorLevel.end(), [](bool active) { return active; })
            || std::any_of(flags.aurumOperatorPan.begin(), flags.aurumOperatorPan.end(), [](bool active) { return active; })
            || std::any_of(flags.aurumFilterCutoff.begin(), flags.aurumFilterCutoff.end(), [](bool active) { return active; })
            || std::any_of(flags.aurumFilterResonance.begin(), flags.aurumFilterResonance.end(), [](bool active) { return active; })
            || std::any_of(flags.aurumFilterDrive.begin(), flags.aurumFilterDrive.end(), [](bool active) { return active; });
        return flags;
    }

    inline bool hasFilterCoefficientMod(const TargetActivityFlags& flags) noexcept
    {
        return flags.filterCutoff
            || flags.filterResonance
            || std::any_of(flags.aurumFilterCutoff.begin(), flags.aurumFilterCutoff.end(), [](bool active) { return active; })
            || std::any_of(flags.aurumFilterResonance.begin(), flags.aurumFilterResonance.end(), [](bool active) { return active; });
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
        for (size_t index = 0; index < plan.needsExtraLfoValue.size(); ++index)
            plan.needsExtraLfoValue[index] = plan.useDynamicModulation && flags.extraLfo[index];
        plan.needsEnv2Value = plan.useDynamicModulation && flags.env2;
        plan.needsEnv3Value = plan.useDynamicModulation && flags.env3;
        plan.needsEnv4Value = plan.useDynamicModulation && flags.env4;
        plan.hasAmpPanMod = flags.ampPan;
        return plan;
    }
}
