#pragma once

#include <juce_core/juce_core.h>

#include <cmath>

namespace beat
{
    struct VoiceTransition
    {
        struct Stereo
        {
            float left { 0.0f };
            float right { 0.0f };
        };

        void prepare(double sampleRate) noexcept
        {
            const double validRate = std::isfinite(sampleRate) && sampleRate > 0.0 ? sampleRate : 44100.0;
            lengthSamples = juce::jlimit(8, 256, (int) std::round(validRate * 0.0015));
        }

        void beginFrom(Stereo previous) noexcept
        {
            source = previous;
            cursor = 0;
            active = std::abs(source.left) > 1.0e-7f || std::abs(source.right) > 1.0e-7f;
        }

        Stereo process(Stereo next) noexcept
        {
            if (!active)
                return next;

            const float mix = (float) cursor / (float) juce::jmax(1, lengthSamples);
            const float oldGain = 1.0f - mix;
            Stereo output {
                source.left * oldGain + next.left * mix,
                source.right * oldGain + next.right * mix
            };
            ++cursor;
            if (cursor > lengthSamples)
                active = false;
            return output;
        }

        void reset() noexcept
        {
            source = {};
            cursor = 0;
            active = false;
        }

        bool isActive() const noexcept { return active; }
        int getLengthSamples() const noexcept { return lengthSamples; }

    private:
        Stereo source;
        int lengthSamples { 66 };
        int cursor { 0 };
        bool active { false };
    };
}
