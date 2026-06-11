#include "MasterLimiter.h"

#include <cmath>

namespace beat
{
    void MasterLimiter::prepare(double sr, int, int) noexcept
    {
        sampleRate = sr > 0.0 ? sr : 44100.0;
        reset();
    }

    void MasterLimiter::reset() noexcept
    {
        gain = 1.0f;
    }

    void MasterLimiter::setCeilingDb(float db) noexcept
    {
        ceilingGain = juce::jlimit(0.1f, 1.0f, juce::Decibels::decibelsToGain(db));
    }

    void MasterLimiter::setReleaseMs(float ms) noexcept
    {
        releaseMs = juce::jlimit(1.0f, 1000.0f, ms);
    }

    void MasterLimiter::process(juce::AudioBuffer<float>& buffer) noexcept
    {
        juce::ScopedNoDenormals noDenormals;
        if (buffer.getNumSamples() <= 0 || buffer.getNumChannels() <= 0)
            return;

        const float releaseCoeff = 1.0f - std::exp(-1.0f / juce::jmax(1.0f, releaseMs * 0.001f * (float) sampleRate));

        for (int i = 0; i < buffer.getNumSamples(); ++i)
        {
            float peak = 0.0f;
            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                const float sample = buffer.getSample(ch, i);
                peak = juce::jmax(peak, std::abs(std::isfinite(sample) ? sample : 0.0f));
            }

            const float targetGain = peak > ceilingGain && peak > 0.0f
                ? ceilingGain / peak
                : 1.0f;
            gain = targetGain < gain
                ? targetGain
                : gain + (1.0f - gain) * releaseCoeff;

            for (int ch = 0; ch < buffer.getNumChannels(); ++ch)
            {
                auto* samples = buffer.getWritePointer(ch);
                const float limited = (std::isfinite(samples[i]) ? samples[i] : 0.0f) * gain;
                samples[i] = std::abs(limited) < 1.0e-20f ? 0.0f : juce::jlimit(-ceilingGain, ceilingGain, limited);
            }
        }
    }
}
