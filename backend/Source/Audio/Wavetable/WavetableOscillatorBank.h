#pragma once

#include "WavetableOscillator.h"
#include "WavetableUnisonPlan.h"
#include "../Oscillator/VoiceMath.h"

#include <juce_core/juce_core.h>

#include <array>
#include <cmath>
#include <cstdint>

namespace beat::WavetableOscillatorBank
{
    using Bank = std::array<WavetableOscillator, 8>;

    struct RenderResult
    {
        float sample { 0.0f };
        int64_t voiceSamples { 0 };
        int64_t frequencyUpdates { 0 };
        int64_t positionUpdates { 0 };
    };

    struct StereoRenderResult
    {
        float left { 0.0f };
        float right { 0.0f };
        int64_t voiceSamples { 0 };
        int64_t frequencyUpdates { 0 };
        int64_t positionUpdates { 0 };
    };

    template <typename Config>
    inline void configure(
        Bank& oscillators,
        const Wavetable* table,
        const Config& config,
        double sampleRate,
        double frequencyHz) noexcept
    {
        const int unison = juce::jlimit(1, 8, config.unison);
        const float detuneCents = juce::jlimit(0.0f, 100.0f, config.detuneCents);
        const float blend = VoiceMath::clamp01(config.blend);
        const float position = VoiceMath::clamp01(config.position);

        for (int voice = 0; voice < (int) oscillators.size(); ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const float centered = unison == 1
                ? 0.0f
                : ((float) voice / (float) (unison - 1)) * 2.0f - 1.0f;
            const double rate = std::exp2((centered * detuneCents) / 1200.0);
            osc.prepare(sampleRate);
            osc.setWavetable(table);
            osc.setPosition(position);
            osc.setFrequency(frequencyHz * rate);
            osc.reset((double) voice * 0.071 * (double) blend + (double) centered * 0.00008 * (double) blend);
        }
    }

    inline void clear(Bank& oscillators, WavetableUnison::Plan& plan) noexcept
    {
        for (auto& osc : oscillators)
            osc.setWavetable(nullptr);
        WavetableUnison::invalidate(plan);
    }

    template <typename Config>
    inline RenderResult render(
        Bank& oscillators,
        WavetableUnison::Plan& plan,
        const Config& config,
        double frequencyHz,
        double fallbackFrequencyHz,
        double sampleRate,
        float positionMod,
        float detuneCentsMod,
        float spreadMod) noexcept
    {
        if (!std::isfinite(frequencyHz) || frequencyHz <= 0.0)
            frequencyHz = fallbackFrequencyHz;

        auto& renderPlan = WavetableUnison::update(plan, config.unison, config.detuneCents, config.blend, detuneCentsMod, spreadMod);
        const float modulatedPosition = VoiceMath::quantizeWavetablePosition(config.position + positionMod);
        RenderResult result;
        result.voiceSamples = renderPlan.unison;

        for (int voice = 0; voice < renderPlan.unison; ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const auto index = (size_t) voice;
            const double phaseDriftHz = (double) renderPlan.phaseSpread[index] * sampleRate;
            const double nextFrequencyHz = VoiceMath::quantizeWavetableFrequency(frequencyHz * renderPlan.rates[index] + phaseDriftHz);
            if (std::abs(nextFrequencyHz - renderPlan.appliedFrequencyHz[index]) > 0.000001)
            {
                osc.setFrequency(nextFrequencyHz);
                renderPlan.appliedFrequencyHz[index] = nextFrequencyHz;
                ++result.frequencyUpdates;
            }

            if (std::abs(modulatedPosition - renderPlan.appliedPosition[index]) > 0.000001f)
            {
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++result.positionUpdates;
            }
            result.sample += osc.renderSample() * renderPlan.weights[(size_t) voice];
        }

        result.sample = juce::jlimit(-1.0f, 1.0f, result.sample / juce::jmax(1.0f, renderPlan.weightSum));
        return result;
    }

    template <typename Config>
    inline StereoRenderResult renderStereo(
        Bank& oscillators,
        WavetableUnison::Plan& plan,
        const Config& config,
        double frequencyHz,
        double fallbackFrequencyHz,
        double sampleRate,
        float positionMod,
        float detuneCentsMod,
        float spreadMod,
        float basePan) noexcept
    {
        if (!std::isfinite(frequencyHz) || frequencyHz <= 0.0)
            frequencyHz = fallbackFrequencyHz;

        auto& renderPlan = WavetableUnison::update(plan, config.unison, config.detuneCents, config.blend, detuneCentsMod, spreadMod);
        const float modulatedPosition = VoiceMath::quantizeWavetablePosition(config.position + positionMod);
        const float quantizedBasePan = std::round(juce::jlimit(-1.0f, 1.0f, basePan) * 512.0f) / 512.0f;
        if (std::abs(renderPlan.appliedBasePan - quantizedBasePan) > 0.0001f)
        {
            for (int voice = 0; voice < renderPlan.unison; ++voice)
            {
                const auto index = (size_t) voice;
                const float voicePan = juce::jlimit(-1.0f, 1.0f, quantizedBasePan + renderPlan.centered[index] * renderPlan.spread);
                const auto [leftGain, rightGain] = VoiceMath::equalPowerPanGains(voicePan);
                renderPlan.leftGains[index] = leftGain;
                renderPlan.rightGains[index] = rightGain;
            }
            renderPlan.appliedBasePan = quantizedBasePan;
        }
        StereoRenderResult result;
        result.voiceSamples = renderPlan.unison;

        for (int voice = 0; voice < renderPlan.unison; ++voice)
        {
            auto& osc = oscillators[(size_t) voice];
            const auto index = (size_t) voice;
            const double phaseDriftHz = (double) renderPlan.phaseSpread[index] * sampleRate;
            const double nextFrequencyHz = VoiceMath::quantizeWavetableFrequency(frequencyHz * renderPlan.rates[index] + phaseDriftHz);
            if (std::abs(nextFrequencyHz - renderPlan.appliedFrequencyHz[index]) > 0.000001)
            {
                osc.setFrequency(nextFrequencyHz);
                renderPlan.appliedFrequencyHz[index] = nextFrequencyHz;
                ++result.frequencyUpdates;
            }

            if (std::abs(modulatedPosition - renderPlan.appliedPosition[index]) > 0.000001f)
            {
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++result.positionUpdates;
            }

            const float sample = osc.renderSample() * renderPlan.weights[index];
            result.left += sample * renderPlan.leftGains[index];
            result.right += sample * renderPlan.rightGains[index];
        }

        const float normalizer = juce::jmax(1.0f, renderPlan.weightSum);
        result.left = juce::jlimit(-1.0f, 1.0f, result.left / normalizer);
        result.right = juce::jlimit(-1.0f, 1.0f, result.right / normalizer);
        return result;
    }
}
