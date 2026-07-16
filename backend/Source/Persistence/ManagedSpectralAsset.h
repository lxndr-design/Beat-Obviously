#pragma once

#include "../Audio/Spectral/SpectralArtifact.h"

#include <juce_core/juce_core.h>

#include <memory>

namespace beat
{
    struct ManagedSpectralImportResult
    {
        juce::String assetId;
        juce::String displayName;
        juce::String manifestPath;
        juce::String sourcePath;
        juce::String artifactPath;
        juce::String sourceSha256;
        juce::String artifactSha256;
        int64_t artifactBytes { 0 };
        juce::String error;

        bool ok() const noexcept { return error.isEmpty() && manifestPath.isNotEmpty(); }
    };

    struct ManagedSpectralLoadResult
    {
        std::shared_ptr<const SpectralArtifact> artifact;
        juce::String error;

        bool ok() const noexcept { return artifact != nullptr && error.isEmpty(); }
    };

    /** Decode canonical 48 kHz audio, analyze it off callback, and publish a
        content-addressed source/artifact bundle transactionally. */
    ManagedSpectralImportResult importManagedSpectralAsset(const juce::File& audioFile,
                                                           const juce::File& projectFile,
                                                           int rootNote = 60,
                                                           uint32_t deterministicSeed = 0);

    /** Verify paths, sizes, hashes, manifest metadata, and artifact-v2 before
        returning immutable playback data. */
    ManagedSpectralLoadResult loadManagedSpectralAsset(const juce::File& manifestFile);
}
