#include "ManagedSpectralAsset.h"

#include "ProjectAssetPackage.h"
#include "../Audio/Sampler/SfzSampleDecoder.h"
#include "../Audio/Sampler/SfzSampleResolver.h"
#include "../Audio/Spectral/SpectralAnalyzer.h"

#include <juce_cryptography/juce_cryptography.h>

#include <cmath>
#include <sys/stat.h>

namespace beat
{
    namespace
    {
        constexpr int manifestSchemaVersion = 1;

        bool isRegularFileWithoutSymlink(const juce::File& file)
        {
            struct stat status {};
            return ::lstat(file.getFullPathName().toRawUTF8(), &status) == 0
                && S_ISREG(status.st_mode);
        }

        juce::String hashFile(const juce::File& file)
        {
            return isRegularFileWithoutSymlink(file)
                ? juce::SHA256(file).toHexString() : juce::String();
        }

        juce::String relativeToProject(const juce::File& projectFile,
                                       const juce::File& file)
        {
            const auto relative = file.getRelativePathFrom(projectFile.getParentDirectory());
            return relative.startsWithChar('.') ? relative : "./" + relative;
        }

        bool resolveManagedChild(const juce::File& root, const juce::String& relativePath,
                                 juce::File& resolved)
        {
            const auto normalized = relativePath.replaceCharacter('\\', '/');
            if (normalized.isEmpty() || juce::File::isAbsolutePath(normalized)) return false;
            juce::StringArray components;
            components.addTokens(normalized, "/", {});
            components.removeEmptyStrings();
            for (const auto& component : components)
                if (component == "." || component == "..") return false;
            resolved = root.getChildFile(normalized);
            const auto prefix = root.getFullPathName() + juce::File::getSeparatorString();
            return resolved.getFullPathName().startsWith(prefix)
                && isRegularFileWithoutSymlink(resolved);
        }

        struct CanonicalDecodeResult
        {
            std::shared_ptr<const juce::AudioBuffer<float>> audio;
            juce::String error;
        };

        CanonicalDecodeResult decodeCanonicalAudio(const juce::File& file)
        {
            CanonicalDecodeResult result;
            SfzSubsetImport parsed;
            parsed.sourceName = file.getFileName();
            SfzSubsetRegion region;
            region.samplePath = file.getFileName();
            parsed.regions.push_back(region);
            SfzSampleResolutionLimits resolutionLimits;
            resolutionLimits.maximumSampleFileBytes = 128LL * 1024 * 1024;
            resolutionLimits.maximumTotalUniqueSampleBytes
                = resolutionLimits.maximumSampleFileBytes;
            const auto resolved = resolveSfzSubsetSamples(parsed, file, resolutionLimits);
            if (!resolved.isAccepted())
            {
                result.error = "Spectral source path or descriptor identity could not be validated.";
                return result;
            }
            SfzSampleDecodeLimits decodeLimits;
            decodeLimits.maximumUniqueSamples = 1;
            decodeLimits.maximumChannels = 2;
            decodeLimits.maximumDecodedBytesPerSample = 32LL * 1024 * 1024;
            decodeLimits.maximumTotalDecodedBytes = decodeLimits.maximumDecodedBytesPerSample;
            const auto decoded = decodeSfzResolvedInstrument(resolved.instrument, decodeLimits);
            if (!decoded.isAccepted() || decoded.instrument->samples.size() != 1)
            {
                result.error = "Spectral source audio could not be decoded within fixed limits.";
                return result;
            }
            const auto& sample = decoded.instrument->samples.front();
            if (!sample.audio || std::abs(sample.sourceSampleRate - SpectralArtifact::sampleRate) > 0.01)
            {
                result.error = "Spectral analysis currently requires canonical 48 kHz audio.";
                return result;
            }
            if (sample.audio->getNumSamples() <= 0
                || sample.audio->getNumSamples() > SpectralArtifact::maxInputSamples)
            {
                result.error = "Spectral source exceeds the canonical duration limit.";
                return result;
            }
            result.audio = sample.audio;
            return result;
        }

        std::string hashCanonicalPcm(const juce::AudioBuffer<float>& pcm)
        {
            juce::MemoryOutputStream stream;
            for (int channel = 0; channel < pcm.getNumChannels(); ++channel)
                stream.write(pcm.getReadPointer(channel),
                    (size_t) pcm.getNumSamples() * sizeof(float));
            return juce::SHA256(stream.getData(), stream.getDataSize())
                .toHexString().toStdString();
        }

        bool writeBlock(const juce::File& file, const juce::MemoryBlock& bytes)
        {
            juce::FileOutputStream stream(file);
            if (!stream.openedOk() || !stream.write(bytes.getData(), bytes.getSize()))
                return false;
            stream.flush();
            return stream.getStatus().wasOk();
        }

        ManagedSpectralLoadResult failLoad(const juce::String& error)
        {
            ManagedSpectralLoadResult result;
            result.error = error;
            return result;
        }
    }

    ManagedSpectralImportResult importManagedSpectralAsset(const juce::File& audioFile,
                                                           const juce::File& projectFile,
                                                           int rootNote,
                                                           uint32_t seed)
    {
        ManagedSpectralImportResult result;
        if (!projectFile.hasFileExtension(".beat") || !projectFile.existsAsFile())
        {
            result.error = "Save the project to a .beat file before importing spectral audio.";
            return result;
        }
        if (!isRegularFileWithoutSymlink(audioFile)
            || !audioFile.hasFileExtension("wav;aif;aiff;flac"))
        {
            result.error = "Choose an existing regular audio file.";
            return result;
        }
        const auto decoded = decodeCanonicalAudio(audioFile);
        if (!decoded.audio)
        {
            result.error = decoded.error;
            return result;
        }
        const auto sourceHash = hashFile(audioFile);
        if (sourceHash.isEmpty())
        {
            result.error = "Could not hash the spectral source.";
            return result;
        }
        const auto analysis = SpectralAnalyzer::analyze(*decoded.audio, rootNote, seed);
        if (!analysis.artifact)
        {
            result.error = "Spectral analysis failed: " + juce::String(analysis.code)
                + ": " + juce::String(analysis.message);
            return result;
        }
        const auto artifactBytes = serializeSpectralArtifact(*analysis.artifact);
        if (artifactBytes.getSize() == 0
            || artifactBytes.getSize() > SpectralArtifact::maxPayloadBytes)
        {
            result.error = "Spectral artifact exceeds the fixed 48 MiB budget.";
            return result;
        }
        result.sourceSha256 = sourceHash;
        result.artifactSha256 = juce::SHA256(artifactBytes).toHexString();
        result.artifactBytes = (int64_t) artifactBytes.getSize();
        result.assetId = "spectral-" + sourceHash.substring(0, 16) + "-"
            + result.artifactSha256.substring(0, 8);
        result.displayName = audioFile.getFileNameWithoutExtension();

        const auto root = projectSidecarFolderFor(projectFile).getChildFile("spectral");
        const auto destination = root.getChildFile(result.assetId);
        const auto manifestFile = destination.getChildFile("manifest.json");
        if (manifestFile.existsAsFile())
        {
            const auto existing = loadManagedSpectralAsset(manifestFile);
            if (!existing.ok())
            {
                result.error = "A conflicting managed spectral asset failed verification.";
                return result;
            }
            result.manifestPath = relativeToProject(projectFile, manifestFile);
            result.sourcePath = relativeToProject(projectFile,
                destination.getChildFile("source" + audioFile.getFileExtension().toLowerCase()));
            result.artifactPath = relativeToProject(projectFile,
                destination.getChildFile("artifact.aetherspectral"));
            return result;
        }
        if (!root.exists() && !root.createDirectory())
        {
            result.error = "Could not create the managed spectral asset directory.";
            return result;
        }
        const auto staging = root.getChildFile(".import-" + juce::Uuid().toString());
        if (!staging.createDirectory())
        {
            result.error = "Could not create the spectral import transaction.";
            return result;
        }
        const auto fail = [&](const juce::String& message)
        {
            staging.deleteRecursively();
            result.error = message;
        };
        const auto sourceName = "source" + audioFile.getFileExtension().toLowerCase();
        const auto stagedSource = staging.getChildFile(sourceName);
        const auto stagedArtifact = staging.getChildFile("artifact.aetherspectral");
        if (!audioFile.copyFileTo(stagedSource) || hashFile(stagedSource) != sourceHash)
        {
            fail("Could not copy and verify the spectral source.");
            return result;
        }
        if (!writeBlock(stagedArtifact, artifactBytes)
            || hashFile(stagedArtifact) != result.artifactSha256)
        {
            fail("Could not write and verify the spectral artifact.");
            return result;
        }
        juce::DynamicObject::Ptr manifest = new juce::DynamicObject();
        manifest->setProperty("schema", "beat.managed-spectral");
        manifest->setProperty("schemaVersion", manifestSchemaVersion);
        manifest->setProperty("artifactSchemaVersion", (int) SpectralArtifact::schemaVersion);
        manifest->setProperty("assetId", result.assetId);
        manifest->setProperty("displayName", result.displayName);
        manifest->setProperty("sourcePath", sourceName);
        manifest->setProperty("sourceSha256", sourceHash);
        manifest->setProperty("sourceBytes", (double) audioFile.getSize());
        manifest->setProperty("artifactPath", "artifact.aetherspectral");
        manifest->setProperty("artifactSha256", result.artifactSha256);
        manifest->setProperty("artifactBytes", (double) result.artifactBytes);
        manifest->setProperty("payloadSha256", juce::String(analysis.artifact->payloadSha256));
        manifest->setProperty("sampleRate", SpectralArtifact::sampleRate);
        manifest->setProperty("channels", decoded.audio->getNumChannels());
        manifest->setProperty("sourceSamples", analysis.artifact->sourceSamples);
        manifest->setProperty("rootNote", analysis.artifact->rootNote);
        manifest->setProperty("deterministicSeed", (double) analysis.artifact->deterministicSeed);
        if (!staging.getChildFile("manifest.json").replaceWithText(
                juce::JSON::toString(juce::var(manifest.get()), true)))
        {
            fail("Could not write the spectral asset manifest.");
            return result;
        }
        if (!staging.moveFileTo(destination))
        {
            fail("Could not atomically publish the spectral asset.");
            return result;
        }
        if (!loadManagedSpectralAsset(manifestFile).ok())
        {
            destination.deleteRecursively();
            result.error = "The spectral asset failed verification after publication.";
            return result;
        }
        result.manifestPath = relativeToProject(projectFile, manifestFile);
        result.sourcePath = relativeToProject(projectFile, destination.getChildFile(sourceName));
        result.artifactPath = relativeToProject(projectFile,
            destination.getChildFile("artifact.aetherspectral"));
        return result;
    }

    ManagedSpectralLoadResult loadManagedSpectralAsset(const juce::File& manifestFile)
    {
        if (!isRegularFileWithoutSymlink(manifestFile))
            return failLoad("Managed spectral manifest is missing.");
        const auto manifest = juce::JSON::parse(manifestFile);
        if (!manifest.isObject()
            || manifest.getProperty("schema", {}).toString() != "beat.managed-spectral"
            || (int) manifest.getProperty("schemaVersion", 0) != manifestSchemaVersion
            || (int) manifest.getProperty("artifactSchemaVersion", 0)
                != (int) SpectralArtifact::schemaVersion)
            return failLoad("Managed spectral manifest schema is unsupported.");
        const auto sourceHash = manifest.getProperty("sourceSha256", {}).toString();
        const auto artifactHash = manifest.getProperty("artifactSha256", {}).toString();
        const auto assetId = manifest.getProperty("assetId", {}).toString();
        juce::File sourceFile, artifactFile;
        if (sourceHash.isEmpty() || artifactHash.isEmpty()
            || assetId != "spectral-" + sourceHash.substring(0, 16) + "-"
                + artifactHash.substring(0, 8)
            || !resolveManagedChild(manifestFile.getParentDirectory(),
                manifest.getProperty("sourcePath", {}).toString(), sourceFile)
            || !resolveManagedChild(manifestFile.getParentDirectory(),
                manifest.getProperty("artifactPath", {}).toString(), artifactFile)
            || sourceFile.getSize() != (int64_t) (double) manifest.getProperty("sourceBytes", -1.0)
            || artifactFile.getSize() != (int64_t) (double) manifest.getProperty("artifactBytes", -1.0)
            || artifactFile.getSize() <= 0
            || artifactFile.getSize() > (int64_t) SpectralArtifact::maxPayloadBytes
            || hashFile(sourceFile) != sourceHash || hashFile(artifactFile) != artifactHash)
            return failLoad("Managed spectral files failed path, size, or hash verification.");

        juce::MemoryBlock bytes;
        if (!artifactFile.loadFileAsData(bytes)
            || bytes.getSize() != (size_t) artifactFile.getSize())
            return failLoad("Managed spectral artifact could not be read within its bound.");
        auto decoded = decodeSpectralArtifact(bytes.getData(), bytes.getSize());
        if (!decoded.artifact)
            return failLoad("Managed spectral artifact is invalid: " + juce::String(decoded.code));
        const auto& artifact = *decoded.artifact;
        const auto sourceDecode = decodeCanonicalAudio(sourceFile);
        if (!sourceDecode.audio)
            return failLoad("Managed spectral source could not be decoded: " + sourceDecode.error);
        if (artifact.payloadSha256 != manifest.getProperty("payloadSha256", {}).toString().toStdString()
            || artifact.sourceSamples != (int) manifest.getProperty("sourceSamples", 0)
            || sourceDecode.audio->getNumSamples() != artifact.sourceSamples
            || sourceDecode.audio->getNumChannels() != (int) manifest.getProperty("channels", 0)
            || hashCanonicalPcm(*sourceDecode.audio) != artifact.sourcePcmSha256
            || artifact.rootNote != (int) manifest.getProperty("rootNote", -1)
            || artifact.deterministicSeed
                != (uint32_t) (int64_t) (double) manifest.getProperty("deterministicSeed", -1.0)
            || (int) manifest.getProperty("sampleRate", 0) != SpectralArtifact::sampleRate)
            return failLoad("Managed spectral artifact metadata does not match its manifest.");
        if (hashFile(sourceFile) != sourceHash || hashFile(artifactFile) != artifactHash)
            return failLoad("Managed spectral files changed during verification.");
        ManagedSpectralLoadResult result;
        result.artifact = std::make_shared<const SpectralArtifact>(std::move(*decoded.artifact));
        return result;
    }
}
