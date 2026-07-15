#include "SfzSampleDecoder.h"

#include <cmath>
#include <filesystem>
#include <limits>
#include <map>
#include <system_error>

#if JUCE_MAC || JUCE_LINUX
#include <cerrno>
#include <fcntl.h>
#include <sys/stat.h>
#include <unistd.h>
#endif

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

#if JUCE_MAC || JUCE_LINUX
        SfzNativeFileIdentity identityFromStatus(const struct stat& status) noexcept
        {
            SfzNativeFileIdentity identity;
            if (!S_ISREG(status.st_mode))
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
            return identity;
        }

        class SfzDescriptorInputStream final : public juce::InputStream
        {
        public:
            explicit SfzDescriptorInputStream(const juce::File& file) noexcept
                : descriptor(::open(file.getFullPathName().toRawUTF8(),
                                    O_RDONLY | O_CLOEXEC | O_NOFOLLOW))
            {
                if (descriptor >= 0)
                {
                    struct stat status {};
                    if (::fstat(descriptor, &status) == 0)
                        openedIdentity = identityFromStatus(status);
                    if (!openedIdentity.valid)
                    {
                        ::close(descriptor);
                        descriptor = -1;
                    }
                }
            }

            ~SfzDescriptorInputStream() override
            {
                if (descriptor >= 0)
                    ::close(descriptor);
            }

            bool openedOk() const noexcept { return descriptor >= 0 && openedIdentity.valid; }
            int errorAtOpen() const noexcept { return openError; }
            const SfzNativeFileIdentity& identityAtOpen() const noexcept { return openedIdentity; }

            SfzNativeFileIdentity currentIdentity() const noexcept
            {
                struct stat status {};
                return descriptor >= 0 && ::fstat(descriptor, &status) == 0
                    ? identityFromStatus(status) : SfzNativeFileIdentity {};
            }

            juce::int64 getTotalLength() override { return openedIdentity.byteSize; }
            bool isExhausted() override { return getPosition() >= getTotalLength(); }

            int read(void* destination, int maximumBytes) override
            {
                if (descriptor < 0 || destination == nullptr || maximumBytes <= 0)
                    return 0;
                while (true)
                {
                    const auto bytes = ::read(descriptor, destination, (size_t) maximumBytes);
                    if (bytes >= 0) return (int) bytes;
                    if (errno != EINTR) return 0;
                }
            }

            juce::int64 getPosition() override
            {
                if (descriptor < 0) return 0;
                const auto position = ::lseek(descriptor, 0, SEEK_CUR);
                return position >= 0 ? (juce::int64) position : 0;
            }

            bool setPosition(juce::int64 position) override
            {
                return descriptor >= 0 && position >= 0
                    && ::lseek(descriptor, (off_t) position, SEEK_SET) == (off_t) position;
            }

        private:
            int descriptor { -1 };
            int openError { descriptor < 0 ? errno : 0 };
            SfzNativeFileIdentity openedIdentity;
        };
#endif
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
#if !(JUCE_MAC || JUCE_LINUX)
        addDiagnostic(result, limits, "sfz.decode.identity-platform",
                      "Strong SFZ file identity is unavailable on this platform");
        return result;
#else

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

#if BEAT_SFZ_DECODE_TESTING
                if (limits.beforeDescriptorOpen != nullptr)
                    limits.beforeDescriptorOpen(region.sampleFile);
#endif
                auto input = std::make_unique<SfzDescriptorInputStream>(region.sampleFile);
                if (!input->openedOk())
                {
                    const bool symlinkRefused = input->errorAtOpen() == ELOOP;
                    addDiagnostic(result, limits,
                                  symlinkRefused ? "sfz.decode.no-follow" : "sfz.decode.open",
                                  symlinkRefused
                                      ? "Resolved sample became a symlink before descriptor open"
                                      : "Resolved sample cannot be opened",
                                  region.definition.sourceLine);
                    continue;
                }
                if (!region.nativeIdentity.valid
                    || input->identityAtOpen() != region.nativeIdentity)
                {
                    addDiagnostic(result, limits, "sfz.decode.descriptor-identity",
                                  "Opened sample descriptor does not match the resolved file identity",
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

                auto* descriptorStream = input.get();
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
#if BEAT_SFZ_DECODE_TESTING
                if (limits.afterDecodeBeforeIdentityCheck != nullptr)
                    limits.afterDecodeBeforeIdentityCheck(region.sampleFile);
#endif
                if (descriptorStream->currentIdentity() != region.nativeIdentity)
                {
                    addDiagnostic(result, limits, "sfz.decode.descriptor-mutated",
                                  "Opened sample changed while it was being decoded",
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
#endif
    }
}
