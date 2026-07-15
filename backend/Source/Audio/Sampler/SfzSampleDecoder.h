#pragma once

#include "SfzSampleResolver.h"

#include <juce_audio_formats/juce_audio_formats.h>

#include <memory>
#include <vector>

namespace beat
{
    struct SfzSampleDecodeLimits
    {
        size_t maximumUniqueSamples { 256 };
        int maximumChannels { 2 };
        int64_t maximumDecodedBytesPerSample { 256LL * 1024 * 1024 };
        int64_t maximumTotalDecodedBytes { 512LL * 1024 * 1024 };
        size_t maximumDiagnostics { 512 };
    };

    struct SfzDecodedSample
    {
        juce::File sourceFile;
        std::shared_ptr<const juce::AudioBuffer<float>> audio;
        double sourceSampleRate { 0.0 };
    };

    struct SfzDecodedRegion
    {
        SfzSubsetRegion definition;
        uint16_t sampleIndex { 0 };
        uint16_t stableRegionIndex { 0 };
    };

    struct SfzDecodedInstrument
    {
        std::shared_ptr<const SfzResolvedInstrument> resolvedSource;
        std::vector<SfzDecodedSample> samples;
        std::vector<SfzDecodedRegion> regions;
        std::array<SfzNoteRegionCandidates, 128> noteIndex;
        int64_t totalDecodedBytes { 0 };
    };

    struct SfzSampleDecodeResult
    {
        std::shared_ptr<const SfzDecodedInstrument> instrument;
        std::vector<SfzDiagnostic> diagnostics;
        size_t warningCount { 0 };
        size_t errorCount { 0 };

        bool hasErrors() const noexcept { return errorCount != 0; }
        bool isAccepted() const noexcept { return instrument != nullptr && !hasErrors(); }
    };

    /**
     * Decode a resolved SFZ instrument into immutable sample buffers.
     *
     * Control/import-thread only. The result is not connected to project state,
     * source slots, streaming workers, or the audio callback.
     */
    SfzSampleDecodeResult decodeSfzResolvedInstrument(
        std::shared_ptr<const SfzResolvedInstrument> resolved,
        const SfzSampleDecodeLimits& limits = {});
}
