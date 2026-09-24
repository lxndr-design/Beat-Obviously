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
        tableTransitionLength = juce::jlimit(32, 512, (int) std::round(sampleRate * 0.005));
        markFrameCacheDirty();
    }

    void WavetableOscillator::reset(double newPhase) noexcept
    {
        setPhase(newPhase);
    }

    void WavetableOscillator::setWavetable(const Wavetable* newTable) noexcept
    {
        const auto* validTable = newTable != nullptr && newTable->isValid() ? newTable : nullptr;
        if (validTable == table)
            return;
        previousTable = table;
        previousCache = currentCache;
        table = validTable;
        currentCache = {};
        tableTransitionRemaining = previousTable != nullptr && table != nullptr ? tableTransitionLength : 0;
        markFrameCacheDirty();
    }

    void WavetableOscillator::setFrequency(double newFrequencyHz) noexcept
    {
        const double nextFrequency = std::isfinite(newFrequencyHz) ? juce::jlimit(0.0, sampleRate * 0.49, newFrequencyHz) : 0.0;
        if (std::abs(nextFrequency - frequencyHz) < 0.000001)
            return;

        frequencyHz = nextFrequency;
        phaseDelta = sampleRate > 0.0 ? frequencyHz / sampleRate : 0.0;
        markMipCacheDirty();
    }

    void WavetableOscillator::setPosition(float newPosition) noexcept
    {
        const float nextPosition = std::isfinite(newPosition) ? juce::jlimit(0.0f, 1.0f, newPosition) : 0.0f;
        if (std::abs(nextPosition - position) < 0.000001f)
            return;

        position = nextPosition;
        markPositionCacheDirty();
    }

    void WavetableOscillator::setPhase(double newPhase) noexcept
    {
        phase = wrap01(newPhase);
    }

    float WavetableOscillator::renderSample() noexcept
    {
        float sample = readCurrentSample(table, currentCache);
        if (tableTransitionRemaining > 0 && previousTable != nullptr)
        {
            const float previous = readCurrentSample(previousTable, previousCache);
            const float mix = 1.0f - (float) tableTransitionRemaining / (float) juce::jmax(1, tableTransitionLength);
            sample = previous + (sample - previous) * mix;
            --tableTransitionRemaining;
            if (tableTransitionRemaining == 0)
                previousTable = nullptr;
        }

        phase += phaseDelta;
        if (phase >= 1.0)
            phase -= 1.0;

        return std::isfinite(sample) ? juce::jlimit(-1.0f, 1.0f, sample) : 0.0f;
    }

    void WavetableOscillator::updateMipCache(const Wavetable* source, PlaybackCache& cache) noexcept
    {
        cache.mipDirty = false;

        if (source == nullptr)
        {
            cache = {};
            cache.mipDirty = false;
            cache.positionDirty = false;
            return;
        }

        const int frameSize = source->getFrameSize();
        if (source->getFrameCount() <= 0 || frameSize <= 1)
        {
            cache = {};
            cache.mipDirty = false;
            cache.positionDirty = false;
            return;
        }

        int mip0 = 0;
        int mip1 = 0;
        float mipFrac = 0.0f;
        const int mipCount = source->getMipLevelCount();
        const double playbackLimit = frequencyHz > 0.0 && sampleRate > 0.0
            ? juce::jmax(1.0, (sampleRate * 0.48) / frequencyHz)
            : std::numeric_limits<double>::max();
        for (int mip = 0; mip + 1 < mipCount; ++mip)
        {
            // Mip harmonic limits are validated to be identical for every
            // timbral frame, so frequency selection never needs to follow
            // the current frame position.
            const auto* current = source->getMipLevel(0, mip);
            const auto* next = source->getMipLevel(0, mip + 1);
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

        cache.frameSize = frameSize;
        cache.mip0 = mip0;
        cache.mip1 = mip1;
        cache.mipFrac = mipFrac;
        cache.positionDirty = true;
    }

    void WavetableOscillator::updatePositionCache(const Wavetable* source, PlaybackCache& cache) noexcept
    {
        cache.positionDirty = false;
        if (source == nullptr || cache.frameSize <= 1)
        {
            cache.frame0Mip0Data = nullptr;
            cache.frame1Mip0Data = nullptr;
            cache.frame0Mip1Data = nullptr;
            cache.frame1Mip1Data = nullptr;
            cache.frameFrac = 0.0f;
            return;
        }

        const int frameCount = source->getFrameCount();
        if (frameCount <= 0)
            return;
        const float framePos = position * (float) (frameCount - 1);
        const int frame0 = juce::jlimit(0, frameCount - 1, (int) std::floor(framePos));
        const int frame1 = juce::jmin(frame0 + 1, frameCount - 1);
        const auto* f0m0 = source->getMipLevel(frame0, cache.mip0);
        const auto* f1m0 = source->getMipLevel(frame1, cache.mip0);
        const auto* f0m1 = source->getMipLevel(frame0, cache.mip1);
        const auto* f1m1 = source->getMipLevel(frame1, cache.mip1);
        cache.frame0Mip0Data = f0m0 != nullptr ? f0m0->samples.data() : nullptr;
        cache.frame1Mip0Data = f1m0 != nullptr ? f1m0->samples.data() : nullptr;
        cache.frame0Mip1Data = f0m1 != nullptr ? f0m1->samples.data() : nullptr;
        cache.frame1Mip1Data = f1m1 != nullptr ? f1m1->samples.data() : nullptr;
        cache.frameFrac = framePos - (float) frame0;
    }

    float WavetableOscillator::readCurrentSample(const Wavetable* source, PlaybackCache& cache) noexcept
    {
        if (cache.mipDirty)
            updateMipCache(source, cache);
        if (cache.positionDirty)
            updatePositionCache(source, cache);

        if (cache.frameSize <= 1 || cache.frame0Mip0Data == nullptr || cache.frame1Mip0Data == nullptr
            || cache.frame0Mip1Data == nullptr || cache.frame1Mip1Data == nullptr)
            return 0.0f;

        const double samplePos = phase * (double) cache.frameSize;
        const int index0 = (int) samplePos;
        const int index1 = index0 + 1 == cache.frameSize ? 0 : index0 + 1;
        const float sampleFrac = (float) (samplePos - (double) index0);

        const auto interpolate = [this, &cache, index0, index1, sampleFrac](const float* data) noexcept
        {
            if (quality == AudioQuality::offlineHighQuality)
            {
                const int previous = index0 == 0 ? cache.frameSize - 1 : index0 - 1;
                const int next = index1 + 1 == cache.frameSize ? 0 : index1 + 1;
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
        // Most live patches sit exactly on a frame and mip level for long
        // stretches. Avoid reading and interpolating the three unused table
        // corners in that common case; the full four-corner path remains for
        // actual frame and mip morphing.
        const float mip0Frame0 = interpolate(cache.frame0Mip0Data);
        const bool blendFrames = cache.frameFrac != 0.0f;
        const float mip0Sample = blendFrames
            ? mip0Frame0 + (interpolate(cache.frame1Mip0Data) - mip0Frame0) * cache.frameFrac
            : mip0Frame0;
        if (cache.mipFrac == 0.0f)
            return mip0Sample;

        const float mip1Frame0 = interpolate(cache.frame0Mip1Data);
        const float mip1Sample = blendFrames
            ? mip1Frame0 + (interpolate(cache.frame1Mip1Data) - mip1Frame0) * cache.frameFrac
            : mip1Frame0;
        return mip0Sample + (mip1Sample - mip0Sample) * cache.mipFrac;
    }
}
