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

    inline double syncedDivisionBeats(const juce::String& division) noexcept
    {
        const auto trimmed = division.trim();
        const bool dotted = trimmed.endsWithIgnoreCase("d");
        const bool triplet = trimmed.endsWithIgnoreCase("t");
        auto core = trimmed;
        if (dotted || triplet)
            core = core.dropLastCharacters(1);
        const auto slash = core.indexOfChar('/');
        if (slash <= 0 || slash >= core.length() - 1)
            return 1.0;
        const double numerator = core.substring(0, slash).getDoubleValue();
        const double denominator = core.substring(slash + 1).getDoubleValue();
        if (!std::isfinite(numerator) || !std::isfinite(denominator) || numerator <= 0.0 || denominator <= 0.0)
            return 1.0;
        double beats = (numerator / denominator) * 4.0;
        if (dotted)
            beats *= 1.5;
        else if (triplet)
            beats *= 2.0 / 3.0;
        return juce::jlimit(1.0 / 64.0, 64.0, beats);
    }

    inline float effectiveRateHz(float rateHz, bool sync, const juce::String& division, double bpm) noexcept
    {
        if (!sync)
            return juce::jlimit(0.01f, 50.0f, rateHz);
        const double cyclesPerSecond = (juce::jmax(1.0, bpm) / 60.0) / syncedDivisionBeats(division);
        return juce::jlimit(0.01f, 50.0f, (float) cyclesPerSecond);
    }
}
