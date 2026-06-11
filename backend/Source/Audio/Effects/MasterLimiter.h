#pragma once

#include <juce_dsp/juce_dsp.h>

namespace beat
{
    /**
     * MasterLimiter — final safety stage before metering/playback/export.
     *
     * This is intentionally conservative: instant peak clamp when a sample
     * crosses the ceiling, then a short release back to unity. It avoids
     * allocations, lookahead latency, and divergent live/export behavior.
     */
    class MasterLimiter
    {
    public:
        void prepare(double sampleRate, int blockSize, int numChannels) noexcept;
        void reset() noexcept;
        void setCeilingDb(float db) noexcept;
        void setReleaseMs(float ms) noexcept;
        void process(juce::AudioBuffer<float>& buffer) noexcept;

    private:
        double sampleRate { 44100.0 };
        float ceilingGain { 0.98f };
        float releaseMs { 35.0f };
        float gain { 1.0f };
    };
}
