#include "SampleStreamingSession.h"

#include <algorithm>
#include <cmath>
#include <limits>

namespace beat
{
    SampleStreamingSession::Asset::Asset(std::unique_ptr<juce::AudioFormatReader> sourceReader)
        : reader(std::move(sourceReader)),
          scratch(2, BoundedSamplePageCache::pageFrames),
          cache(*this, reader != nullptr ? reader->lengthInSamples : 0)
    {
    }

    int SampleStreamingSession::Asset::readFrames(int64_t firstFrame, int frameCount,
                                                   float* left, float* right) noexcept
    {
        if (reader == nullptr || firstFrame < 0 || frameCount <= 0
            || firstFrame >= reader->lengthInSamples)
            return 0;

        const int available = (int) std::min<int64_t>(
            frameCount, reader->lengthInSamples - firstFrame);
        scratch.clear();
        if (!reader->read(&scratch, 0, available, firstFrame, true, true))
            return 0;
        const int rightChannel = reader->numChannels > 1 ? 1 : 0;
        std::copy_n(scratch.getReadPointer(0), available, left);
        std::copy_n(scratch.getReadPointer(rightChannel), available, right);
        return available;
    }

    SampleStreamingSession::SampleStreamingSession()
        : juce::Thread("Beat sample stream")
    {
        assets.reserve(maximumAssets);
    }

    SampleStreamingSession::~SampleStreamingSession()
    {
        stop();
    }

    std::optional<SampleStreamingSession::AssetMetadata> SampleStreamingSession::addAsset(
        const juce::File& file, juce::AudioFormatManager& formats,
        double minimumDurationSeconds)
    {
        if (isThreadRunning() || assets.size() >= maximumAssets
            || !file.existsAsFile())
            return std::nullopt;

        auto reader = std::unique_ptr<juce::AudioFormatReader>(formats.createReaderFor(file));
        if (reader == nullptr || reader->numChannels <= 0 || reader->lengthInSamples <= 1
            || reader->lengthInSamples > std::numeric_limits<int>::max()
            || !std::isfinite(reader->sampleRate) || reader->sampleRate <= 0.0)
            return std::nullopt;
        if (std::isfinite(minimumDurationSeconds) && minimumDurationSeconds > 0.0
            && (double) reader->lengthInSamples / reader->sampleRate < minimumDurationSeconds)
            return std::nullopt;

        AssetMetadata metadata {
            assets.size(),
            reader->lengthInSamples,
            (int) reader->numChannels,
            reader->sampleRate,
        };
        assets.push_back(std::make_unique<Asset>(std::move(reader)));
        return metadata;
    }

    bool SampleStreamingSession::preloadFrame(size_t assetIndex, int64_t frameIndex) noexcept
    {
        return !isThreadRunning() && assetIndex < assets.size()
            && assets[assetIndex]->cache.preloadFrame(frameIndex);
    }

    bool SampleStreamingSession::readStereoFrame(
        size_t assetIndex, int64_t frameIndex,
        BoundedSamplePageCache::StereoFrame& output) noexcept
    {
        if (assetIndex >= assets.size())
        {
            output = {};
            return false;
        }
        return assets[assetIndex]->cache.readStereoFrame(frameIndex, output);
    }

    SamplePageCacheTelemetry SampleStreamingSession::telemetry(size_t assetIndex) const noexcept
    {
        return assetIndex < assets.size() ? assets[assetIndex]->cache.telemetry()
                                          : SamplePageCacheTelemetry {};
    }

    SamplePageCacheTelemetry SampleStreamingSession::aggregateTelemetry() const noexcept
    {
        SamplePageCacheTelemetry total;
        for (const auto& asset : assets)
        {
            const auto value = asset->cache.telemetry();
            total.cacheHits += value.cacheHits;
            total.cacheMisses += value.cacheMisses;
            total.underflows += value.underflows;
            total.requestsAccepted += value.requestsAccepted;
            total.requestsRejected += value.requestsRejected;
            total.requestsDeduplicated += value.requestsDeduplicated;
            total.pagesLoaded += value.pagesLoaded;
            total.pageLoadsFailed += value.pageLoadsFailed;
            total.pageLoadsDeferred += value.pageLoadsDeferred;
        }
        return total;
    }

    bool SampleStreamingSession::start()
    {
        return !assets.empty() && (isThreadRunning() || startThread(juce::Thread::Priority::normal));
    }

    void SampleStreamingSession::stop() noexcept
    {
        if (isThreadRunning())
        {
            signalThreadShouldExit();
            notify();
            stopThread(-1);
        }
    }

    void SampleStreamingSession::run()
    {
        while (!threadShouldExit())
        {
            bool serviced = false;
            for (auto& asset : assets)
                serviced = asset->cache.serviceOneRequest() || serviced;
            if (!serviced)
                wait(1);
        }
    }
}
