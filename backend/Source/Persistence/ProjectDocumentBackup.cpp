#include "ProjectDocumentBackup.h"

#include "ProjectAssetPackage.h"
#include "ProjectIntegrityVerifier.h"

#include <algorithm>

namespace beat
{
    namespace
    {
        constexpr int maxTimestampedBackups = 20;

        juce::String safeProjectBackupName(const juce::File& projectFile)
        {
            auto safe = projectFile.getFileNameWithoutExtension()
                .retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_().")
                .trim();
            return safe.isNotEmpty() ? safe : "Untitled";
        }

        juce::String backupTimestamp()
        {
            return juce::Time::getCurrentTime().formatted("%Y%m%d-%H%M%S");
        }

        juce::File uniqueTimestampedBackupFile(const juce::File& folder, const juce::String& baseName)
        {
            auto candidate = folder.getChildFile(baseName + " " + backupTimestamp()).withFileExtension(".beat");
            if (!candidate.existsAsFile())
                return candidate;

            for (int i = 2; i < 1000; ++i)
            {
                candidate = folder.getChildFile(baseName + " " + backupTimestamp() + " " + juce::String(i))
                    .withFileExtension(".beat");
                if (!candidate.existsAsFile())
                    return candidate;
            }

            return folder.getChildFile(baseName + " " + juce::Uuid().toString().substring(0, 8))
                .withFileExtension(".beat");
        }

        void pruneOldTimestampedBackups(const juce::File& folder)
        {
            juce::Array<juce::File> backups;
            folder.findChildFiles(backups, juce::File::findFiles, false, "*.beat");

            for (int i = backups.size(); --i >= 0;)
            {
                if (backups.getReference(i).getFileName().equalsIgnoreCase("Latest.beat"))
                    backups.remove(i);
            }

            std::sort(backups.begin(), backups.end(), [](const juce::File& a, const juce::File& b)
            {
                return a.getLastModificationTime() > b.getLastModificationTime();
            });

            for (int i = maxTimestampedBackups; i < backups.size(); ++i)
                backups.getReference(i).deleteFile();
        }

        bool fileLivesInsideDirectory(const juce::File& file, const juce::File& directory)
        {
            auto filePath = file.getFullPathName().replaceCharacter('\\', '/');
            auto directoryPath = directory.getFullPathName().replaceCharacter('\\', '/');
            if (!directoryPath.endsWithChar('/'))
                directoryPath += "/";
            return filePath.startsWithIgnoreCase(directoryPath);
        }
    }

    juce::File projectBackupFolderFor(const juce::File& projectFile)
    {
        if (projectUsesFolderLayout(projectFile))
            return projectFile.getParentDirectory().getChildFile("Backups");
        return projectFile.getSiblingFile(safeProjectBackupName(projectFile) + " Backups");
    }

    juce::File latestProjectBackupFileFor(const juce::File& projectFile)
    {
        return projectBackupFolderFor(projectFile).getChildFile("Latest.beat");
    }

    std::vector<ProjectDocumentBackupEntry> listProjectBackups(const juce::File& projectFile)
    {
        std::vector<ProjectDocumentBackupEntry> out;
        const auto folder = projectBackupFolderFor(projectFile);
        if (!folder.exists())
            return out;

        const auto latest = latestProjectBackupFileFor(projectFile);
        juce::Array<juce::File> files;
        folder.findChildFiles(files, juce::File::findFiles, false, "*.beat");
        out.reserve((size_t) files.size());

        for (const auto& file : files)
        {
            if (!file.existsAsFile())
                continue;

            ProjectDocumentBackupEntry entry;
            entry.file = file;
            entry.modifiedAt = file.getLastModificationTime();
            entry.sizeBytes = file.getSize();
            entry.latest = file == latest || file.getFileName().equalsIgnoreCase("Latest.beat");
            out.push_back(std::move(entry));
        }

        std::sort(out.begin(), out.end(), [](const auto& a, const auto& b)
        {
            if (a.latest != b.latest)
                return a.latest;
            return a.modifiedAt > b.modifiedAt;
        });
        return out;
    }

    bool createProjectBackupBeforeReplace(const juce::File& projectFile,
                                          juce::String& error,
                                          juce::File* latestBackup)
    {
        if (latestBackup != nullptr)
            *latestBackup = juce::File();

        if (!projectFile.existsAsFile())
            return true;

        const auto folder = projectBackupFolderFor(projectFile);
        if (!folder.exists() && !folder.createDirectory())
        {
            error = "Could not create project backup directory.";
            return false;
        }

        const auto latest = latestProjectBackupFileFor(projectFile);
        if (latest.existsAsFile() && !latest.deleteFile())
        {
            error = "Could not replace previous latest project backup.";
            return false;
        }

        if (!projectFile.copyFileTo(latest))
        {
            error = "Could not write latest project backup.";
            return false;
        }

        const auto snapshot = uniqueTimestampedBackupFile(folder, safeProjectBackupName(projectFile));
        if (!projectFile.copyFileTo(snapshot))
        {
            error = "Could not write timestamped project backup.";
            latest.deleteFile();
            return false;
        }

        pruneOldTimestampedBackups(folder);

        if (latestBackup != nullptr)
            *latestBackup = latest;
        return true;
    }

    bool restoreProjectBackup(const juce::File& projectFile,
                              const juce::File& backupFile,
                              juce::String& error,
                              juce::File* overwrittenBackup)
    {
        if (overwrittenBackup != nullptr)
            *overwrittenBackup = juce::File();

        if (projectFile == juce::File() || projectFile.isDirectory())
        {
            error = "Project restore target is not a file.";
            return false;
        }

        if (!backupFile.existsAsFile())
        {
            error = "Project backup file no longer exists.";
            return false;
        }

        const auto backupFolder = projectBackupFolderFor(projectFile);
        if (!fileLivesInsideDirectory(backupFile, backupFolder))
        {
            error = "Project backup is outside this project's backup folder.";
            return false;
        }

        const auto parsedBackup = juce::JSON::parse(backupFile);
        if (!parsedBackup.isObject())
        {
            error = "Project backup failed validation.";
            return false;
        }

        const auto integrityReport = verifyProjectDocumentIntegrity(parsedBackup, projectFile);
        if (hasFatalProjectDocumentIntegrityErrors(integrityReport))
        {
            error = "Project backup has invalid project structure.";
            return false;
        }

        const auto parent = projectFile.getParentDirectory();
        if (!parent.exists() && !parent.createDirectory())
        {
            error = "Could not create project directory.";
            return false;
        }

        const auto tempFile = parent.getChildFile(projectFile.getFileName() + ".restore.tmp");
        if (tempFile.existsAsFile() && !tempFile.deleteFile())
        {
            error = "Could not clear previous restore temporary file.";
            return false;
        }

        if (!backupFile.copyFileTo(tempFile))
        {
            error = "Could not stage project backup for restore.";
            return false;
        }

        if (!juce::JSON::parse(tempFile).isObject())
        {
            tempFile.deleteFile();
            error = "Staged project backup failed validation.";
            return false;
        }

        juce::File priorBackup;
        if (!createProjectBackupBeforeReplace(projectFile, error, &priorBackup))
        {
            tempFile.deleteFile();
            return false;
        }

        if (!tempFile.replaceFileIn(projectFile))
        {
            tempFile.deleteFile();
            error = "Could not finalize project restore.";
            return false;
        }

        if (overwrittenBackup != nullptr)
            *overwrittenBackup = priorBackup;
        return true;
    }
}
