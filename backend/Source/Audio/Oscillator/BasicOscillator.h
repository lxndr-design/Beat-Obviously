#pragma once

#include <juce_core/juce_core.h>

#include <cmath>

namespace beat::BasicOscillator
{
    inline float polyBlep(double phase, double phaseDelta) noexcept
    {
        const auto dt = juce::jlimit(1.0e-9, 0.5, std::abs(phaseDelta));
        if (phase < dt)
        {
            const auto t = phase / dt;
            return (float) (t + t - t * t - 1.0);
        }
        if (phase > 1.0 - dt)
        {
            const auto t = (phase - 1.0) / dt;
            return (float) (t * t + t + t + 1.0);
        }
        return 0.0f;
    }

    inline float sample(int waveform, double phase, double phaseDelta) noexcept
    {
        const float p = (float) (phase - std::floor(phase));
        switch (waveform)
        {
            case 0:
                return std::sin(p * juce::MathConstants<float>::twoPi);
            case 1:
            {
                auto value = 2.0f * p - 1.0f;
                value -= polyBlep(p, phaseDelta);
                return value;
            }
            case 2:
            {
                auto value = p < 0.5f ? 1.0f : -1.0f;
                value += polyBlep(p, phaseDelta);
                auto shifted = p + 0.5f;
                if (shifted >= 1.0f)
                    shifted -= 1.0f;
                value -= polyBlep(shifted, phaseDelta);
                return value;
            }
            case 3:
                return 4.0f * std::abs(p - 0.5f) - 1.0f;
            default:
                return juce::Random::getSystemRandom().nextFloat() * 2.0f - 1.0f;
        }
    }
}
