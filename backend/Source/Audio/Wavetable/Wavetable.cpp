#include "Wavetable.h"

namespace beat
{
    Wavetable::Wavetable(Metadata newMetadata, int newFrameCount, int newFrameSize, std::vector<float> newSamples)
        : metadata(std::move(newMetadata)),
          frameCount(juce::jmax(0, newFrameCount)),
          frameSize(juce::jmax(0, newFrameSize)),
          samples(std::move(newSamples))
    {
        if ((int) samples.size() != frameCount * frameSize)
        {
            frameCount = 0;
            frameSize = 0;
            samples.clear();
        }
    }

    bool Wavetable::isValid() const noexcept
    {
        return frameCount > 0 && frameSize > 1 && (int) samples.size() == frameCount * frameSize;
    }

    const float* Wavetable::getFrameData(int frameIndex) const noexcept
    {
        if (!isValid())
            return nullptr;

        const int frame = juce::jlimit(0, frameCount - 1, frameIndex);
        return samples.data() + (size_t) frame * (size_t) frameSize;
    }

    float Wavetable::getSample(int frameIndex, int sampleIndex) const noexcept
    {
        const float* frame = getFrameData(frameIndex);
        if (frame == nullptr)
            return 0.0f;

        const int wrappedIndex = sampleIndex >= 0
            ? sampleIndex % frameSize
            : (frameSize - ((-sampleIndex) % frameSize)) % frameSize;

        return frame[(size_t) wrappedIndex];
    }
}
