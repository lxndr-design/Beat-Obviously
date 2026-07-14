#pragma once

#include "BoundedSamplePageCache.h"

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

#include <memory>
#include <optional>
#include <vector>

namespace beat
{
    class SampleStreamingSession final : private juce::Thread
    {
    public:
        static constexpr size_t maximumAssets = 8;

        struct AssetMetadata
        {
            size_t index { 0 };
            int64_t frames { 0 };
            int channels { 0 };
            double sampleRate { 0.0 };
        };

        SampleStreamingSession();
        ~SampleStreamingSession() override;

        SampleStreamingSession(const SampleStreamingSession&) = delete;
        SampleStreamingSession& operator=(const SampleStreamingSession&) = delete;

        std::optional<AssetMetadata> addAsset(const juce::File& file,
                                              juce::AudioFormatManager& formats,
                                              double minimumDurationSeconds = 0.0);
        bool preloadFrame(size_t assetIndex, int64_t frameIndex) noexcept;
        bool readStereoFrame(size_t assetIndex, int64_t frameIndex,
                             BoundedSamplePageCache::StereoFrame& output) noexcept;
        SamplePageCacheTelemetry telemetry(size_t assetIndex) const noexcept;
        SamplePageCacheTelemetry aggregateTelemetry() const noexcept;
        size_t assetCount() const noexcept { return assets.size(); }

        bool start();
        void stop() noexcept;

    private:
        struct Asset final : SamplePageLoader
        {
            explicit Asset(std::unique_ptr<juce::AudioFormatReader> sourceReader);

            int readFrames(int64_t firstFrame, int frameCount,
                           float* left, float* right) noexcept override;

            std::unique_ptr<juce::AudioFormatReader> reader;
            juce::AudioBuffer<float> scratch;
            BoundedSamplePageCache cache;
        };

        void run() override;

        std::vector<std::unique_ptr<Asset>> assets;
    };
}
