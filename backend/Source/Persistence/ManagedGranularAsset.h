#pragma once

#include "../Audio/Sources/GranularSourceSlot.h"

#include <juce_core/juce_core.h>

#include <memory>

namespace beat
{
    struct ManagedGranularImportResult
    {
        juce::String assetId;
        juce::String displayName;
        juce::String manifestPath;
        juce::String audioPath;
        juce::String sha256;
        int64_t byteSize { 0 };
        juce::String error;

        bool ok() const noexcept { return error.isEmpty() && manifestPath.isNotEmpty(); }
    };

    struct ManagedGranularLoadResult
    {
        std::shared_ptr<const juce::AudioBuffer<float>> audio;
        double sourceSampleRate { 0.0 };
        juce::String error;

        bool ok() const noexcept { return audio != nullptr && error.isEmpty(); }
    };

    /** Validate, decode, and transactionally copy one bounded audio source. */
    ManagedGranularImportResult importManagedGranularAsset(const juce::File& audioFile,
                                                           const juce::File& projectFile);

    /** Verify a managed manifest and descriptor-decode its immutable audio. */
    ManagedGranularLoadResult loadManagedGranularAsset(const juce::File& manifestFile);

    /** Beat-owned deterministic source used only by the factory benchmark preset. */
    std::shared_ptr<const juce::AudioBuffer<float>> makeGranularBenchmarkAudio();
}
