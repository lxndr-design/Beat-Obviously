#pragma once

#include "SfzSubsetImporter.h"

#include <array>
#include <cstdint>
#include <memory>
#include <vector>

namespace beat
{
    struct SfzSampleResolutionLimits
    {
        static constexpr size_t hardMaximumCandidatesPerNote = 32;

        size_t maximumCandidatesPerNote { hardMaximumCandidatesPerNote };
        int64_t maximumSampleFileBytes { 4LL * 1024 * 1024 * 1024 };
        int64_t maximumTotalUniqueSampleBytes { 16LL * 1024 * 1024 * 1024 };
        size_t maximumDiagnostics { 512 };
    };

    struct SfzResolvedRegion
    {
        SfzSubsetRegion definition;
        juce::File sampleFile;
        int64_t sampleFileBytes { 0 };
        int64_t sampleLastWriteTimeTicks { 0 };
        uint16_t stableRegionIndex { 0 };
    };

    struct SfzNoteRegionCandidates
    {
        std::array<uint16_t, SfzSampleResolutionLimits::hardMaximumCandidatesPerNote> indices {};
        uint8_t count { 0 };
    };

    struct SfzResolvedInstrument
    {
        juce::File sourceFile;
        juce::File canonicalSampleRoot;
        std::vector<SfzResolvedRegion> regions;
        std::array<SfzNoteRegionCandidates, 128> noteIndex;
        int64_t totalUniqueSampleBytes { 0 };
        bool hasSequenceMetadata { false };
    };

    struct SfzSampleResolution
    {
        std::shared_ptr<const SfzResolvedInstrument> instrument;
        std::vector<SfzDiagnostic> diagnostics;
        size_t warningCount { 0 };
        size_t errorCount { 0 };

        bool hasErrors() const noexcept { return errorCount != 0; }
        bool isAccepted() const noexcept { return instrument != nullptr && !hasErrors(); }
    };

    /**
     * Resolve parsed relative sample paths beneath the selected SFZ's canonical
     * directory and build a fixed per-note candidate index.
     *
     * Control/import-thread only. This function does not decode samples, publish
     * routes, create streaming workers, or participate in rendering.
     */
    SfzSampleResolution resolveSfzSubsetSamples(
        const SfzSubsetImport& parsed,
        const juce::File& sfzFile,
        const SfzSampleResolutionLimits& limits = {});
}
