#include "ManagedSfzAsset.h"

#include "ProjectAssetPackage.h"

#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_cryptography/juce_cryptography.h>

#include <algorithm>
#include <map>
#include <set>
#include <sys/stat.h>

namespace beat
{
    namespace
    {
        constexpr int managedSfzSchemaVersion = 1;

        bool isRegularFileWithoutSymlink(const juce::File& file)
        {
            struct stat status {};
            return ::lstat(file.getFullPathName().toRawUTF8(), &status) == 0
                && S_ISREG(status.st_mode);
        }

        bool resolveManagedChild(const juce::File& root, const juce::String& relativePath,
                                 juce::File& resolved)
        {
            auto normalized = relativePath.replaceCharacter('\\', '/');
            if (normalized.isEmpty() || juce::File::isAbsolutePath(normalized))
                return false;
            juce::StringArray components;
            components.addTokens(normalized, "/", {});
            components.removeEmptyStrings();
            for (const auto& component : components)
                if (component == "." || component == "..")
                    return false;
            resolved = root.getChildFile(normalized);
            const auto rootPrefix = root.getFullPathName() + juce::File::getSeparatorString();
            return resolved.getFullPathName().startsWith(rootPrefix)
                && isRegularFileWithoutSymlink(resolved);
        }

        juce::String hashFile(const juce::File& file)
        {
            return isRegularFileWithoutSymlink(file)
                ? juce::SHA256(file).toHexString() : juce::String();
        }

        juce::String safeName(const juce::String& value)
        {
            const auto retained = value.retainCharacters(
                "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789 -_().").trim();
            return retained.isNotEmpty() ? retained : juce::String("asset");
        }

        juce::String relativeToProject(const juce::File& projectFile, const juce::File& file)
        {
            auto relative = file.getRelativePathFrom(projectFile.getParentDirectory());
            return relative.startsWithChar('.') ? relative : "./" + relative;
        }

        juce::var diagnosticToVar(const SfzDiagnostic& diagnostic)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("severity", diagnostic.severity == SfzDiagnosticSeverity::error ? "error" : "warning");
            object->setProperty("code", diagnostic.code);
            object->setProperty("message", diagnostic.message);
            object->setProperty("line", diagnostic.line);
            object->setProperty("column", diagnostic.column);
            return juce::var(object.get());
        }

        juce::var regionToVar(const SfzSubsetRegion& region, const juce::String& sampleId)
        {
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("sampleId", sampleId);
            object->setProperty("rootNote", region.rootNote);
            object->setProperty("loNote", region.loNote);
            object->setProperty("hiNote", region.hiNote);
            object->setProperty("loVelocity", region.loVelocity);
            object->setProperty("hiVelocity", region.hiVelocity);
            object->setProperty("tuneCents", region.tuneCents);
            object->setProperty("volumeDb", region.volumeDb);
            object->setProperty("panPercent", region.panPercent);
            object->setProperty("offsetFrames", (double) region.offsetFrames);
            object->setProperty("endFrame", (double) region.endFrame);
            object->setProperty("loopMode", region.loopMode);
            object->setProperty("loopStartFrame", (double) region.loopStartFrame);
            object->setProperty("loopEndFrame", (double) region.loopEndFrame);
            object->setProperty("group", region.group);
            object->setProperty("offBy", region.offBy);
            object->setProperty("sequenceLength", region.sequenceLength);
            object->setProperty("sequencePosition", region.sequencePosition);
            object->setProperty("trigger", region.trigger);
            object->setProperty("sourceLine", region.sourceLine);
            return juce::var(object.get());
        }

        bool readRegion(const juce::var& value, SfzSubsetRegion& region, juce::String& sampleId)
        {
            if (!value.isObject()) return false;
            sampleId = value.getProperty("sampleId", {}).toString();
            region.rootNote = juce::jlimit(0, 127, (int) value.getProperty("rootNote", 60));
            region.loNote = juce::jlimit(0, 127, (int) value.getProperty("loNote", 0));
            region.hiNote = juce::jlimit(region.loNote, 127, (int) value.getProperty("hiNote", 127));
            region.loVelocity = juce::jlimit(0, 127, (int) value.getProperty("loVelocity", 0));
            region.hiVelocity = juce::jlimit(region.loVelocity, 127, (int) value.getProperty("hiVelocity", 127));
            region.tuneCents = (double) value.getProperty("tuneCents", 0.0);
            region.volumeDb = (double) value.getProperty("volumeDb", 0.0);
            region.panPercent = (double) value.getProperty("panPercent", 0.0);
            region.offsetFrames = (int64_t) (double) value.getProperty("offsetFrames", 0.0);
            region.endFrame = (int64_t) (double) value.getProperty("endFrame", 0.0);
            region.loopMode = value.getProperty("loopMode", "no_loop").toString();
            region.loopStartFrame = (int64_t) (double) value.getProperty("loopStartFrame", 0.0);
            region.loopEndFrame = (int64_t) (double) value.getProperty("loopEndFrame", 0.0);
            region.group = (int) value.getProperty("group", 0);
            region.offBy = (int) value.getProperty("offBy", 0);
            region.sequenceLength = (int) value.getProperty("sequenceLength", 1);
            region.sequencePosition = (int) value.getProperty("sequencePosition", 1);
            region.trigger = value.getProperty("trigger", "attack").toString();
            region.sourceLine = juce::jmax(1, (int) value.getProperty("sourceLine", 1));
            return sampleId.isNotEmpty();
        }

        bool unsupportedPlaybackSemantics(const SfzResolvedInstrument& instrument, juce::String& error)
        {
            for (const auto& region : instrument.regions)
            {
                if (region.definition.sequenceLength != 1 || region.definition.sequencePosition != 1)
                    error = "Sequence opcodes are not supported by Aether Sample Slot 1.";
                else if (region.definition.trigger != "attack")
                    error = "Release-trigger regions are not supported by Aether Sample Slot 1.";
                else if (region.definition.group != 0 || region.definition.offBy != 0)
                    error = "SFZ group/off_by behavior is not supported by Aether Sample Slot 1.";
                if (error.isNotEmpty()) return true;
            }
            return false;
        }

        void addDecodeError(SfzSampleDecodeResult& result, juce::String code, juce::String message)
        {
            result.diagnostics.push_back({ SfzDiagnosticSeverity::error, std::move(code), std::move(message), 1, 1 });
            ++result.errorCount;
        }
    }

    ManagedSfzImportResult importManagedSfzAsset(const juce::File& sfzFile,
                                                 const juce::File& projectFile)
    {
        ManagedSfzImportResult result;
        if (!projectFile.hasFileExtension(".beat") || !projectFile.existsAsFile())
        {
            result.error = "Save the project to a .beat file before importing an SFZ instrument.";
            return result;
        }
        if (!sfzFile.existsAsFile() || !sfzFile.hasFileExtension(".sfz"))
        {
            result.error = "Choose an existing .sfz file.";
            return result;
        }

        const auto parsed = parseSfzSubsetFile(sfzFile);
        result.diagnostics = parsed.diagnostics;
        if (!parsed.isAccepted())
        {
            result.error = "The SFZ file is outside Beat's supported bounded subset.";
            return result;
        }
        const auto resolved = resolveSfzSubsetSamples(parsed, sfzFile);
        result.diagnostics.insert(result.diagnostics.end(), resolved.diagnostics.begin(), resolved.diagnostics.end());
        if (!resolved.isAccepted())
        {
            result.error = "One or more SFZ sample references could not be validated.";
            return result;
        }
        if (unsupportedPlaybackSemantics(*resolved.instrument, result.error))
            return result;

        // Decode before any copy so an unreadable or oversized sample cannot leave a managed asset behind.
        const auto decoded = decodeSfzResolvedInstrument(resolved.instrument);
        result.diagnostics.insert(result.diagnostics.end(), decoded.diagnostics.begin(), decoded.diagnostics.end());
        if (!decoded.isAccepted())
        {
            result.error = "One or more SFZ samples could not be decoded safely.";
            return result;
        }

        const auto sourceHash = hashFile(sfzFile);
        juce::String identityMaterial = sourceHash;
        std::map<juce::String, juce::String> sampleHashByPath;
        std::map<juce::String, juce::String> sampleIdByPath;
        for (const auto& region : resolved.instrument->regions)
        {
            const auto path = region.sampleFile.getFullPathName();
            if (sampleHashByPath.count(path) != 0) continue;
            const auto hash = hashFile(region.sampleFile);
            if (hash.isEmpty())
            {
                result.error = "Could not hash an SFZ sample before import.";
                return result;
            }
            sampleHashByPath[path] = hash;
            sampleIdByPath[path] = "sample-" + hash.substring(0, 20);
            identityMaterial += "\n" + hash;
        }
        result.assetId = "sfz-" + juce::SHA256(identityMaterial.toUTF8()).toHexString().substring(0, 24);
        result.displayName = sfzFile.getFileNameWithoutExtension();

        const auto sfzRoot = projectSidecarFolderFor(projectFile).getChildFile("sfz");
        const auto destination = sfzRoot.getChildFile(result.assetId);
        const auto manifestFile = destination.getChildFile("manifest.json");
        if (manifestFile.existsAsFile())
        {
            const auto existing = loadManagedSfzAsset(manifestFile);
            if (existing.isAccepted())
            {
                result.manifestPath = relativeToProject(projectFile, manifestFile);
                result.sourcePath = relativeToProject(projectFile, destination.getChildFile("source.sfz"));
                const auto manifest = juce::JSON::parse(manifestFile);
                if (const auto* samples = manifest.getProperty("samples", {}).getArray())
                    for (const auto& sample : *samples)
                        result.sampleFiles.push_back({ sample.getProperty("id", {}).toString(),
                                                       relativeToProject(projectFile, destination.getChildFile(sample.getProperty("path", {}).toString())),
                                                       sample.getProperty("sha256", {}).toString(),
                                                       (int64_t) (double) sample.getProperty("byteSize", 0.0) });
                return result;
            }
            result.error = "A conflicting managed SFZ asset already exists and failed verification.";
            return result;
        }

        if (!sfzRoot.exists() && !sfzRoot.createDirectory())
        {
            result.error = "Could not create the project's managed SFZ directory.";
            return result;
        }
        const auto staging = sfzRoot.getChildFile(".import-" + juce::Uuid().toString());
        const auto stagingSamples = staging.getChildFile("samples");
        if (!stagingSamples.createDirectory())
        {
            result.error = "Could not create a temporary SFZ import transaction.";
            return result;
        }

        const auto fail = [&](const juce::String& message)
        {
            staging.deleteRecursively();
            result.error = message;
        };
        const auto copiedSource = staging.getChildFile("source.sfz");
        if (!sfzFile.copyFileTo(copiedSource) || hashFile(copiedSource) != sourceHash)
        {
            fail("Could not copy and verify the SFZ source file.");
            return result;
        }

        juce::Array<juce::var> samples;
        std::map<juce::String, juce::String> relativeSampleBySource;
        for (const auto& [sourcePath, hash] : sampleHashByPath)
        {
            const juce::File source(sourcePath);
            const auto id = sampleIdByPath[sourcePath];
            const auto relative = "samples/" + id + "-" + safeName(source.getFileName());
            const auto copied = staging.getChildFile(relative);
            if (!source.copyFileTo(copied) || hashFile(copied) != hash)
            {
                fail("Could not copy and verify SFZ sample: " + source.getFileName());
                return result;
            }
            relativeSampleBySource[sourcePath] = relative;
            juce::DynamicObject::Ptr object = new juce::DynamicObject();
            object->setProperty("id", id);
            object->setProperty("path", relative);
            object->setProperty("sha256", hash);
            object->setProperty("byteSize", (double) source.getSize());
            samples.add(juce::var(object.get()));
        }

        juce::Array<juce::var> regions;
        for (const auto& region : resolved.instrument->regions)
            regions.add(regionToVar(region.definition, sampleIdByPath[region.sampleFile.getFullPathName()]));
        juce::Array<juce::var> diagnostics;
        for (const auto& diagnostic : result.diagnostics)
            diagnostics.add(diagnosticToVar(diagnostic));

        juce::DynamicObject::Ptr manifest = new juce::DynamicObject();
        manifest->setProperty("schema", "beat.managed-sfz");
        manifest->setProperty("schemaVersion", managedSfzSchemaVersion);
        manifest->setProperty("assetId", result.assetId);
        manifest->setProperty("displayName", result.displayName);
        manifest->setProperty("sourcePath", "source.sfz");
        manifest->setProperty("sourceSha256", sourceHash);
        manifest->setProperty("samples", samples);
        manifest->setProperty("regions", regions);
        manifest->setProperty("diagnostics", diagnostics);

        const auto stagingManifest = staging.getChildFile("manifest.json");
        if (!stagingManifest.replaceWithText(juce::JSON::toString(juce::var(manifest.get()), true)))
        {
            fail("Could not write the managed SFZ manifest.");
            return result;
        }
        if (!staging.moveFileTo(destination))
        {
            fail("Could not atomically publish the managed SFZ instrument.");
            return result;
        }

        const auto verification = loadManagedSfzAsset(manifestFile);
        if (!verification.isAccepted())
        {
            destination.deleteRecursively();
            result.error = "The managed SFZ instrument failed verification after publication.";
            return result;
        }

        result.manifestPath = relativeToProject(projectFile, manifestFile);
        result.sourcePath = relativeToProject(projectFile, destination.getChildFile("source.sfz"));
        for (const auto& [sourcePath, hash] : sampleHashByPath)
            result.sampleFiles.push_back({ sampleIdByPath[sourcePath],
                                           relativeToProject(projectFile, destination.getChildFile(relativeSampleBySource[sourcePath])),
                                           hash,
                                           juce::File(sourcePath).getSize() });
        return result;
    }

    SfzSampleDecodeResult loadManagedSfzAsset(const juce::File& manifestFile)
    {
        SfzSampleDecodeResult result;
        if (!isRegularFileWithoutSymlink(manifestFile))
        {
            addDecodeError(result, "sfz.managed.missing", "Managed SFZ manifest is missing.");
            return result;
        }
        const auto manifest = juce::JSON::parse(manifestFile);
        if (!manifest.isObject()
            || manifest.getProperty("schema", {}).toString() != "beat.managed-sfz"
            || (int) manifest.getProperty("schemaVersion", 0) != managedSfzSchemaVersion)
        {
            addDecodeError(result, "sfz.managed.schema", "Managed SFZ manifest schema is unsupported.");
            return result;
        }

        const auto root = manifestFile.getParentDirectory();
        juce::File source;
        if (!resolveManagedChild(root, manifest.getProperty("sourcePath", {}).toString(), source)
            || hashFile(source) != manifest.getProperty("sourceSha256", {}).toString())
        {
            addDecodeError(result, "sfz.managed.source-integrity", "Managed SFZ source hash does not match its manifest.");
            return result;
        }

        struct SampleEntry { juce::File file; int64_t bytes { 0 }; };
        std::map<juce::String, SampleEntry> samplesById;
        const auto* samples = manifest.getProperty("samples", {}).getArray();
        const auto* regions = manifest.getProperty("regions", {}).getArray();
        if (samples == nullptr || regions == nullptr || samples->isEmpty() || regions->isEmpty())
        {
            addDecodeError(result, "sfz.managed.empty", "Managed SFZ manifest contains no playable regions.");
            return result;
        }
        for (const auto& sample : *samples)
        {
            const auto id = sample.getProperty("id", {}).toString();
            const auto relativePath = sample.getProperty("path", {}).toString();
            juce::File file;
            if (id.isEmpty() || !resolveManagedChild(root, relativePath, file)
                || hashFile(file) != sample.getProperty("sha256", {}).toString()
                || file.getSize() != (int64_t) (double) sample.getProperty("byteSize", -1.0))
            {
                addDecodeError(result, "sfz.managed.sample-integrity", "Managed SFZ sample failed path or hash verification.");
                return result;
            }
            samplesById[id] = { file, file.getSize() };
        }

        SfzSubsetImport parsed;
        parsed.sourceName = source.getFileName();
        parsed.regions.reserve((size_t) regions->size());
        for (const auto& value : *regions)
        {
            SfzSubsetRegion definition;
            juce::String sampleId;
            if (!readRegion(value, definition, sampleId) || samplesById.count(sampleId) == 0)
            {
                addDecodeError(result, "sfz.managed.region", "Managed SFZ region references an unknown sample.");
                return result;
            }
            const auto& sample = samplesById[sampleId];
            definition.samplePath = sample.file.getRelativePathFrom(root);
            parsed.regions.push_back(std::move(definition));
        }
        const auto resolution = resolveSfzSubsetSamples(parsed, source);
        result.diagnostics.insert(result.diagnostics.end(), resolution.diagnostics.begin(), resolution.diagnostics.end());
        result.warningCount += resolution.warningCount;
        result.errorCount += resolution.errorCount;
        if (!resolution.isAccepted())
            return result;
        return decodeSfzResolvedInstrument(resolution.instrument);
    }
}
