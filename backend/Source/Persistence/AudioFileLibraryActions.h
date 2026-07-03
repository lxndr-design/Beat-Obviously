#pragma once

#include "Database.h"

#include <juce_core/juce_core.h>

namespace beat
{
    struct AudioFileDeleteResult
    {
        juce::StringArray deletedIds;
        juce::StringArray failedIds;
        juce::StringArray failedPaths;
    };

    bool fileLivesInsideDirectory(const juce::File& file, const juce::File& directory);

    AudioFileDeleteResult deleteAudioFileLibraryEntries(Database& database,
                                                        const juce::StringArray& ids,
                                                        bool deleteFiles,
                                                        const juce::File& managedAudioDirectory);
}
