#include "SfzSampleResolver.h"

#include <algorithm>
#include <filesystem>
#include <set>
#include <system_error>

#if JUCE_MAC || JUCE_LINUX
#include <sys/stat.h>
#endif

namespace beat
{
    namespace
    {
        void addDiagnostic(SfzSampleResolution& result,
                           const SfzSampleResolutionLimits& limits,
                           SfzDiagnosticSeverity severity,
                           juce::String code,
                           juce::String message,
                           int line = 1,
                           int column = 1)
        {
            if (severity == SfzDiagnosticSeverity::error)
                ++result.errorCount;
            else
                ++result.warningCount;
            if (result.diagnostics.size() < limits.maximumDiagnostics)
                result.diagnostics.push_back({ severity, std::move(code), std::move(message), line, column });
        }

        std::filesystem::path filesystemPath(const juce::File& file)
        {
            return std::filesystem::path(file.getFullPathName().toStdString());
        }

        bool isContainedBy(const std::filesystem::path& root,
                           const std::filesystem::path& candidate) noexcept
        {
            auto rootPart = root.begin();
            auto candidatePart = candidate.begin();
            for (; rootPart != root.end() && candidatePart != candidate.end();
                 ++rootPart, ++candidatePart)
                if (*rootPart != *candidatePart)
                    return false;
            return rootPart == root.end();
        }

        bool hasSupportedAudioExtension(const std::filesystem::path& path)
        {
            auto extension = juce::String(path.extension().string()).toLowerCase();
            return extension == ".wav" || extension == ".wave"
                || extension == ".aif" || extension == ".aiff"
                || extension == ".flac" || extension == ".ogg"
                || extension == ".mp3" || extension == ".m4a";
        }

        SfzNativeFileIdentity readNativeIdentity(const juce::File& file) noexcept
        {
            SfzNativeFileIdentity identity;
#if JUCE_MAC || JUCE_LINUX
            struct stat status {};
            if (::stat(file.getFullPathName().toRawUTF8(), &status) != 0
                || !S_ISREG(status.st_mode))
                return identity;
            identity.deviceId = (uint64_t) status.st_dev;
            identity.inode = (uint64_t) status.st_ino;
            identity.byteSize = (int64_t) status.st_size;
#if JUCE_MAC
            identity.modificationSeconds = status.st_mtimespec.tv_sec;
            identity.modificationNanoseconds = status.st_mtimespec.tv_nsec;
            identity.changeSeconds = status.st_ctimespec.tv_sec;
            identity.changeNanoseconds = status.st_ctimespec.tv_nsec;
#else
            identity.modificationSeconds = status.st_mtim.tv_sec;
            identity.modificationNanoseconds = status.st_mtim.tv_nsec;
            identity.changeSeconds = status.st_ctim.tv_sec;
            identity.changeNanoseconds = status.st_ctim.tv_nsec;
#endif
            identity.valid = true;
#endif
            return identity;
        }

        void inheritParserDiagnostics(const SfzSubsetImport& parsed,
                                      SfzSampleResolution& result,
                                      const SfzSampleResolutionLimits& limits)
        {
            result.warningCount = parsed.warningCount;
            result.errorCount = parsed.errorCount;
            const size_t count = std::min(parsed.diagnostics.size(), limits.maximumDiagnostics);
            result.diagnostics.insert(result.diagnostics.end(),
                                      parsed.diagnostics.begin(),
                                      parsed.diagnostics.begin() + (std::ptrdiff_t) count);
        }
    }

    SfzSampleResolution resolveSfzSubsetSamples(
        const SfzSubsetImport& parsed,
        const juce::File& sfzFile,
        const SfzSampleResolutionLimits& limits)
    {
        SfzSampleResolution result;
        inheritParserDiagnostics(parsed, result, limits);
        if (limits.maximumCandidatesPerNote == 0
            || limits.maximumCandidatesPerNote > SfzSampleResolutionLimits::hardMaximumCandidatesPerNote
            || limits.maximumSampleFileBytes <= 0
            || limits.maximumTotalUniqueSampleBytes <= 0)
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.resolve.limit-config", "Invalid SFZ sample-resolution limits");
            return result;
        }
        if (parsed.hasErrors() || parsed.regions.empty())
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.resolve.parse-rejected",
                          "SFZ sample resolution requires an accepted parsed document");
            return result;
        }
        if (!sfzFile.existsAsFile())
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.resolve.source-missing", "Selected SFZ file does not exist");
            return result;
        }

        std::error_code error;
        const auto canonicalSource = std::filesystem::canonical(filesystemPath(sfzFile), error);
        if (error)
        {
            addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                          "sfz.resolve.source-canonical", "Selected SFZ path cannot be canonicalized");
            return result;
        }
        const auto canonicalRoot = canonicalSource.parent_path();
        auto resolved = std::make_shared<SfzResolvedInstrument>();
        resolved->sourceFile = juce::File(canonicalSource.string());
        resolved->canonicalSampleRoot = juce::File(canonicalRoot.string());
        resolved->regions.reserve(parsed.regions.size());
        std::set<std::filesystem::path> uniqueSamples;

        for (size_t index = 0; index < parsed.regions.size(); ++index)
        {
            const auto& definition = parsed.regions[index];
            error.clear();
            const auto candidate = std::filesystem::canonical(
                canonicalRoot / std::filesystem::path(definition.samplePath.toStdString()), error);
            if (error)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.sample-missing",
                              "Referenced sample does not exist: " + definition.samplePath,
                              definition.sourceLine, 1);
                continue;
            }
            if (!isContainedBy(canonicalRoot, candidate))
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.root-escape",
                              "Referenced sample resolves outside the SFZ directory",
                              definition.sourceLine, 1);
                continue;
            }
            if (!std::filesystem::is_regular_file(candidate, error) || error)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.not-file", "Referenced sample is not a regular file",
                              definition.sourceLine, 1);
                continue;
            }
            if (!hasSupportedAudioExtension(candidate))
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.file-type", "Referenced file is not an approved audio type",
                              definition.sourceLine, 1);
                continue;
            }
            const auto rawSize = std::filesystem::file_size(candidate, error);
            if (error || rawSize > (uintmax_t) limits.maximumSampleFileBytes)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.file-size", "Referenced sample exceeds the per-file size limit",
                              definition.sourceLine, 1);
                continue;
            }
            error.clear();
            const auto lastWriteTime = std::filesystem::last_write_time(candidate, error);
            if (error)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.file-time", "Referenced sample identity cannot be recorded",
                              definition.sourceLine, 1);
                continue;
            }
            const auto nativeIdentity = readNativeIdentity(juce::File(candidate.string()));
#if JUCE_MAC || JUCE_LINUX
            if (!nativeIdentity.valid || nativeIdentity.byteSize != (int64_t) rawSize)
            {
                addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                              "sfz.resolve.native-identity",
                              "Referenced sample native identity cannot be recorded",
                              definition.sourceLine, 1);
                continue;
            }
#endif
            if (uniqueSamples.insert(candidate).second)
            {
                if (rawSize > (uintmax_t) (limits.maximumTotalUniqueSampleBytes
                                           - resolved->totalUniqueSampleBytes))
                {
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.resolve.total-size",
                                  "Unique referenced samples exceed the aggregate size limit",
                                  definition.sourceLine, 1);
                    continue;
                }
                resolved->totalUniqueSampleBytes += (int64_t) rawSize;
            }

            SfzResolvedRegion next;
            next.definition = definition;
            next.sampleFile = juce::File(candidate.string());
            next.sampleFileBytes = (int64_t) rawSize;
            next.sampleLastWriteTimeTicks = (int64_t) lastWriteTime.time_since_epoch().count();
            next.nativeIdentity = nativeIdentity;
            next.stableRegionIndex = (uint16_t) index;
            resolved->hasSequenceMetadata = resolved->hasSequenceMetadata
                || definition.sequenceLength != 1 || definition.sequencePosition != 1;
            resolved->regions.push_back(std::move(next));
        }

        if (result.hasErrors())
            return result;

        for (size_t regionIndex = 0; regionIndex < resolved->regions.size(); ++regionIndex)
        {
            const auto& region = resolved->regions[regionIndex].definition;
            for (int note = region.loNote; note <= region.hiNote; ++note)
            {
                auto& candidates = resolved->noteIndex[(size_t) note];
                if (candidates.count >= limits.maximumCandidatesPerNote)
                {
                    addDiagnostic(result, limits, SfzDiagnosticSeverity::error,
                                  "sfz.resolve.note-cap",
                                  "A MIDI note exceeds the bounded SFZ region-candidate limit",
                                  region.sourceLine, 1);
                    continue;
                }
                candidates.indices[candidates.count++] = (uint16_t) regionIndex;
            }
        }

        if (!result.hasErrors())
            result.instrument = std::move(resolved);
        return result;
    }
}
