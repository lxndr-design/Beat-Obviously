#include "SpectralArtifact.h"
#include <juce_cryptography/juce_cryptography.h>

#include <cmath>
#include <limits>
#include <new>
#include <type_traits>

namespace beat
{
    namespace
    {
        SpectralArtifactValidation fail(const char* code, const char* message)
        {
            return { false, code, message };
        }

        bool isSha256(const std::string& value)
        {
            if (value.size() != 64) return false;
            for (const char c : value)
                if (!std::isxdigit((unsigned char) c)) return false;
            return true;
        }

        bool checkedProduct(size_t a, size_t b, size_t& result)
        {
            if (a != 0 && b > std::numeric_limits<size_t>::max() / a) return false;
            result = a * b;
            return true;
        }

        std::vector<uint16_t> expectedPredecessors(const std::vector<uint16_t>& previous,
                                                   const std::vector<uint16_t>& current)
        {
            std::vector<uint8_t> used(previous.size(), 0u);
            std::vector<uint16_t> result(current.size(), SpectralArtifact::noPreviousPeak);
            for (size_t currentIndex = 0; currentIndex < current.size(); ++currentIndex)
            {
                int bestDistance = 5;
                uint16_t best = SpectralArtifact::noPreviousPeak;
                for (size_t prior = 0; prior < previous.size(); ++prior)
                {
                    if (used[prior] != 0u) continue;
                    const int distance = std::abs((int) current[currentIndex] - (int) previous[prior]);
                    if (distance < bestDistance) { bestDistance = distance; best = (uint16_t) prior; }
                }
                if (best != SpectralArtifact::noPreviousPeak) { result[currentIndex] = best; used[best] = 1u; }
            }
            return result;
        }
    }

    namespace
    {
        template <typename Value>
        void writeVector(juce::MemoryOutputStream& stream, const std::vector<Value>& values)
        {
            stream.writeInt64((juce::int64) values.size());
            if (!values.empty()) stream.write(values.data(), values.size() * sizeof(Value));
        }

        juce::MemoryBlock serializeArtifact(const SpectralArtifact& artifact, bool includePayloadHash)
        {
            const std::string serializedPayloadHash = includePayloadHash ? artifact.payloadSha256 : std::string {};
            size_t initialBytes = 7u * sizeof(int32_t) + 2u * sizeof(double)
                + artifact.windowId.size() + 1u
                + artifact.sourcePcmSha256.size() + 1u
                + serializedPayloadHash.size() + 1u;
            const auto addVectorBytes = [&initialBytes](const auto& values)
            {
                initialBytes += sizeof(juce::int64) + values.size() * sizeof(values.front());
            };
            addVectorBytes(artifact.magnitudes);
            addVectorBytes(artifact.relativePhases);
            addVectorBytes(artifact.peakAssignments);
            addVectorBytes(artifact.transientFrames);
            addVectorBytes(artifact.peakOffsets);
            addVectorBytes(artifact.peakBins);
            addVectorBytes(artifact.peakPreviousIndices);
            addVectorBytes(artifact.peakPhaseEvolution);
            juce::MemoryOutputStream stream(initialBytes);
            stream.writeInt((int) artifact.schema);
            stream.writeInt((int) artifact.algorithm);
            stream.writeInt(artifact.sourceSamples);
            stream.writeInt(artifact.frames);
            stream.writeInt(artifact.bins);
            stream.writeInt(artifact.rootNote);
            stream.writeInt((int) artifact.deterministicSeed);
            stream.writeString(artifact.windowId);
            stream.writeString(artifact.sourcePcmSha256);
            stream.writeString(serializedPayloadHash);
            stream.writeDouble(artifact.windowedPcmEnergy);
            stream.writeDouble(artifact.spectralEnergy);
            writeVector(stream, artifact.magnitudes);
            writeVector(stream, artifact.relativePhases);
            writeVector(stream, artifact.peakAssignments);
            writeVector(stream, artifact.transientFrames);
            writeVector(stream, artifact.peakOffsets);
            writeVector(stream, artifact.peakBins);
            writeVector(stream, artifact.peakPreviousIndices);
            writeVector(stream, artifact.peakPhaseEvolution);
            return stream.getMemoryBlock();
        }
    }

    uint64_t SpectralArtifact::serializedBytes() const
    {
        return serializeArtifact(*this, true).getSize();
    }

    juce::MemoryBlock serializeSpectralArtifact(const SpectralArtifact& artifact)
    {
        return serializeArtifact(artifact, true);
    }

    SpectralArtifactDecodeResult decodeSpectralArtifact(const void* data, size_t bytes)
    {
        if (data == nullptr || bytes == 0 || bytes > SpectralArtifact::maxPayloadBytes)
            return { {}, "spectral.decode-size", "serialized spectral artifact size is invalid" };
        try
        {
            juce::MemoryInputStream stream(data, bytes, false);
            SpectralArtifact artifact;
            artifact.schema = (uint32_t) stream.readInt();
            artifact.algorithm = (uint32_t) stream.readInt();
            if (artifact.schema != SpectralArtifact::schemaVersion)
                return { {}, "spectral.schema", "unsupported spectral artifact schema" };
            if (artifact.algorithm != SpectralArtifact::analysisVersion)
                return { {}, "spectral.algorithm", "unsupported spectral analysis algorithm" };
            artifact.sourceSamples = stream.readInt();
            artifact.frames = stream.readInt();
            artifact.bins = stream.readInt();
            artifact.rootNote = stream.readInt();
            artifact.deterministicSeed = (uint32_t) stream.readInt();
            artifact.windowId = stream.readString().toStdString();
            artifact.sourcePcmSha256 = stream.readString().toStdString();
            artifact.payloadSha256 = stream.readString().toStdString();
            artifact.windowedPcmEnergy = stream.readDouble();
            artifact.spectralEnergy = stream.readDouble();

            if (artifact.frames <= 0 || artifact.frames > SpectralArtifact::maxFrames
                || artifact.bins != SpectralArtifact::binCount)
                return { {}, "spectral.dimensions", "serialized spectral dimensions are invalid" };
            const size_t plane = (size_t) artifact.frames * (size_t) artifact.bins;
            const size_t stereoPlane = plane * 2u;
            auto readVector = [&stream](auto& values, size_t maximum) -> bool
            {
                const auto count = stream.readInt64();
                using Value = typename std::decay_t<decltype(values)>::value_type;
                if (count < 0 || (uint64_t) count > maximum
                    || (uint64_t) count * sizeof(Value) > stream.getNumBytesRemaining())
                    return false;
                values.resize((size_t) count);
                return count == 0 || stream.read(values.data(), (int) ((size_t) count * sizeof(Value)))
                    == (int) ((size_t) count * sizeof(Value));
            };
            if (!readVector(artifact.magnitudes, stereoPlane)
                || !readVector(artifact.relativePhases, stereoPlane)
                || !readVector(artifact.peakAssignments, plane)
                || !readVector(artifact.transientFrames, (size_t) artifact.frames)
                || !readVector(artifact.peakOffsets, (size_t) artifact.frames + 1u)
                || !readVector(artifact.peakBins, (size_t) artifact.frames * 255u)
                || !readVector(artifact.peakPreviousIndices, (size_t) artifact.frames * 255u)
                || !readVector(artifact.peakPhaseEvolution, (size_t) artifact.frames * 255u * 2u))
                return { {}, "spectral.decode-shape", "serialized spectral vector length is invalid" };
            if (stream.getNumBytesRemaining() != 0)
                return { {}, "spectral.decode-trailing", "serialized spectral artifact has trailing data" };
            const auto validation = validateSpectralArtifact(artifact);
            if (!validation.ok) return { {}, validation.code, validation.message };
            return { std::move(artifact), {}, {} };
        }
        catch (const std::bad_alloc&)
        {
            return { {}, "spectral.decode-allocation", "spectral artifact allocation failed" };
        }
    }

    std::string computeSpectralPayloadSha256(const SpectralArtifact& artifact)
    {
        const auto bytes = serializeArtifact(artifact, false);
        return juce::SHA256(bytes.getData(), bytes.getSize()).toHexString().toStdString();
    }

    SpectralArtifactValidation validateSpectralArtifact(const SpectralArtifact& artifact)
    {
        if (artifact.schema != SpectralArtifact::schemaVersion)
            return fail("spectral.schema", "unsupported spectral artifact schema");
        if (artifact.algorithm != SpectralArtifact::analysisVersion)
            return fail("spectral.algorithm", "unsupported spectral analysis algorithm");
        if (artifact.windowId != "sqrt-periodic-hann-v1")
            return fail("spectral.window", "unknown analysis window");
        if (artifact.sourceSamples <= 0 || artifact.sourceSamples > SpectralArtifact::maxInputSamples)
            return fail("spectral.source-samples", "source duration is outside the bounded contract");
        if (artifact.frames <= 0 || artifact.frames > SpectralArtifact::maxFrames
            || artifact.bins != SpectralArtifact::binCount)
            return fail("spectral.dimensions", "spectral dimensions are invalid");
        const int expectedFrames = (artifact.sourceSamples + SpectralArtifact::hopSize - 1)
            / SpectralArtifact::hopSize + 3;
        if (artifact.frames != expectedFrames)
            return fail("spectral.frame-alignment", "frame count is inconsistent with source alignment");
        if (artifact.rootNote < 0 || artifact.rootNote > 127)
            return fail("spectral.root-note", "root note is outside MIDI range");

        size_t plane = 0;
        size_t stereoPlane = 0;
        if (!checkedProduct((size_t) artifact.frames, (size_t) artifact.bins, plane)
            || !checkedProduct(plane, 2u, stereoPlane))
            return fail("spectral.overflow", "spectral dimensions overflow");
        if (artifact.magnitudes.size() != stereoPlane || artifact.relativePhases.size() != stereoPlane
            || artifact.peakAssignments.size() != plane
            || artifact.transientFrames.size() != (size_t) artifact.frames
            || artifact.peakOffsets.size() != (size_t) artifact.frames + 1u
            || artifact.peakPreviousIndices.size() != artifact.peakBins.size()
            || artifact.peakPhaseEvolution.size() != artifact.peakBins.size() * 2u)
            return fail("spectral.shape", "spectral payload planes are inconsistent");
        if (artifact.serializedBytes() > SpectralArtifact::maxPayloadBytes)
            return fail("spectral.payload-cap", "spectral payload exceeds 48 MiB");
        if (!isSha256(artifact.sourcePcmSha256) || !isSha256(artifact.payloadSha256))
            return fail("spectral.hash", "spectral hashes are missing or malformed");
        if (computeSpectralPayloadSha256(artifact) != artifact.payloadSha256)
            return fail("spectral.payload-hash", "spectral payload hash does not match its contents");
        if (!std::isfinite(artifact.windowedPcmEnergy) || !std::isfinite(artifact.spectralEnergy)
            || artifact.windowedPcmEnergy < 0.0 || artifact.spectralEnergy < 0.0)
            return fail("spectral.energy", "spectral energy metadata is invalid");
        const double energyScale = std::max(artifact.windowedPcmEnergy, 1.0e-20);
        if (std::abs(artifact.spectralEnergy - artifact.windowedPcmEnergy) / energyScale > 1.0e-5)
            return fail("spectral.energy-match", "spectral energy does not match analyzed windowed PCM");
        if (artifact.peakOffsets.empty() || artifact.peakOffsets.front() != 0
            || artifact.peakOffsets.back() != artifact.peakBins.size())
            return fail("spectral.peaks", "peak-region offsets are invalid");

        constexpr float pi = juce::MathConstants<float>::pi;
        for (size_t i = 0; i < stereoPlane; ++i)
        {
            const float magnitude = artifact.magnitudes[i];
            const float relative = artifact.relativePhases[i];
            if (!std::isfinite(magnitude) || magnitude < 0.0f || magnitude > 4096.0f)
                return fail("spectral.magnitude", "magnitude is non-finite or outside its bounded range");
            if (!std::isfinite(relative) || relative < -pi || relative >= pi)
                return fail("spectral.relative-phase", "relative phase is outside [-pi, pi)");
        }

        for (int frame = 0; frame < artifact.frames; ++frame)
        {
            const auto begin = artifact.peakOffsets[(size_t) frame];
            const auto end = artifact.peakOffsets[(size_t) frame + 1u];
            if (begin > end || end > artifact.peakBins.size() || end - begin > 255u)
                return fail("spectral.peak-count", "peak-region count is invalid");
            uint16_t previous = 0;
            for (uint32_t i = begin; i < end; ++i)
            {
                const auto bin = artifact.peakBins[i];
                if (bin >= artifact.bins || (i > begin && bin <= previous))
                    return fail("spectral.peak-order", "peak bins are not strictly ordered and in range");
                previous = bin;
                const auto predecessor = artifact.peakPreviousIndices[i];
                const auto previousCount = frame == 0 ? 0u
                    : artifact.peakOffsets[(size_t) frame] - artifact.peakOffsets[(size_t) frame - 1u];
                if (predecessor != SpectralArtifact::noPreviousPeak
                    && (frame == 0 || predecessor >= previousCount))
                    return fail("spectral.peak-predecessor", "peak predecessor is outside the prior frame");
                for (int channel = 0; channel < 2; ++channel)
                {
                    const double evolution = artifact.peakPhaseEvolution[(size_t) channel * artifact.peakBins.size() + i];
                    if (!std::isfinite(evolution) || evolution < -juce::MathConstants<double>::pi
                        || evolution >= juce::MathConstants<double>::pi)
                        return fail("spectral.peak-phase", "peak phase evolution is outside [-pi, pi)");
                }
            }
            for (uint32_t a = begin; a < end; ++a)
                if (artifact.peakPreviousIndices[a] != SpectralArtifact::noPreviousPeak)
                    for (uint32_t b = a + 1; b < end; ++b)
                        if (artifact.peakPreviousIndices[a] == artifact.peakPreviousIndices[b])
                            return fail("spectral.peak-predecessor-duplicate", "two peaks claim the same predecessor");
            std::vector<uint16_t> previousPeaks;
            if (frame > 0)
                previousPeaks.insert(previousPeaks.end(),
                    artifact.peakBins.begin() + artifact.peakOffsets[(size_t) frame - 1u],
                    artifact.peakBins.begin() + artifact.peakOffsets[(size_t) frame]);
            std::vector<uint16_t> currentPeaks(artifact.peakBins.begin() + begin,
                                               artifact.peakBins.begin() + end);
            const auto expected = expectedPredecessors(previousPeaks, currentPeaks);
            for (size_t peak = 0; peak < expected.size(); ++peak)
                if (artifact.peakPreviousIndices[(size_t) begin + peak] != expected[peak])
                    return fail("spectral.peak-predecessor-policy", "peak predecessor violates deterministic matching");
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const auto assignment = artifact.peakAssignments[(size_t) frame * artifact.bins + bin];
                if (end == begin || assignment >= end - begin)
                    return fail("spectral.peak-assignment", "peak assignment does not reference its frame");
                size_t nearest = 0;
                int distance = std::abs(bin - (int) currentPeaks[0]);
                for (size_t peak = 1; peak < currentPeaks.size(); ++peak)
                {
                    const int candidate = std::abs(bin - (int) currentPeaks[peak]);
                    if (candidate < distance) { nearest = peak; distance = candidate; }
                }
                if (assignment != nearest)
                    return fail("spectral.peak-assignment-policy", "peak assignment violates nearest deterministic policy");
            }
            if (artifact.transientFrames[(size_t) frame] > 1u)
                return fail("spectral.transient", "transient flags must be binary");
        }
        return { true, {}, {} };
    }
}
