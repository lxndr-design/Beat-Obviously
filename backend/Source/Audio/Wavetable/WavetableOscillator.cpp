#include "WavetableOscillator.h"

#include <cmath>

namespace beat
{
    namespace
    {
        constexpr int generatedMaxHarmonics = 64;

        double wrap01(double value) noexcept
        {
            if (!std::isfinite(value))
                return 0.0;

            value -= std::floor(value);
            return value < 0.0 ? value + 1.0 : value;
        }
    }

    void WavetableOscillator::prepare(double newSampleRate) noexcept
    {
        sampleRate = std::isfinite(newSampleRate) && newSampleRate > 0.0 ? newSampleRate : 44100.0;
        frequencyHz = juce::jlimit(0.0, sampleRate * 0.49, frequencyHz);
        phaseDelta = frequencyHz / sampleRate;
        markFrameCacheDirty();
    }

    void WavetableOscillator::reset(double newPhase) noexcept
    {
        setPhase(newPhase);
    }

    void WavetableOscillator::setWavetable(const Wavetable* newTable) noexcept
    {
        table = newTable != nullptr && newTable->isValid() ? newTable : nullptr;
        markFrameCacheDirty();
    }

    void WavetableOscillator::setFrequency(double newFrequencyHz) noexcept
    {
        const double nextFrequency = std::isfinite(newFrequencyHz) ? juce::jlimit(0.0, sampleRate * 0.49, newFrequencyHz) : 0.0;
        if (std::abs(nextFrequency - frequencyHz) < 0.000001)
            return;

        frequencyHz = nextFrequency;
        phaseDelta = sampleRate > 0.0 ? frequencyHz / sampleRate : 0.0;
        markFrameCacheDirty();
    }

    void WavetableOscillator::setPosition(float newPosition) noexcept
    {
        const float nextPosition = std::isfinite(newPosition) ? juce::jlimit(0.0f, 1.0f, newPosition) : 0.0f;
        if (std::abs(nextPosition - position) < 0.000001f)
            return;

        position = nextPosition;
        markFrameCacheDirty();
    }

    void WavetableOscillator::setPhase(double newPhase) noexcept
    {
        phase = wrap01(newPhase);
    }

    float WavetableOscillator::renderSample() noexcept
    {
        const float sample = readCurrentSample();

        phase += phaseDelta;
        if (phase >= 1.0)
            phase -= 1.0;

        return std::isfinite(sample) ? juce::jlimit(-1.0f, 1.0f, sample) : 0.0f;
    }

    void WavetableOscillator::updateFrameCache() noexcept
    {
        frameCacheDirty = false;
        cachedFrameSize = 0;
        cachedFrame0Data = nullptr;
        cachedFrame1Data = nullptr;
        cachedFrameFrac = 0.0f;

        if (table == nullptr)
            return;

        const int frameCount = table->getFrameCount();
        const int frameSize = table->getFrameSize();
        if (frameCount <= 0 || frameSize <= 1)
            return;

        float playbackPosition = position;
        const int maxTableHarmonic = juce::jmax(1, juce::jmin(generatedMaxHarmonics, frameSize / 2 - 1));
        if (maxTableHarmonic > 1 && frequencyHz > 0.0 && sampleRate > 0.0)
        {
            const int maxPlaybackHarmonic = juce::jmax(1, (int) std::floor((sampleRate * 0.48) / juce::jmax(20.0, frequencyHz)));
            const float harmonicPosition = (float) (maxPlaybackHarmonic - 1) / (float) (maxTableHarmonic - 1);
            playbackPosition = juce::jmin(playbackPosition, juce::jlimit(0.0f, 1.0f, harmonicPosition));
        }

        const float framePos = playbackPosition * (float) (frameCount - 1);
        const int frame0 = juce::jlimit(0, frameCount - 1, (int) std::floor(framePos));
        const int frame1 = juce::jmin(frame0 + 1, frameCount - 1);
        const float frameFrac = framePos - (float) frame0;

        cachedFrameSize = frameSize;
        cachedFrame0Data = table->getFrameData(frame0);
        cachedFrame1Data = table->getFrameData(frame1);
        cachedFrameFrac = frameFrac;
    }

    float WavetableOscillator::readCurrentSample() noexcept
    {
        if (frameCacheDirty)
            updateFrameCache();

        if (cachedFrameSize <= 1 || cachedFrame0Data == nullptr || cachedFrame1Data == nullptr)
            return 0.0f;

        const double samplePos = phase * (double) cachedFrameSize;
        const int index0 = (int) samplePos;
        const int index1 = index0 + 1 == cachedFrameSize ? 0 : index0 + 1;
        const float sampleFrac = (float) (samplePos - (double) index0);

        const float a0 = cachedFrame0Data[(size_t) index0];
        const float a1 = cachedFrame0Data[(size_t) index1];
        const float b0 = cachedFrame1Data[(size_t) index0];
        const float b1 = cachedFrame1Data[(size_t) index1];

        const float frameASample = a0 + (a1 - a0) * sampleFrac;
        const float frameBSample = b0 + (b1 - b0) * sampleFrac;
        return frameASample + (frameBSample - frameASample) * cachedFrameFrac;
    }
}
