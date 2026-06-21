#pragma once

#include <juce_core/juce_core.h>

#include <cmath>

namespace beat::Lfo
{
    inline float value(int waveform, double phase, float smoothing = 0.0f, bool oneShot = false) noexcept
    {
        const float p = oneShot ? juce::jlimit(0.0f, 1.0f, (float) phase) : (float) (phase - std::floor(phase));
        const float sine = std::sin(p * juce::MathConstants<float>::twoPi);
        float shaped;
        switch (waveform)
        {
            case 1: shaped = p < 0.5f ? p * 4.0f - 1.0f : 3.0f - p * 4.0f; break;
            case 2: shaped = p * 2.0f - 1.0f; break;
            case 3: shaped = p < 0.5f ? 1.0f : -1.0f; break;
            case 0:
            default: return sine;
        }
        const float mix = juce::jlimit(0.0f, 1.0f, smoothing);
        return shaped + (sine - shaped) * mix;
    }

    inline float routeValue(float raw, bool bipolar) noexcept
    {
        return bipolar ? raw : (raw + 1.0f) * 0.5f;
    }
}
