#pragma once

#include <juce_core/juce_core.h>

#include <vector>

namespace beat
{
    struct ProjectDocumentBackupEntry
    {
        juce::File file;
        juce::Time modifiedAt;
        juce::int64 sizeBytes { 0 };
        bool latest { false };
    };

    juce::File projectBackupFolderFor(const juce::File& projectFile);
    juce::File latestProjectBackupFileFor(const juce::File& projectFile);
    std::vector<ProjectDocumentBackupEntry> listProjectBackups(const juce::File& projectFile);
    bool createProjectBackupBeforeReplace(const juce::File& projectFile,
                                          juce::String& error,
                                          juce::File* latestBackup = nullptr);
    bool restoreProjectBackup(const juce::File& projectFile,
                              const juce::File& backupFile,
                              juce::String& error,
                              juce::File* overwrittenBackup = nullptr);
}
