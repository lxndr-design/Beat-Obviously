#pragma once

#include <juce_core/juce_core.h>
#include <juce_dsp/juce_dsp.h>

#include <cmath>

namespace beat::FilterMath
{
    inline float cutoffHz(float normalized, double sampleRate) noexcept
    {
        const float minF = 20.0f;
        const float maxF = juce::jmin(20000.0f, (float) sampleRate * 0.45f);
        const float clamped = juce::jlimit(0.0f, 1.0f, normalized);
        return minF * std::pow(maxF / minF, clamped);
    }

    inline float keytrackedCutoffHz(float normalized, double sampleRate, float keytrackAmount, double baseFrequencyHz) noexcept
    {
        constexpr float middleCHz = 261.625565f;
        const float base = cutoffHz(normalized, sampleRate);
        const float keytrack = juce::jlimit(0.0f, 1.0f, keytrackAmount);
        if (keytrack <= 0.0001f || baseFrequencyHz <= 0.0)
            return base;

        const float octaveOffset = (float) std::log2(juce::jmax(1.0, baseFrequencyHz) / (double) middleCHz);
        const float tracked = base * std::exp2(octaveOffset * keytrack);
        return juce::jlimit(20.0f, juce::jmin(20000.0f, (float) sampleRate * 0.45f), tracked);
    }

    inline float resonanceFromNormalized(float normalized) noexcept
    {
        return 0.5f + juce::jlimit(0.0f, 1.0f, normalized) * 4.0f;
    }

    inline juce::dsp::StateVariableTPTFilterType typeForParam(int type) noexcept
    {
        switch (type)
        {
            case 1: return juce::dsp::StateVariableTPTFilterType::bandpass;
            case 2: return juce::dsp::StateVariableTPTFilterType::highpass;
            case 0:
            default: return juce::dsp::StateVariableTPTFilterType::lowpass;
        }
    }
}
