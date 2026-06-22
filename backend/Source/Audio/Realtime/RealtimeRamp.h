#pragma once

#include <juce_core/juce_core.h>

namespace beat
{
    struct RealtimeRamp
    {
        float current { 0.0f };
        float target { 0.0f };
        float step { 0.0f };
        int remaining { 0 };

        void reset(float value) noexcept
        {
            current = value;
            target = value;
            step = 0.0f;
            remaining = 0;
        }

        void setTarget(float value, int rampSamples) noexcept
        {
            target = value;
            remaining = juce::jmax(0, rampSamples);
            if (remaining == 0)
            {
                reset(value);
                return;
            }
            step = (target - current) / (float) remaining;
        }

        float next() noexcept
        {
            if (remaining <= 0)
                return current;
            current += step;
            --remaining;
            if (remaining == 0)
                current = target;
            return current;
        }

        bool active() const noexcept { return remaining > 0; }
    };
}
