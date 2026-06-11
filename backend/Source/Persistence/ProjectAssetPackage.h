#pragma once

#include <juce_core/juce_core.h>

namespace beat
{
    struct ProjectSidecarCleanupReport
    {
        int deletedFiles { 0 };
        int failedFiles { 0 };
        juce::StringArray deletedPaths;
        juce::StringArray failedPaths;

        bool ok() const noexcept { return failedFiles == 0; }
    };

    juce::File projectSidecarFolderFor(const juce::File& projectFile);
    juce::String resolveProjectRelativePath(const juce::File& projectFile, const juce::String& path);
    void resolveDocumentAssetPaths(juce::var& document, const juce::File& projectFile);
    juce::var buildDocumentAssetManifest(const juce::var& document);
    bool rebuildDocumentAssetManifest(juce::var& document);
    bool packageExternalDocumentAssets(juce::var& document, const juce::File& projectFile, juce::String& error);
    ProjectSidecarCleanupReport cleanupUnusedProjectSidecarAssets(const juce::var& document, const juce::File& projectFile);
}
