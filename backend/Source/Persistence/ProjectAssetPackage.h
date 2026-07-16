#pragma once

#include <juce_core/juce_core.h>
#include "HybridSourceDocumentValidation.h"

namespace beat
{
    struct ProjectSidecarCleanupReport
    {
        int deletedFiles { 0 };
        int failedFiles { 0 };
        bool blocked { false };
        juce::StringArray deletedPaths;
        juce::StringArray failedPaths;
        std::vector<HybridSourceDocumentDiagnostic> diagnostics;

        bool ok() const noexcept { return !blocked && failedFiles == 0; }
    };

    juce::File projectSidecarFolderFor(const juce::File& projectFile);
    juce::String resolveProjectRelativePath(const juce::File& projectFile, const juce::String& path);
    void resolveDocumentAssetPaths(juce::var& document, const juce::File& projectFile);
    juce::var buildDocumentAssetManifest(const juce::var& document);
    bool rebuildDocumentAssetManifest(juce::var& document);
    bool packageExternalDocumentAssets(juce::var& document, const juce::File& projectFile, juce::String& error);
    ProjectSidecarCleanupReport cleanupUnusedProjectSidecarAssets(const juce::var& document, const juce::File& projectFile);
}
