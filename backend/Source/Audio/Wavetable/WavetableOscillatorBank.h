#pragma once

#include "WavetableOscillator.h"
#include "WavetableUnisonPlan.h"
#include "../Oscillator/VoiceMath.h"

#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

#include <array>
#include <cmath>
#include <cstdint>

namespace beat::WavetableOscillatorBank
{
    using Bank = std::array<WavetableOscillator, WavetableUnison::capacity>;

    struct RenderResult
    {
        float sample { 0.0f };
        int64_t voiceSamples { 0 };
        int64_t frequencyUpdates { 0 };
        int64_t positionUpdates { 0 };
        int64_t simdVoiceSamples { 0 };
    };

    struct StereoRenderResult
    {
        float left { 0.0f };
        float right { 0.0f };
        int64_t voiceSamples { 0 };
        int64_t frequencyUpdates { 0 };
        int64_t positionUpdates { 0 };
        int64_t simdVoiceSamples { 0 };
    };

    template <typename Config>
    inline void configure(
        Bank& oscillators,
        const Wavetable* table,
        const Config& config,
        double sampleRate,
        double frequencyHz) noexcept
    {
        const int unison = juce::jlimit(1, WavetableUnison::maxVoices, config.unison);
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

    template <bool useSimdUnison = false, typename Config>
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
        const bool updateFrequency = std::abs(renderPlan.requestedFrequencyHz - frequencyHz) > 0.000001
            || std::abs(renderPlan.requestedSampleRate - sampleRate) > 0.000001;
        const bool updatePosition = std::abs(renderPlan.requestedPosition - modulatedPosition) > 0.000001f;
        RenderResult result;
        result.voiceSamples = renderPlan.unison;

        if (updateFrequency)
        {
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
            }
        }
        if (updatePosition)
        {
            for (int voice = 0; voice < renderPlan.unison; ++voice)
            {
                auto& osc = oscillators[(size_t) voice];
                const auto index = (size_t) voice;
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++result.positionUpdates;
            }
        }

        if constexpr (useSimdUnison)
        {
            if (renderPlan.unison == WavetableUnison::maxVoices && WavetableUnison::simdWidth > 1)
            {
                using Simd = WavetableUnison::SimdFloat;
                constexpr int width = WavetableUnison::simdWidth;
                alignas(64) std::array<float, WavetableUnison::capacity> samples;
               #if defined(__clang__)
                #pragma clang loop unroll(full)
               #endif
                for (int voice = 0; voice < WavetableUnison::maxVoices; ++voice)
                    samples[(size_t) voice] = oscillators[(size_t) voice].renderSample();
                Simd sum { 0.0f };
                for (int voice = 0; voice < WavetableUnison::maxVoices; voice += width)
                    sum += Simd::fromRawArray(samples.data() + voice)
                        * renderPlan.simdWeights[(size_t) (voice / width)];
                result.sample = sum.sum();
                result.simdVoiceSamples = WavetableUnison::maxVoices;
            }
            else
            {
                for (int voice = 0; voice < renderPlan.unison; ++voice)
                    result.sample += oscillators[(size_t) voice].renderSample() * renderPlan.weights[(size_t) voice];
            }
        }
        else
        {
            for (int voice = 0; voice < renderPlan.unison; ++voice)
                result.sample += oscillators[(size_t) voice].renderSample() * renderPlan.weights[(size_t) voice];
        }

        renderPlan.requestedFrequencyHz = frequencyHz;
        renderPlan.requestedSampleRate = sampleRate;
        renderPlan.requestedPosition = modulatedPosition;

        result.sample = juce::jlimit(-1.0f, 1.0f, result.sample / juce::jmax(1.0f, renderPlan.weightSum));
        return result;
    }

    template <bool useSimdUnison = false, typename Config>
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
        const bool updateFrequency = std::abs(renderPlan.requestedFrequencyHz - frequencyHz) > 0.000001
            || std::abs(renderPlan.requestedSampleRate - sampleRate) > 0.000001;
        const bool updatePosition = std::abs(renderPlan.requestedPosition - modulatedPosition) > 0.000001f;
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
            WavetableUnison::refreshSimdStereoGains(renderPlan);
        }
        StereoRenderResult result;
        result.voiceSamples = renderPlan.unison;

        if (updateFrequency)
        {
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
            }
        }
        if (updatePosition)
        {
            for (int voice = 0; voice < renderPlan.unison; ++voice)
            {
                auto& osc = oscillators[(size_t) voice];
                const auto index = (size_t) voice;
                osc.setPosition(modulatedPosition);
                renderPlan.appliedPosition[index] = modulatedPosition;
                ++result.positionUpdates;
            }
        }

        if constexpr (useSimdUnison)
        {
            if (renderPlan.unison == WavetableUnison::maxVoices && WavetableUnison::simdWidth > 1)
            {
                using Simd = WavetableUnison::SimdFloat;
                constexpr int width = WavetableUnison::simdWidth;
                alignas(64) std::array<float, WavetableUnison::capacity> samples;
               #if defined(__clang__)
                #pragma clang loop unroll(full)
               #endif
                for (int voice = 0; voice < WavetableUnison::maxVoices; ++voice)
                    samples[(size_t) voice] = oscillators[(size_t) voice].renderSample();
                Simd leftSum { 0.0f };
                Simd rightSum { 0.0f };
                for (int voice = 0; voice < WavetableUnison::maxVoices; voice += width)
                {
                    const auto samplesVector = Simd::fromRawArray(samples.data() + voice);
                    const auto group = (size_t) (voice / width);
                    leftSum += samplesVector * renderPlan.simdWeightedLeftGains[group];
                    rightSum += samplesVector * renderPlan.simdWeightedRightGains[group];
                }
                result.left = leftSum.sum();
                result.right = rightSum.sum();
                result.simdVoiceSamples = WavetableUnison::maxVoices;
            }
            else
            {
                for (int voice = 0; voice < renderPlan.unison; ++voice)
                {
                    const auto index = (size_t) voice;
                    const float sample = oscillators[index].renderSample() * renderPlan.weights[index];
                    result.left += sample * renderPlan.leftGains[index];
                    result.right += sample * renderPlan.rightGains[index];
                }
            }
        }
        else
        {
            for (int voice = 0; voice < renderPlan.unison; ++voice)
            {
                const auto index = (size_t) voice;
                const float sample = oscillators[index].renderSample() * renderPlan.weights[index];
                result.left += sample * renderPlan.leftGains[index];
                result.right += sample * renderPlan.rightGains[index];
            }
        }

        renderPlan.requestedFrequencyHz = frequencyHz;
        renderPlan.requestedSampleRate = sampleRate;
        renderPlan.requestedPosition = modulatedPosition;

        const float normalizer = juce::jmax(1.0f, renderPlan.weightSum);
        result.left = juce::jlimit(-1.0f, 1.0f, result.left / normalizer);
        result.right = juce::jlimit(-1.0f, 1.0f, result.right / normalizer);
        return result;
    }
}
