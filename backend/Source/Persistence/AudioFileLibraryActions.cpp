#include "AudioFileLibraryActions.h"

namespace beat
{
    bool fileLivesInsideDirectory(const juce::File& file, const juce::File& directory)
    {
        auto filePath = file.getFullPathName().replaceCharacter('\\', '/');
        auto directoryPath = directory.getFullPathName().replaceCharacter('\\', '/');
        if (!directoryPath.endsWithChar('/'))
            directoryPath += "/";
        return filePath.startsWithIgnoreCase(directoryPath);
    }

    AudioFileDeleteResult deleteAudioFileLibraryEntries(Database& database,
                                                        const juce::StringArray& ids,
                                                        bool deleteFiles,
                                                        const juce::File& managedAudioDirectory)
    {
        AudioFileDeleteResult result;

        for (const auto& id : ids)
        {
            if (id.isEmpty())
                continue;

            juce::String path;
            {
                Statement lookup(database, "SELECT path FROM audio_files WHERE id = ?");
                lookup.bind(1, id);
                if (lookup.step())
                    path = lookup.columnText(0);
            }

            if (path.isEmpty())
            {
                result.failedIds.addIfNotAlreadyThere(id);
                continue;
            }

            const juce::File file(path);
            if (deleteFiles
                && file.existsAsFile()
                && fileLivesInsideDirectory(file, managedAudioDirectory)
                && !file.deleteFile())
            {
                result.failedIds.addIfNotAlreadyThere(id);
                result.failedPaths.addIfNotAlreadyThere(path);
                continue;
            }

            Statement remove(database, "DELETE FROM audio_files WHERE id = ?");
            remove.bind(1, id);
            remove.step();
            result.deletedIds.addIfNotAlreadyThere(id);
        }

        return result;
    }
}
