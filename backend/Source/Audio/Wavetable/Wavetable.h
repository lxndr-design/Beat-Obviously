#pragma once

#include <juce_core/juce_core.h>
#include <cstdint>
#include <vector>

namespace beat
{
    class Wavetable
    {
    public:
        struct MipLevel
        {
            int maxHarmonic { 1 };
            std::vector<float> samples;
        };

        struct TimbralFrame
        {
            std::vector<MipLevel> mipLevels;
        };

        enum class ValidationError : uint8_t
        {
            none,
            noFrames,
            noMipLevels,
            invalidFrameSize,
            inconsistentFrameSize,
            inconsistentMipCount,
            inconsistentMipHarmonics,
            invalidHarmonicLimit,
            unorderedHarmonicLimits,
            nonFiniteSample,
            legacySampleCountMismatch
        };

        struct Metadata
        {
            juce::String id;
            juce::String name;
            juce::String source;
        };

        Wavetable() = default;
        Wavetable(Metadata metadata, std::vector<TimbralFrame> frames);
        Wavetable(Metadata metadata, int frameCount, int frameSize, std::vector<float> samples);

        bool isValid() const noexcept;
        const Metadata& getMetadata() const noexcept { return metadata; }
        int getFrameCount() const noexcept { return frameCount; }
        int getFrameSize() const noexcept { return frameSize; }
        int getMipLevelCount() const noexcept { return mipLevelCount; }
        ValidationError getValidationError() const noexcept { return validationError; }
        juce::String getValidationErrorMessage() const;
        const MipLevel* getMipLevel(int frameIndex, int mipIndex) const noexcept;
        const float* getFrameData(int frameIndex) const noexcept;
        float getSample(int frameIndex, int sampleIndex) const noexcept;

    private:
        Metadata metadata;
        int frameCount { 0 };
        int frameSize { 0 };
        int mipLevelCount { 0 };
        ValidationError validationError { ValidationError::noFrames };
        std::vector<TimbralFrame> frames;
    };
}
