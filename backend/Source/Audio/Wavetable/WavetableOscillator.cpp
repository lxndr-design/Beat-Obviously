#include "WavetableOscillator.h"

#include <cmath>
#include <limits>

namespace beat
{
    namespace
    {
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
        cachedFrame0Mip0Data = nullptr;
        cachedFrame1Mip0Data = nullptr;
        cachedFrame0Mip1Data = nullptr;
        cachedFrame1Mip1Data = nullptr;
        cachedFrameFrac = 0.0f;
        cachedMipFrac = 0.0f;

        if (table == nullptr)
            return;

        const int frameCount = table->getFrameCount();
        const int frameSize = table->getFrameSize();
        if (frameCount <= 0 || frameSize <= 1)
            return;

        const float framePos = position * (float) (frameCount - 1);
        const int frame0 = juce::jlimit(0, frameCount - 1, (int) std::floor(framePos));
        const int frame1 = juce::jmin(frame0 + 1, frameCount - 1);

        int mip0 = 0;
        int mip1 = 0;
        float mipFrac = 0.0f;
        const int mipCount = table->getMipLevelCount();
        const double playbackLimit = frequencyHz > 0.0 && sampleRate > 0.0
            ? juce::jmax(1.0, (sampleRate * 0.48) / frequencyHz)
            : std::numeric_limits<double>::max();
        for (int mip = 0; mip + 1 < mipCount; ++mip)
        {
            const auto* current = table->getMipLevel(frame0, mip);
            const auto* next = table->getMipLevel(frame0, mip + 1);
            if (current == nullptr || next == nullptr)
                break;
            if (playbackLimit >= (double) current->maxHarmonic)
                break;

            mip0 = mip + 1;
            mip1 = mip0;
            if (playbackLimit > (double) next->maxHarmonic)
            {
                mip0 = mip;
                mip1 = mip + 1;
                const double logCurrent = std::log2((double) current->maxHarmonic);
                const double logNext = std::log2((double) next->maxHarmonic);
                const double logLimit = std::log2(playbackLimit);
                mipFrac = (float) juce::jlimit(0.0, 1.0, (logCurrent - logLimit) / (logCurrent - logNext));
                break;
            }
        }

        cachedFrameSize = frameSize;
        const auto* f0m0 = table->getMipLevel(frame0, mip0);
        const auto* f1m0 = table->getMipLevel(frame1, mip0);
        const auto* f0m1 = table->getMipLevel(frame0, mip1);
        const auto* f1m1 = table->getMipLevel(frame1, mip1);
        cachedFrame0Mip0Data = f0m0 != nullptr ? f0m0->samples.data() : nullptr;
        cachedFrame1Mip0Data = f1m0 != nullptr ? f1m0->samples.data() : nullptr;
        cachedFrame0Mip1Data = f0m1 != nullptr ? f0m1->samples.data() : nullptr;
        cachedFrame1Mip1Data = f1m1 != nullptr ? f1m1->samples.data() : nullptr;
        cachedFrameFrac = framePos - (float) frame0;
        cachedMipFrac = mipFrac;
    }

    float WavetableOscillator::readCurrentSample() noexcept
    {
        if (frameCacheDirty)
            updateFrameCache();

        if (cachedFrameSize <= 1 || cachedFrame0Mip0Data == nullptr || cachedFrame1Mip0Data == nullptr
            || cachedFrame0Mip1Data == nullptr || cachedFrame1Mip1Data == nullptr)
            return 0.0f;

        const double samplePos = phase * (double) cachedFrameSize;
        const int index0 = (int) samplePos;
        const int index1 = index0 + 1 == cachedFrameSize ? 0 : index0 + 1;
        const float sampleFrac = (float) (samplePos - (double) index0);

        const auto interpolate = [this, index0, index1, sampleFrac](const float* data) noexcept
        {
            if (quality == AudioQuality::offlineHighQuality)
            {
                const int previous = index0 == 0 ? cachedFrameSize - 1 : index0 - 1;
                const int next = index1 + 1 == cachedFrameSize ? 0 : index1 + 1;
                const float p0 = data[(size_t) previous];
                const float p1 = data[(size_t) index0];
                const float p2 = data[(size_t) index1];
                const float p3 = data[(size_t) next];
                const float t2 = sampleFrac * sampleFrac;
                const float t3 = t2 * sampleFrac;
                return 0.5f * ((2.0f * p1)
                    + (-p0 + p2) * sampleFrac
                    + (2.0f * p0 - 5.0f * p1 + 4.0f * p2 - p3) * t2
                    + (-p0 + 3.0f * p1 - 3.0f * p2 + p3) * t3);
            }
            return data[(size_t) index0] + (data[(size_t) index1] - data[(size_t) index0]) * sampleFrac;
        };
        const float mip0Frame0 = interpolate(cachedFrame0Mip0Data);
        const float mip0Frame1 = interpolate(cachedFrame1Mip0Data);
        const float mip1Frame0 = interpolate(cachedFrame0Mip1Data);
        const float mip1Frame1 = interpolate(cachedFrame1Mip1Data);
        const float mip0Sample = mip0Frame0 + (mip0Frame1 - mip0Frame0) * cachedFrameFrac;
        const float mip1Sample = mip1Frame0 + (mip1Frame1 - mip1Frame0) * cachedFrameFrac;
        return mip0Sample + (mip1Sample - mip0Sample) * cachedMipFrac;
    }
}
