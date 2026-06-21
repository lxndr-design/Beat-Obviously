#pragma once

#include <juce_core/juce_core.h>

#include <cmath>
#include <cstdint>

namespace beat::EnvelopeShaper
{
    struct LoopConfig
    {
        float attackMs { 5.0f };
        float decayMs { 100.0f };
        float sustain { 0.7f };
        float releaseMs { 200.0f };
        int attackCurve { 0 };
        int decayCurve { 0 };
        int releaseCurve { 0 };
    };

    struct LoopState
    {
        int64_t sampleCounter { 0 };
        int64_t releaseSampleCounter { 0 };
        bool releasing { false };
        float releaseStartValue { 0.0f };

        void reset() noexcept
        {
            sampleCounter = 0;
            releaseSampleCounter = 0;
            releasing = false;
            releaseStartValue = 0.0f;
        }

        void beginRelease(float value) noexcept
        {
            releaseStartValue = juce::jlimit(0.0f, 1.0f, value);
            releaseSampleCounter = 0;
            releasing = true;
        }
    };

    struct LoopRenderResult
    {
        float value { 0.0f };
        bool releaseComplete { false };
    };

    inline float clamp01(float value) noexcept
    {
        return juce::jlimit(0.0f, 1.0f, value);
    }

    inline float applyCurve(float value, int curve) noexcept
    {
        const float x = clamp01(value);
        if (curve == 1) return x * x;
        if (curve == 2) return 1.0f - (1.0f - x) * (1.0f - x);
        if (curve == 3) return x * x * (3.0f - 2.0f * x);
        return x;
    }

    inline float shapeAdsrSample(
        float rawEnvelope,
        float& previousRawEnvelope,
        float sustainValue,
        int attackCurve,
        int decayCurve,
        int releaseCurve) noexcept
    {
        const float raw = clamp01(rawEnvelope);
        const float sustain = clamp01(sustainValue);
        float shaped = raw;
        if (std::abs(raw - previousRawEnvelope) < 0.00001f)
        {
            shaped = raw;
        }
        else if (raw > previousRawEnvelope)
        {
            shaped = applyCurve(raw, attackCurve);
        }
        else if (raw > sustain && sustain < 0.999f)
        {
            const float progress = (1.0f - raw) / juce::jmax(0.001f, 1.0f - sustain);
            shaped = 1.0f - applyCurve(progress, decayCurve) * (1.0f - sustain);
        }
        else if (sustain > 0.001f)
        {
            const float progress = 1.0f - raw / sustain;
            shaped = sustain * (1.0f - applyCurve(progress, releaseCurve));
        }
        previousRawEnvelope = raw;
        return clamp01(shaped);
    }

    inline LoopRenderResult renderLoop(LoopState& state, const LoopConfig& config, double sampleRate, float& previousRawEnvelope) noexcept
    {
        const double sr = juce::jmax(1.0, sampleRate);
        const double attackSeconds = juce::jmax(0.001, (double) config.attackMs * 0.001);
        const double decaySeconds = juce::jmax(0.001, (double) config.decayMs * 0.001);
        const double releaseSeconds = juce::jmax(0.001, (double) config.releaseMs * 0.001);
        const float sustain = clamp01(config.sustain);

        if (state.releasing)
        {
            const double releaseSamples = juce::jmax(1.0, releaseSeconds * sr);
            const float progress = (float) juce::jlimit(0.0, 1.0, (double) state.releaseSampleCounter / releaseSamples);
            ++state.releaseSampleCounter;
            const float raw = clamp01(state.releaseStartValue)
                * juce::jmax(0.0f, 1.0f - applyCurve(progress, config.releaseCurve));
            previousRawEnvelope = raw;
            return { raw, progress >= 1.0f };
        }

        const double cycleSeconds = attackSeconds + decaySeconds;
        const double timeSeconds = (double) state.sampleCounter / sr;
        ++state.sampleCounter;
        const double localSeconds = std::fmod(timeSeconds, cycleSeconds);
        float raw = 0.0f;
        if (localSeconds < attackSeconds)
        {
            raw = applyCurve((float) (localSeconds / attackSeconds), config.attackCurve);
        }
        else
        {
            const float progress = applyCurve((float) ((localSeconds - attackSeconds) / decaySeconds), config.decayCurve);
            raw = 1.0f + (sustain - 1.0f) * progress;
        }
        previousRawEnvelope = raw;
        return { clamp01(raw), false };
    }
}
