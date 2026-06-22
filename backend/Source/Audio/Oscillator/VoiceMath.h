#pragma once

#include <juce_core/juce_core.h>

#include <cmath>
#include <utility>

namespace beat::VoiceMath
{
    inline constexpr std::pair<float, float> centerPanGains { 0.70710678f, 0.70710678f };

    inline float clamp01(float value) noexcept
    {
        return juce::jlimit(0.0f, 1.0f, value);
    }

    inline float pitchWheelRatio(int value) noexcept
    {
        const auto clamped = juce::jlimit(0, 16383, value);
        if (clamped >= 8192)
            return (float) (clamped - 8192) / 8191.0f;
        return (float) (clamped - 8192) / 8192.0f;
    }

    inline double deterministicPhaseJitter(juce::uint32 seed) noexcept
    {
        seed ^= seed >> 16;
        seed *= 0x7feb352du;
        seed ^= seed >> 15;
        seed *= 0x846ca68bu;
        seed ^= seed >> 16;
        return (double) (seed & 0x00ffffffu) / (double) 0x01000000u;
    }

    inline std::pair<float, float> equalPowerPanGains(float pan) noexcept
    {
        const float normalized = (juce::jlimit(-1.0f, 1.0f, pan) + 1.0f) * 0.5f;
        const float angle = normalized * juce::MathConstants<float>::halfPi;
        return { std::cos(angle), std::sin(angle) };
    }

    inline float nextNoise(juce::uint32& state) noexcept
    {
        state = state * 1664525u + 1013904223u;
        return ((state >> 8) * (1.0f / 8388607.5f)) - 1.0f;
    }

    inline float denormalSafe(float value) noexcept
    {
        return std::abs(value) < 1.0e-20f ? 0.0f : value;
    }

    inline double pitchRate(int octave, int semitone, float fineCents) noexcept
    {
        return std::exp2(
            (double) octave
                + (double) semitone / 12.0
                + (double) fineCents / 1200.0);
    }

    inline float quantizeWavetablePosition(float position) noexcept
    {
        return std::round(clamp01(position) * 4096.0f) / 4096.0f;
    }

    inline double quantizeWavetableFrequency(double frequencyHz) noexcept
    {
        if (!std::isfinite(frequencyHz))
            return 0.0;

        constexpr double resolutionHz = 0.03125;
        return std::round(juce::jmax(0.0, frequencyHz) / resolutionHz) * resolutionHz;
    }
}
