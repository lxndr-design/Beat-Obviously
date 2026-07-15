#include "SfzSampleDecoder.h"

#include <cmath>
#include <filesystem>
#include <limits>
#include <map>
#include <system_error>

namespace beat
{
    namespace
    {
        void addDiagnostic(SfzSampleDecodeResult& result,
                           const SfzSampleDecodeLimits& limits,
                           juce::String code,
                           juce::String message,
                           int line = 1)
        {
            ++result.errorCount;
            if (result.diagnostics.size() < limits.maximumDiagnostics)
                result.diagnostics.push_back({ SfzDiagnosticSeverity::error,
                                               std::move(code), std::move(message), line, 1 });
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

        bool validLimits(const SfzSampleDecodeLimits& limits) noexcept
        {
            return limits.maximumUniqueSamples > 0
                && limits.maximumUniqueSamples <= std::numeric_limits<uint16_t>::max()
                && limits.maximumChannels > 0
                && limits.maximumChannels <= 32
                && limits.maximumDecodedBytesPerSample > 0
                && limits.maximumTotalDecodedBytes > 0;
        }
    }

    SfzSampleDecodeResult decodeSfzResolvedInstrument(
        std::shared_ptr<const SfzResolvedInstrument> resolved,
        const SfzSampleDecodeLimits& limits)
    {
        SfzSampleDecodeResult result;
        if (!validLimits(limits))
        {
            addDiagnostic(result, limits, "sfz.decode.limit-config", "Invalid SFZ decode limits");
            return result;
        }
        if (!resolved || resolved->regions.empty())
        {
            addDiagnostic(result, limits, "sfz.decode.source-missing",
                          "SFZ decode requires an accepted resolved instrument");
            return result;
        }

        std::error_code error;
        const auto canonicalRoot = std::filesystem::canonical(
            filesystemPath(resolved->canonicalSampleRoot), error);
        if (error)
        {
            addDiagnostic(result, limits, "sfz.decode.root-changed",
                          "SFZ sample root cannot be revalidated");
            return result;
        }

        juce::AudioFormatManager formats;
        formats.registerBasicFormats();
        auto decoded = std::make_shared<SfzDecodedInstrument>();
        decoded->resolvedSource = resolved;
        decoded->regions.reserve(resolved->regions.size());
        decoded->samples.reserve(std::min(limits.maximumUniqueSamples, resolved->regions.size()));
        std::map<std::filesystem::path, uint16_t> sampleIndices;

        for (const auto& region : resolved->regions)
        {
            error.clear();
            const auto canonicalSample = std::filesystem::canonical(
                filesystemPath(region.sampleFile), error);
            if (error || canonicalSample != filesystemPath(region.sampleFile)
                || !isContainedBy(canonicalRoot, canonicalSample))
            {
                addDiagnostic(result, limits, "sfz.decode.identity-changed",
                              "Resolved sample identity or containment changed before decode",
                              region.definition.sourceLine);
                continue;
            }

            auto found = sampleIndices.find(canonicalSample);
            uint16_t sampleIndex = 0;
            if (found != sampleIndices.end())
                sampleIndex = found->second;
            else
            {
                if (decoded->samples.size() >= limits.maximumUniqueSamples)
                {
                    addDiagnostic(result, limits, "sfz.decode.sample-cap",
                                  "SFZ exceeds the unique decoded-sample limit",
                                  region.definition.sourceLine);
                    continue;
                }

                auto input = std::make_unique<juce::FileInputStream>(region.sampleFile);
                if (!input->openedOk())
                {
                    addDiagnostic(result, limits, "sfz.decode.open",
                                  "Resolved sample cannot be opened",
                                  region.definition.sourceLine);
                    continue;
                }

                error.clear();
                const auto postOpenCanonical = std::filesystem::canonical(
                    filesystemPath(region.sampleFile), error);
                const auto postOpenSize = !error
                    ? std::filesystem::file_size(postOpenCanonical, error) : 0;
                const auto postOpenTime = !error
                    ? std::filesystem::last_write_time(postOpenCanonical, error)
                    : std::filesystem::file_time_type {};
                if (error || postOpenCanonical != canonicalSample
                    || !isContainedBy(canonicalRoot, postOpenCanonical)
                    || postOpenSize != (uintmax_t) region.sampleFileBytes
                    || (int64_t) postOpenTime.time_since_epoch().count()
                        != region.sampleLastWriteTimeTicks
                    || input->getTotalLength() != region.sampleFileBytes)
                {
                    addDiagnostic(result, limits, "sfz.decode.identity-changed",
                                  "Resolved sample changed after resolution",
                                  region.definition.sourceLine);
                    continue;
                }

                std::unique_ptr<juce::AudioFormatReader> reader(
                    formats.createReaderFor(std::move(input)));
                if (!reader || reader->numChannels == 0
                    || reader->numChannels > (unsigned int) limits.maximumChannels
                    || reader->lengthInSamples <= 1
                    || reader->lengthInSamples > std::numeric_limits<int>::max()
                    || !std::isfinite(reader->sampleRate) || reader->sampleRate <= 0.0)
                {
                    addDiagnostic(result, limits, "sfz.decode.format",
                                  "Resolved sample format or dimensions are unsupported",
                                  region.definition.sourceLine);
                    continue;
                }

                const auto decodedBytes = reader->lengthInSamples
                    * (int64_t) reader->numChannels * (int64_t) sizeof(float);
                if (decodedBytes <= 0 || decodedBytes > limits.maximumDecodedBytesPerSample)
                {
                    addDiagnostic(result, limits, "sfz.decode.sample-bytes",
                                  "Decoded sample exceeds its memory budget",
                                  region.definition.sourceLine);
                    continue;
                }
                if (decodedBytes > limits.maximumTotalDecodedBytes - decoded->totalDecodedBytes)
                {
                    addDiagnostic(result, limits, "sfz.decode.total-bytes",
                                  "Decoded SFZ exceeds the aggregate memory budget",
                                  region.definition.sourceLine);
                    continue;
                }

                auto audio = std::make_shared<juce::AudioBuffer<float>>(
                    (int) reader->numChannels, (int) reader->lengthInSamples);
                if (!reader->read(audio.get(), 0, (int) reader->lengthInSamples, 0, true, true))
                {
                    addDiagnostic(result, limits, "sfz.decode.read",
                                  "Resolved sample could not be decoded completely",
                                  region.definition.sourceLine);
                    continue;
                }

                sampleIndex = (uint16_t) decoded->samples.size();
                sampleIndices.emplace(canonicalSample, sampleIndex);
                decoded->samples.push_back({ region.sampleFile, std::move(audio), reader->sampleRate });
                decoded->totalDecodedBytes += decodedBytes;
            }

            decoded->regions.push_back({ region.definition, sampleIndex, region.stableRegionIndex });
        }

        if (result.hasErrors() || decoded->regions.size() != resolved->regions.size())
            return result;

        decoded->noteIndex = resolved->noteIndex;
        result.instrument = std::move(decoded);
        return result;
    }
}
