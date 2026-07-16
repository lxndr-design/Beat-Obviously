#include "ManagedGranularAsset.h"

#include "ProjectAssetPackage.h"
#include "../Audio/Sampler/SfzSampleDecoder.h"
#include "../Audio/Sampler/SfzSampleResolver.h"

#include <juce_cryptography/juce_cryptography.h>

#include <cmath>
#include <sys/stat.h>

namespace beat
{
    namespace
    {
        constexpr int schemaVersion = 1;

        bool isRegularFileWithoutSymlink(const juce::File& file)
        {
            struct stat status {};
            return ::lstat(file.getFullPathName().toRawUTF8(), &status) == 0 && S_ISREG(status.st_mode);
        }

        juce::String hashFile(const juce::File& file)
        {
            return isRegularFileWithoutSymlink(file) ? juce::SHA256(file).toHexString() : juce::String();
        }

        juce::String relativeToProject(const juce::File& projectFile, const juce::File& file)
        {
            const auto relative = file.getRelativePathFrom(projectFile.getParentDirectory());
            return relative.startsWithChar('.') ? relative : "./" + relative;
        }

        bool resolveManagedChild(const juce::File& root, const juce::String& relativePath, juce::File& resolved)
        {
            const auto normalized = relativePath.replaceCharacter('\\', '/');
            if (normalized.isEmpty() || juce::File::isAbsolutePath(normalized)) return false;
            juce::StringArray components;
            components.addTokens(normalized, "/", {});
            components.removeEmptyStrings();
            for (const auto& component : components)
                if (component == "." || component == "..") return false;
            resolved = root.getChildFile(normalized);
            const auto rootPrefix = root.getFullPathName() + juce::File::getSeparatorString();
            return resolved.getFullPathName().startsWith(rootPrefix) && isRegularFileWithoutSymlink(resolved);
        }

        ManagedGranularLoadResult decodeOne(const juce::File& file, const juce::File& resolutionAnchor)
        {
            ManagedGranularLoadResult result;
            SfzSubsetImport parsed;
            parsed.sourceName = resolutionAnchor.getFileName();
            SfzSubsetRegion region;
            region.samplePath = file.getRelativePathFrom(resolutionAnchor.getParentDirectory());
            parsed.regions.push_back(region);
            SfzSampleResolutionLimits resolutionLimits;
            resolutionLimits.maximumSampleFileBytes = 512LL * 1024 * 1024;
            resolutionLimits.maximumTotalUniqueSampleBytes = resolutionLimits.maximumSampleFileBytes;
            const auto resolved = resolveSfzSubsetSamples(parsed, resolutionAnchor, resolutionLimits);
            if (!resolved.isAccepted())
            {
                result.error = "Granular source path or descriptor identity could not be validated.";
                return result;
            }
            SfzSampleDecodeLimits decodeLimits;
            decodeLimits.maximumUniqueSamples = 1;
            decodeLimits.maximumChannels = ImmutableGranularSource::maximumChannels;
            decodeLimits.maximumDecodedBytesPerSample = 128LL * 1024 * 1024;
            decodeLimits.maximumTotalDecodedBytes = decodeLimits.maximumDecodedBytesPerSample;
            const auto decoded = decodeSfzResolvedInstrument(resolved.instrument, decodeLimits);
            if (!decoded.isAccepted() || decoded.instrument->samples.size() != 1)
            {
                result.error = "Granular source audio could not be decoded within the fixed limits.";
                return result;
            }
            const auto& sample = decoded.instrument->samples.front();
            if (!sample.audio || sample.audio->getNumSamples() > ImmutableGranularSource::maximumFrames)
            {
                result.error = "Granular source exceeds the 11,520,000-frame limit.";
                return result;
            }
            result.audio = sample.audio;
            result.sourceSampleRate = sample.sourceSampleRate;
            return result;
        }
    }

    ManagedGranularImportResult importManagedGranularAsset(const juce::File& audioFile,
                                                           const juce::File& projectFile)
    {
        ManagedGranularImportResult result;
        if (!projectFile.hasFileExtension(".beat") || !projectFile.existsAsFile())
        {
            result.error = "Save the project to a .beat file before importing granular audio.";
            return result;
        }
        if (!isRegularFileWithoutSymlink(audioFile)
            || !audioFile.hasFileExtension("wav;aif;aiff;flac"))
        {
            result.error = "Choose an existing regular audio file.";
            return result;
        }
        const auto decoded = decodeOne(audioFile, audioFile);
        if (!decoded.ok())
        {
            result.error = decoded.error;
            return result;
        }
        const auto sourceHash = hashFile(audioFile);
        if (sourceHash.isEmpty())
        {
            result.error = "Could not hash the granular source.";
            return result;
        }
        result.assetId = "granular-" + sourceHash.substring(0, 24);
        result.displayName = audioFile.getFileNameWithoutExtension();
        result.sha256 = sourceHash;
        result.byteSize = audioFile.getSize();

        const auto root = projectSidecarFolderFor(projectFile).getChildFile("granular");
        const auto destination = root.getChildFile(result.assetId);
        const auto manifestFile = destination.getChildFile("manifest.json");
        if (manifestFile.existsAsFile())
        {
            const auto existing = loadManagedGranularAsset(manifestFile);
            if (!existing.ok())
            {
                result.error = "A conflicting managed granular asset failed verification.";
                return result;
            }
            const auto existingManifest = juce::JSON::parse(manifestFile);
            juce::File existingAudio;
            if (!resolveManagedChild(destination,
                                     existingManifest.getProperty("audioPath", {}).toString(),
                                     existingAudio))
            {
                result.error = "The existing granular asset has no valid audio path.";
                return result;
            }
            result.manifestPath = relativeToProject(projectFile, manifestFile);
            result.audioPath = relativeToProject(projectFile, existingAudio);
            return result;
        }
        if (!root.exists() && !root.createDirectory())
        {
            result.error = "Could not create the managed granular asset directory.";
            return result;
        }
        const auto staging = root.getChildFile(".import-" + juce::Uuid().toString());
        if (!staging.createDirectory())
        {
            result.error = "Could not create the granular import transaction.";
            return result;
        }
        const auto fail = [&](const juce::String& message)
        {
            staging.deleteRecursively();
            result.error = message;
        };
        const auto relativeAudio = "source" + audioFile.getFileExtension().toLowerCase();
        const auto copiedAudio = staging.getChildFile(relativeAudio);
        if (!audioFile.copyFileTo(copiedAudio) || hashFile(copiedAudio) != sourceHash)
        {
            fail("Could not copy and verify the granular source.");
            return result;
        }
        juce::DynamicObject::Ptr manifest = new juce::DynamicObject();
        manifest->setProperty("schema", "beat.managed-granular");
        manifest->setProperty("schemaVersion", schemaVersion);
        manifest->setProperty("assetId", result.assetId);
        manifest->setProperty("displayName", result.displayName);
        manifest->setProperty("audioPath", relativeAudio);
        manifest->setProperty("sha256", sourceHash);
        manifest->setProperty("byteSize", (double) result.byteSize);
        manifest->setProperty("sampleRate", decoded.sourceSampleRate);
        manifest->setProperty("channels", decoded.audio->getNumChannels());
        manifest->setProperty("frames", decoded.audio->getNumSamples());
        if (!staging.getChildFile("manifest.json").replaceWithText(juce::JSON::toString(juce::var(manifest.get()), true)))
        {
            fail("Could not write the granular asset manifest.");
            return result;
        }
        if (!staging.moveFileTo(destination))
        {
            fail("Could not atomically publish the granular asset.");
            return result;
        }
        if (!loadManagedGranularAsset(manifestFile).ok())
        {
            destination.deleteRecursively();
            result.error = "The granular asset failed verification after publication.";
            return result;
        }
        result.manifestPath = relativeToProject(projectFile, manifestFile);
        result.audioPath = relativeToProject(projectFile, destination.getChildFile(relativeAudio));
        return result;
    }

    ManagedGranularLoadResult loadManagedGranularAsset(const juce::File& manifestFile)
    {
        ManagedGranularLoadResult result;
        if (!isRegularFileWithoutSymlink(manifestFile))
        {
            result.error = "Managed granular manifest is missing.";
            return result;
        }
        const auto manifest = juce::JSON::parse(manifestFile);
        if (!manifest.isObject() || manifest.getProperty("schema", {}).toString() != "beat.managed-granular"
            || (int) manifest.getProperty("schemaVersion", 0) != schemaVersion)
        {
            result.error = "Managed granular manifest schema is unsupported.";
            return result;
        }
        juce::File audioFile;
        const auto expectedHash = manifest.getProperty("sha256", {}).toString();
        if (!resolveManagedChild(manifestFile.getParentDirectory(), manifest.getProperty("audioPath", {}).toString(), audioFile)
            || audioFile.getSize() != (int64_t) (double) manifest.getProperty("byteSize", -1.0)
            || expectedHash.isEmpty() || hashFile(audioFile) != expectedHash
            || manifest.getProperty("assetId", {}).toString() != "granular-" + expectedHash.substring(0, 24))
        {
            result.error = "Managed granular audio failed path, size, or hash verification.";
            return result;
        }
        result = decodeOne(audioFile, manifestFile);
        if (!result.ok()) return result;
        if (hashFile(audioFile) != expectedHash
            || result.audio->getNumChannels() != (int) manifest.getProperty("channels", 0)
            || result.audio->getNumSamples() != (int) manifest.getProperty("frames", 0)
            || std::abs(result.sourceSampleRate - (double) manifest.getProperty("sampleRate", 0.0)) > 0.01)
        {
            result.audio.reset();
            result.error = "Managed granular decoded metadata does not match its manifest.";
        }
        return result;
    }

    std::shared_ptr<const juce::AudioBuffer<float>> makeGranularBenchmarkAudio()
    {
        constexpr int sampleRate = 48000;
        constexpr int frames = sampleRate * 4;
        auto audio = std::make_shared<juce::AudioBuffer<float>>(2, frames);
        for (int sample = 0; sample < frames; ++sample)
        {
            const double t = (double) sample / sampleRate;
            const double fade = std::sin(juce::MathConstants<double>::pi * (double) sample / (frames - 1));
            const double drift = 0.18 * std::sin(juce::MathConstants<double>::twoPi * 0.17 * t);
            const double left = std::sin(juce::MathConstants<double>::twoPi * (110.0 + drift) * t)
                + 0.42 * std::sin(juce::MathConstants<double>::twoPi * 220.0 * t + 0.3)
                + 0.18 * std::sin(juce::MathConstants<double>::twoPi * 440.0 * t + 0.8);
            const double right = std::sin(juce::MathConstants<double>::twoPi * (110.0 - drift) * t + 0.07)
                + 0.42 * std::sin(juce::MathConstants<double>::twoPi * 220.0 * t + 0.6)
                + 0.18 * std::sin(juce::MathConstants<double>::twoPi * 440.0 * t + 1.1);
            audio->setSample(0, sample, (float) (0.22 * fade * left));
            audio->setSample(1, sample, (float) (0.22 * fade * right));
        }
        return audio;
    }
}
