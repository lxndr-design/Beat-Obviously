#pragma once

#include "../AudioQuality.h"

#include <algorithm>
#include <array>
#include <cmath>
#include <utility>

namespace beat::AetherInteractionStage
{
    inline constexpr int liveOversampleFactor = 2;
    inline constexpr int offlineOversampleFactor = 2;
    inline constexpr int filterSections = 3;

    struct Biquad
    {
        float b0 { 1.0f };
        float b1 { 0.0f };
        float b2 { 0.0f };
        float a1 { 0.0f };
        float a2 { 0.0f };
        float x1 { 0.0f };
        float x2 { 0.0f };
        float y1 { 0.0f };
        float y2 { 0.0f };

        void configureLowpass(double sampleRate, double cutoffHz, double q) noexcept
        {
            const double safeRate = std::isfinite(sampleRate) && sampleRate > 0.0 ? sampleRate : 88200.0;
            const double safeCutoff = std::isfinite(cutoffHz)
                ? std::clamp(cutoffHz, 20.0, safeRate * 0.245)
                : 18000.0;
            const double omega = 2.0 * 3.14159265358979323846 * safeCutoff / safeRate;
            const double cosine = std::cos(omega);
            const double alpha = std::sin(omega) / (2.0 * q);
            const double a0 = 1.0 + alpha;
            b0 = (float) (((1.0 - cosine) * 0.5) / a0);
            b1 = (float) ((1.0 - cosine) / a0);
            b2 = b0;
            a1 = (float) ((-2.0 * cosine) / a0);
            a2 = (float) ((1.0 - alpha) / a0);
        }

        void reset(float value = 0.0f) noexcept
        {
            x1 = x2 = y1 = y2 = std::isfinite(value) ? value : 0.0f;
        }

        float process(float input) noexcept
        {
            const float safeInput = std::isfinite(input) ? input : 0.0f;
            const float output = b0 * safeInput + b1 * x1 + b2 * x2 - a1 * y1 - a2 * y2;
            x2 = x1;
            x1 = safeInput;
            y2 = y1;
            y1 = std::isfinite(output) ? output : 0.0f;
            return y1;
        }
    };

    struct State
    {
        std::array<Biquad, filterSections> filters;
        int factor { liveOversampleFactor };

        void prepare(double baseSampleRate, AudioQuality quality) noexcept
        {
            factor = quality == AudioQuality::offlineHighQuality
                ? offlineOversampleFactor
                : liveOversampleFactor;
            const double safeBaseRate = std::isfinite(baseSampleRate) && baseSampleRate > 0.0
                ? baseSampleRate
                : 44100.0;
            const double oversampledRate = safeBaseRate * (double) factor;
            const double cutoff = std::min(18000.0, safeBaseRate * 0.42);
            constexpr std::array<double, filterSections> butterworthQ {
                0.5176380902050415,
                0.7071067811865476,
                1.9318516525781366,
            };
            for (size_t section = 0; section < filters.size(); ++section)
                filters[section].configureLowpass(oversampledRate, cutoff, butterworthQ[section]);
        }

        void reset(float value = 0.0f) noexcept
        {
            for (auto& filter : filters)
                filter.reset(value);
        }

        template <typename SourceProvider>
        float process(int mode, SourceProvider&& sourceAtSubsample) noexcept
        {
            float output = 0.0f;
            for (int subsample = 0; subsample < factor; ++subsample)
            {
                const auto [carrier, modulator] = sourceAtSubsample(subsample, factor);
                float interacted = mode == 1
                    ? carrier * (0.5f + 0.5f * modulator)
                    : carrier * modulator;
                if (!std::isfinite(interacted))
                    interacted = 0.0f;
                output = interacted;
                for (auto& filter : filters)
                    output = filter.process(output);
            }
            return std::isfinite(output) ? output : 0.0f;
        }
    };
}
