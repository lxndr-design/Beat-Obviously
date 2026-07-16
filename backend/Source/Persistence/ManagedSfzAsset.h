#pragma once

#include "../Audio/Sampler/SfzSampleDecoder.h"

#include <juce_core/juce_core.h>

#include <memory>
#include <vector>

namespace beat
{
    struct ManagedSfzAssetFile
    {
        juce::String id;
        juce::String path;
        juce::String sha256;
        int64_t byteSize { 0 };
    };

    struct ManagedSfzImportResult
    {
        juce::String assetId;
        juce::String displayName;
        juce::String manifestPath;
        juce::String sourcePath;
        std::vector<ManagedSfzAssetFile> sampleFiles;
        std::vector<SfzDiagnostic> diagnostics;
        juce::String error;

        bool ok() const noexcept { return error.isEmpty() && manifestPath.isNotEmpty(); }
    };

    /**
     * Validate and transactionally copy one bounded SFZ instrument into the
     * selected project's managed sidecar. Control/import-thread only.
     */
    ManagedSfzImportResult importManagedSfzAsset(const juce::File& sfzFile,
                                                 const juce::File& projectFile);

    /** Load and verify a managed manifest, then decode its immutable samples. */
    SfzSampleDecodeResult loadManagedSfzAsset(const juce::File& manifestFile);
}
