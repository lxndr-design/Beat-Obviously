#pragma once

#include <juce_core/juce_core.h>
#include <vector>

namespace beat
{
    class Wavetable
    {
    public:
        struct Metadata
        {
            juce::String id;
            juce::String name;
            juce::String source;
        };

        Wavetable() = default;
        Wavetable(Metadata metadata, int frameCount, int frameSize, std::vector<float> samples);

        bool isValid() const noexcept;
        const Metadata& getMetadata() const noexcept { return metadata; }
        int getFrameCount() const noexcept { return frameCount; }
        int getFrameSize() const noexcept { return frameSize; }
        const float* getFrameData(int frameIndex) const noexcept;
        float getSample(int frameIndex, int sampleIndex) const noexcept;

    private:
        Metadata metadata;
        int frameCount { 0 };
        int frameSize { 0 };
        std::vector<float> samples;
    };
}
