#include "ProjectAssetPackage.h"

#include <algorithm>
#include <cstdint>
#include <map>
#include <vector>

namespace beat
{
    namespace
    {
        bool isEphemeralAssetPath(const juce::String& path)
        {
            return path.startsWith("blob:") || path.startsWith("data:");
        }

        bool isUrlLikePath(const juce::String& path)
        {
            return path.contains("://") || isEphemeralAssetPath(path);
        }

        bool isAbsoluteFilePath(const juce::String& path)
        {
            return path.startsWithChar('/')
                || (path.length() >= 3
                    && path[1] == ':'
                    && (path[2] == '\\' || path[2] == '/'));
        }

        bool isProjectRelativeAssetPath(const juce::String& path)
        {
            return path.isNotEmpty()
                && !path.startsWith("/samples/")
                && !isUrlLikePath(path)
                && !isAbsoluteFilePath(path);
        }

        bool normalizedPathStartsWith(const juce::String& path, const juce::String& folder)
        {
            auto normalizedFolder = folder;
            if (!normalizedFolder.endsWithChar(juce::File::getSeparatorChar()))
                normalizedFolder += juce::String::charToString(juce::File::getSeparatorChar());
            return path == folder || path.startsWith(normalizedFolder);
        }

        juce::String sanitizeSidecarName(const juce::String& name)
        {
            auto sanitized = name.retainCharacters("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_().").trim();
            return sanitized.isNotEmpty() ? sanitized : "asset";
        }

        juce::String stableAssetPrefix(const juce::String& value)
        {
            std::uint32_t hash = 2166136261u;
            const auto utf8 = value.toRawUTF8();
            for (int i = 0; utf8[i] != 0; ++i)
            {
                hash ^= static_cast<std::uint8_t>(utf8[i]);
                hash *= 16777619u;
            }
            return juce::String::toHexString(static_cast<int>(hash)).paddedLeft('0', 8);
        }

        juce::String stableAssetId(const juce::String& kind, const juce::String& path)
        {
            std::uint32_t hash = 2166136261u;
            const auto input = kind + ":" + path;
            const auto utf8 = input.toRawUTF8();
            for (int i = 0; utf8[i] != 0; ++i)
            {
                hash ^= static_cast<std::uint8_t>(utf8[i]);
                hash *= 16777619u;
            }

            static constexpr char digits[] = "0123456789abcdefghijklmnopqrstuvwxyz";
            char buffer[16] {};
            int index = 15;
            auto value = hash;
            do
            {
                buffer[--index] = digits[value % 36u];
                value /= 36u;
            }
            while (value != 0u && index > 0);

            return "asset-" + kind + "-" + juce::String(buffer + index);
        }

        juce::String pathRelativeToProject(const juce::File& projectFile, const juce::File& assetFile)
        {
            auto relative = assetFile.getRelativePathFrom(projectFile.getParentDirectory());
            return relative.startsWithChar('.') ? relative : "./" + relative;
        }

        juce::String rewrittenAssetPath(const juce::StringPairArray& rewrites, const juce::String& path)
        {
            if (path.isEmpty())
                return path;
            return rewrites.getValue(path, path);
        }

        void rewriteObjectPath(juce::DynamicObject* object, const juce::StringPairArray& rewrites, const juce::Identifier& key)
        {
            if (object == nullptr)
                return;
            const auto path = object->getProperty(key).toString();
            const auto rewritten = rewrittenAssetPath(rewrites, path);
            if (rewritten != path)
                object->setProperty(key, rewritten);
        }

        void resolveObjectPath(juce::DynamicObject* object, const juce::File& projectFile, const juce::Identifier& key)
        {
            if (object == nullptr)
                return;
            const auto path = object->getProperty(key).toString();
            const auto resolved = resolveProjectRelativePath(projectFile, path);
            if (resolved != path)
                object->setProperty(key, resolved);
        }

        void rewriteInstrumentAssetPaths(juce::DynamicObject* instrument, const juce::StringPairArray& rewrites)
        {
            if (instrument == nullptr)
                return;

            rewriteObjectPath(instrument, rewrites, "sampleUrl");

            auto sampleUrlsVar = instrument->getProperty("sampleUrls");
            if (auto* sampleUrls = sampleUrlsVar.getArray())
            {
                for (int i = 0; i < sampleUrls->size(); ++i)
                    sampleUrls->set(i, rewrittenAssetPath(rewrites, sampleUrls->getReference(i).toString()));
                instrument->setProperty("sampleUrls", sampleUrlsVar);
            }

            auto sampleMapVar = instrument->getProperty("sampleMap");
            if (auto* sampleMap = sampleMapVar.getArray())
            {
                for (auto& zone : *sampleMap)
                {
                    if (auto* zoneObject = zone.getDynamicObject())
                    {
                        rewriteObjectPath(zoneObject, rewrites, "path");
                        rewriteObjectPath(zoneObject, rewrites, "sampleUrl");
                    }
                }
                instrument->setProperty("sampleMap", sampleMapVar);
            }
        }

        void resolveInstrumentAssetPaths(juce::DynamicObject* instrument, const juce::File& projectFile)
        {
            if (instrument == nullptr)
                return;

            resolveObjectPath(instrument, projectFile, "sampleUrl");

            auto sampleUrlsVar = instrument->getProperty("sampleUrls");
            if (auto* sampleUrls = sampleUrlsVar.getArray())
            {
                for (int i = 0; i < sampleUrls->size(); ++i)
                    sampleUrls->set(i, resolveProjectRelativePath(projectFile, sampleUrls->getReference(i).toString()));
                instrument->setProperty("sampleUrls", sampleUrlsVar);
            }

            auto sampleMapVar = instrument->getProperty("sampleMap");
            if (auto* sampleMap = sampleMapVar.getArray())
            {
                for (auto& zone : *sampleMap)
                {
                    if (auto* zoneObject = zone.getDynamicObject())
                    {
                        resolveObjectPath(zoneObject, projectFile, "path");
                        resolveObjectPath(zoneObject, projectFile, "sampleUrl");
                    }
                }
                instrument->setProperty("sampleMap", sampleMapVar);
            }
        }

        void rewriteDocumentAssetPaths(juce::var& document, const juce::StringPairArray& rewrites)
        {
            if (auto* documentObject = document.getDynamicObject())
            {
                auto audioFilesVar = documentObject->getProperty("audioFiles");
                if (auto* audioFiles = audioFilesVar.getArray())
                {
                    for (auto& audioFile : *audioFiles)
                        rewriteObjectPath(audioFile.getDynamicObject(), rewrites, "path");
                    documentObject->setProperty("audioFiles", audioFilesVar);
                }

                auto instrumentsVar = documentObject->getProperty("instruments");
                if (auto* instruments = instrumentsVar.getArray())
                {
                    for (auto& instrument : *instruments)
                        rewriteInstrumentAssetPaths(instrument.getDynamicObject(), rewrites);
                    documentObject->setProperty("instruments", instrumentsVar);
                }

                auto assetsVar = documentObject->getProperty("assets");
                if (auto* assets = assetsVar.getArray())
                {
                    for (auto& asset : *assets)
                        rewriteObjectPath(asset.getDynamicObject(), rewrites, "path");
                    documentObject->setProperty("assets", assetsVar);
                }
            }
        }

        juce::String assetSidecarKindFolder(const juce::String& kind)
        {
            if (kind == "audio") return "audio";
            if (kind == "plugin") return "plugins";
            return "samples";
        }

        juce::String assetPolicyForPath(const juce::String& path, const juce::String& kind)
        {
            if (kind == "plugin")
                return "plugin";
            return path.startsWith("/samples/") ? "bundled" : "external";
        }

        struct ManifestAsset
        {
            juce::String kind;
            juce::String path;
            juce::String name;
            juce::StringArray references;
        };

        void addManifestAsset(std::map<std::string, ManifestAsset>& assets,
                              const juce::String& kind,
                              const juce::String& path,
                              const juce::String& reference,
                              const juce::String& name = {})
        {
            const auto normalizedPath = path.trim();
            if (normalizedPath.isEmpty() || isEphemeralAssetPath(normalizedPath))
                return;

            const auto key = (kind + "\n" + normalizedPath).toStdString();
            auto& asset = assets[key];
            if (asset.path.isEmpty())
            {
                asset.kind = kind;
                asset.path = normalizedPath;
                asset.name = name;
            }
            else if (asset.name.isEmpty() && name.isNotEmpty())
            {
                asset.name = name;
            }

            if (reference.isNotEmpty())
                asset.references.addIfNotAlreadyThere(reference);
        }

        juce::var manifestAssetToVar(const ManifestAsset& asset)
        {
            juce::Array<juce::var> references;
            for (const auto& reference : asset.references)
                references.add(reference);

            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", stableAssetId(asset.kind, asset.path));
            object->setProperty("kind", asset.kind);
            object->setProperty("path", asset.path);
            if (asset.name.isNotEmpty())
                object->setProperty("name", asset.name);
            object->setProperty("policy", assetPolicyForPath(asset.path, asset.kind));
            object->setProperty("references", references);
            return juce::var(object.get());
        }

        void recordSidecarUsage(const juce::File& projectFile,
                                const juce::String& path,
                                juce::StringArray& usedSidecarFiles)
        {
            if (path.isEmpty() || path.startsWith("/samples/") || isUrlLikePath(path))
                return;

            const auto sidecarRoot = projectSidecarFolderFor(projectFile);
            const auto resolved = juce::File(resolveProjectRelativePath(projectFile, path));
            const auto sidecarRootPath = sidecarRoot.getFullPathName();
            const auto resolvedPath = resolved.getFullPathName();
            if (normalizedPathStartsWith(resolvedPath, sidecarRootPath))
                usedSidecarFiles.addIfNotAlreadyThere(resolvedPath);
        }

        void recordObjectPathUsage(const juce::var& value,
                                   const juce::File& projectFile,
                                   const juce::Identifier& key,
                                   juce::StringArray& usedSidecarFiles)
        {
            recordSidecarUsage(projectFile, value.getProperty(key, {}).toString(), usedSidecarFiles);
        }

        void collectDocumentSidecarUsage(const juce::var& document,
                                         const juce::File& projectFile,
                                         juce::StringArray& usedSidecarFiles)
        {
            if (auto* audioFiles = document.getProperty("audioFiles", {}).getArray())
            {
                for (const auto& audioFile : *audioFiles)
                    recordObjectPathUsage(audioFile, projectFile, "path", usedSidecarFiles);
            }

            if (auto* instruments = document.getProperty("instruments", {}).getArray())
            {
                for (const auto& instrument : *instruments)
                {
                    recordObjectPathUsage(instrument, projectFile, "sampleUrl", usedSidecarFiles);

                    if (auto* sampleUrls = instrument.getProperty("sampleUrls", {}).getArray())
                    {
                        for (const auto& sampleUrl : *sampleUrls)
                            recordSidecarUsage(projectFile, sampleUrl.toString(), usedSidecarFiles);
                    }

                    if (auto* sampleMap = instrument.getProperty("sampleMap", {}).getArray())
                    {
                        for (const auto& zone : *sampleMap)
                        {
                            recordObjectPathUsage(zone, projectFile, "path", usedSidecarFiles);
                            recordObjectPathUsage(zone, projectFile, "sampleUrl", usedSidecarFiles);
                        }
                    }
                }
            }

            if (auto* assets = document.getProperty("assets", {}).getArray())
            {
                for (const auto& asset : *assets)
                    recordObjectPathUsage(asset, projectFile, "path", usedSidecarFiles);
            }
        }
    }

    juce::File projectSidecarFolderFor(const juce::File& projectFile)
    {
        return projectFile.getSiblingFile(projectFile.getFileNameWithoutExtension() + " Assets");
    }

    juce::String resolveProjectRelativePath(const juce::File& projectFile, const juce::String& path)
    {
        if (!isProjectRelativeAssetPath(path))
            return path;
        return projectFile.getParentDirectory().getChildFile(path).getFullPathName();
    }

    void resolveDocumentAssetPaths(juce::var& document, const juce::File& projectFile)
    {
        if (auto* documentObject = document.getDynamicObject())
        {
            auto audioFilesVar = documentObject->getProperty("audioFiles");
            if (auto* audioFiles = audioFilesVar.getArray())
            {
                for (auto& audioFile : *audioFiles)
                    resolveObjectPath(audioFile.getDynamicObject(), projectFile, "path");
                documentObject->setProperty("audioFiles", audioFilesVar);
            }

            auto instrumentsVar = documentObject->getProperty("instruments");
            if (auto* instruments = instrumentsVar.getArray())
            {
                for (auto& instrument : *instruments)
                    resolveInstrumentAssetPaths(instrument.getDynamicObject(), projectFile);
                documentObject->setProperty("instruments", instrumentsVar);
            }

            auto assetsVar = documentObject->getProperty("assets");
            if (auto* assets = assetsVar.getArray())
            {
                for (auto& asset : *assets)
                    resolveObjectPath(asset.getDynamicObject(), projectFile, "path");
                documentObject->setProperty("assets", assetsVar);
            }
        }
    }

    juce::var buildDocumentAssetManifest(const juce::var& document)
    {
        std::map<std::string, ManifestAsset> assets;

        if (auto* audioFiles = document.getProperty("audioFiles", {}).getArray())
        {
            for (const auto& audioFile : *audioFiles)
            {
                const auto id = audioFile.getProperty("id", {}).toString();
                addManifestAsset(assets,
                                 "audio",
                                 audioFile.getProperty("path", {}).toString(),
                                 id.isNotEmpty() ? "audioFile:" + id : "audioFile",
                                 audioFile.getProperty("name", {}).toString());
            }
        }

        if (auto* instruments = document.getProperty("instruments", {}).getArray())
        {
            for (const auto& instrument : *instruments)
            {
                const auto instrumentId = instrument.getProperty("id", {}).toString();
                const auto instrumentName = instrument.getProperty("name", {}).toString();
                const auto referenceBase = instrumentId.isNotEmpty() ? "instrument:" + instrumentId : "instrument";

                addManifestAsset(assets,
                                 "sample",
                                 instrument.getProperty("sampleUrl", {}).toString(),
                                 referenceBase + ":sampleUrl",
                                 instrumentName);

                if (auto* sampleUrls = instrument.getProperty("sampleUrls", {}).getArray())
                {
                    for (int i = 0; i < sampleUrls->size(); ++i)
                    {
                        addManifestAsset(assets,
                                         "sample",
                                         sampleUrls->getReference(i).toString(),
                                         referenceBase + ":sampleUrls:" + juce::String(i),
                                         instrumentName);
                    }
                }

                if (auto* sampleMap = instrument.getProperty("sampleMap", {}).getArray())
                {
                    for (int i = 0; i < sampleMap->size(); ++i)
                    {
                        const auto& zone = sampleMap->getReference(i);
                        const auto zoneName = zone.getProperty("name", instrumentName).toString();
                        addManifestAsset(assets,
                                         "sample",
                                         zone.getProperty("path", {}).toString(),
                                         referenceBase + ":sampleMap:" + juce::String(i),
                                         zoneName);
                    }
                }
            }
        }

        if (auto* plugins = document.getProperty("plugins", {}).getArray())
        {
            for (const auto& plugin : *plugins)
            {
                const auto pluginId = plugin.getProperty("id", {}).toString();
                addManifestAsset(assets,
                                 "plugin",
                                 plugin.getProperty("sourcePath", plugin.getProperty("sourceFileName", {})).toString(),
                                 pluginId.isNotEmpty() ? "plugin:" + pluginId + ":sourcePath" : "plugin:sourcePath",
                                 plugin.getProperty("name", {}).toString());
            }
        }

        std::vector<ManifestAsset> sorted;
        sorted.reserve(assets.size());
        for (const auto& entry : assets)
            sorted.push_back(entry.second);

        std::sort(sorted.begin(), sorted.end(), [](const ManifestAsset& a, const ManifestAsset& b)
        {
            const auto kindCompare = a.kind.compare(b.kind);
            if (kindCompare != 0)
                return kindCompare < 0;
            return a.path.compare(b.path) < 0;
        });

        juce::Array<juce::var> manifest;
        for (const auto& asset : sorted)
            manifest.add(manifestAssetToVar(asset));

        return juce::var(manifest);
    }

    bool rebuildDocumentAssetManifest(juce::var& document)
    {
        auto* documentObject = document.getDynamicObject();
        if (documentObject == nullptr)
            return false;

        const auto before = juce::JSON::toString(documentObject->getProperty("assets"));
        const auto rebuilt = buildDocumentAssetManifest(document);
        const auto after = juce::JSON::toString(rebuilt);
        documentObject->setProperty("assets", rebuilt);
        return before != after;
    }

    bool packageExternalDocumentAssets(juce::var& document, const juce::File& projectFile, juce::String& error)
    {
        auto* documentObject = document.getDynamicObject();
        if (documentObject == nullptr)
            return true;

        auto assetsVar = documentObject->getProperty("assets");
        auto* assets = assetsVar.getArray();
        if (assets == nullptr)
            return true;

        const auto sidecarRoot = projectSidecarFolderFor(projectFile);
        juce::StringPairArray rewrites;

        for (auto& asset : *assets)
        {
            auto* assetObject = asset.getDynamicObject();
            if (assetObject == nullptr)
                continue;

            const auto path = assetObject->getProperty("path").toString();
            const auto policy = assetObject->getProperty("policy").toString();
            auto kind = assetObject->getProperty("kind").toString();
            if (kind.isEmpty())
                kind = "sample";

            if (path.isEmpty()
                || path.startsWith("/samples/")
                || isEphemeralAssetPath(path)
                || policy == "bundled"
                || policy == "plugin")
                continue;

            const juce::File source(path);
            if (!source.existsAsFile())
                continue;

            const auto destinationFolder = sidecarRoot.getChildFile(assetSidecarKindFolder(kind));
            if (!destinationFolder.exists() && !destinationFolder.createDirectory())
            {
                error = "Could not create project asset directory.";
                return false;
            }

            const auto destination = destinationFolder.getChildFile(
                stableAssetPrefix(source.getFullPathName()) + "-" + sanitizeSidecarName(source.getFileName()));

            if (!destination.existsAsFile() && !source.copyFileTo(destination))
            {
                error = "Could not copy project asset: " + source.getFullPathName();
                return false;
            }

            rewrites.set(path, pathRelativeToProject(projectFile, destination));
        }

        if (rewrites.size() > 0)
            rewriteDocumentAssetPaths(document, rewrites);

        documentObject->setProperty("assets", assetsVar);
        return true;
    }

    ProjectSidecarCleanupReport cleanupUnusedProjectSidecarAssets(const juce::var& document,
                                                                  const juce::File& projectFile)
    {
        ProjectSidecarCleanupReport report;
        const auto sidecarRoot = projectSidecarFolderFor(projectFile);
        if (!sidecarRoot.isDirectory())
            return report;

        juce::StringArray usedSidecarFiles;
        collectDocumentSidecarUsage(document, projectFile, usedSidecarFiles);

        juce::Array<juce::File> sidecarFiles;
        sidecarRoot.findChildFiles(sidecarFiles, juce::File::findFiles, true);

        for (const auto& file : sidecarFiles)
        {
            const auto path = file.getFullPathName();
            if (usedSidecarFiles.contains(path))
                continue;

            if (file.deleteFile())
            {
                ++report.deletedFiles;
                report.deletedPaths.add(path);
            }
            else
            {
                ++report.failedFiles;
                report.failedPaths.add(path);
            }
        }

        juce::Array<juce::File> sidecarDirectories;
        sidecarRoot.findChildFiles(sidecarDirectories, juce::File::findDirectories, true);
        for (int i = sidecarDirectories.size() - 1; i >= 0; --i)
        {
            const auto& dir = sidecarDirectories.getReference(i);
            if (dir.findChildFiles(juce::File::findFilesAndDirectories, false).isEmpty())
                dir.deleteFile();
        }

        return report;
    }
}
