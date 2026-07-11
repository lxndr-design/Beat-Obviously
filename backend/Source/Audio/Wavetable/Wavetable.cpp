#include "Wavetable.h"

#include <cmath>
#include <limits>

namespace beat
{
    Wavetable::Wavetable(Metadata newMetadata, std::vector<TimbralFrame> newFrames)
        : metadata(std::move(newMetadata)), frames(std::move(newFrames))
    {
        validationError = ValidationError::none;
        if (frames.empty())
        {
            validationError = ValidationError::noFrames;
            return;
        }

        frameCount = (int) frames.size();
        mipLevelCount = (int) frames.front().mipLevels.size();
        if (mipLevelCount <= 0)
        {
            validationError = ValidationError::noMipLevels;
            return;
        }

        frameSize = (int) frames.front().mipLevels.front().samples.size();
        if (frameSize <= 1)
        {
            validationError = ValidationError::invalidFrameSize;
            return;
        }

        for (const auto& frame : frames)
        {
            if ((int) frame.mipLevels.size() != mipLevelCount)
            {
                validationError = ValidationError::inconsistentMipCount;
                return;
            }

            int previousLimit = std::numeric_limits<int>::max();
            for (int mipIndex = 0; mipIndex < mipLevelCount; ++mipIndex)
            {
                const auto& mip = frame.mipLevels[(size_t) mipIndex];
                if ((int) mip.samples.size() != frameSize)
                {
                    validationError = ValidationError::inconsistentFrameSize;
                    return;
                }
                if (mip.maxHarmonic < 1 || mip.maxHarmonic > frameSize / 2)
                {
                    validationError = ValidationError::invalidHarmonicLimit;
                    return;
                }
                if (mip.maxHarmonic >= previousLimit)
                {
                    validationError = ValidationError::unorderedHarmonicLimits;
                    return;
                }
                if (&frame != &frames.front()
                    && mip.maxHarmonic != frames.front().mipLevels[(size_t) mipIndex].maxHarmonic)
                {
                    validationError = ValidationError::inconsistentMipHarmonics;
                    return;
                }
                previousLimit = mip.maxHarmonic;

                for (const float sample : mip.samples)
                {
                    if (!std::isfinite(sample))
                    {
                        validationError = ValidationError::nonFiniteSample;
                        return;
                    }
                }
            }
        }
    }

    Wavetable::Wavetable(Metadata newMetadata, int newFrameCount, int newFrameSize, std::vector<float> samples)
        : metadata(std::move(newMetadata))
    {
        if (newFrameCount <= 0 || newFrameSize <= 1
            || samples.size() != (size_t) newFrameCount * (size_t) newFrameSize)
        {
            validationError = ValidationError::legacySampleCountMismatch;
            return;
        }

        std::vector<TimbralFrame> legacyFrames((size_t) newFrameCount);
        for (int frame = 0; frame < newFrameCount; ++frame)
        {
            auto begin = samples.begin() + (ptrdiff_t) frame * newFrameSize;
            legacyFrames[(size_t) frame].mipLevels.push_back({
                juce::jmax(1, newFrameSize / 2 - 1),
                std::vector<float>(begin, begin + newFrameSize)
            });
        }
        *this = Wavetable(std::move(metadata), std::move(legacyFrames));
    }

    bool Wavetable::isValid() const noexcept
    {
        return validationError == ValidationError::none;
    }

    juce::String Wavetable::getValidationErrorMessage() const
    {
        switch (validationError)
        {
            case ValidationError::none: return {};
            case ValidationError::noFrames: return "wavetable has no timbral frames";
            case ValidationError::noMipLevels: return "timbral frame has no mip levels";
            case ValidationError::invalidFrameSize: return "mip level must contain at least two samples";
            case ValidationError::inconsistentFrameSize: return "all mip levels must have the same sample count";
            case ValidationError::inconsistentMipCount: return "all timbral frames must have the same mip count";
            case ValidationError::inconsistentMipHarmonics: return "all timbral frames must use the same mip harmonic limits";
            case ValidationError::invalidHarmonicLimit: return "mip harmonic limit is outside the frame bandwidth";
            case ValidationError::unorderedHarmonicLimits: return "mip harmonic limits must be strictly descending";
            case ValidationError::nonFiniteSample: return "mip level contains a non-finite sample";
            case ValidationError::legacySampleCountMismatch: return "legacy wavetable sample count does not match its dimensions";
        }
        return "unknown wavetable validation error";
    }

    const Wavetable::MipLevel* Wavetable::getMipLevel(int frameIndex, int mipIndex) const noexcept
    {
        if (!isValid())
            return nullptr;
        const int frame = juce::jlimit(0, frameCount - 1, frameIndex);
        const int mip = juce::jlimit(0, mipLevelCount - 1, mipIndex);
        return &frames[(size_t) frame].mipLevels[(size_t) mip];
    }

    const float* Wavetable::getFrameData(int frameIndex) const noexcept
    {
        if (!isValid())
            return nullptr;

        const auto* mip = getMipLevel(frameIndex, 0);
        return mip != nullptr ? mip->samples.data() : nullptr;
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
