#include "SpectralArtifact.h"
#include <juce_cryptography/juce_cryptography.h>

#include <cmath>
#include <limits>

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
    }

    uint64_t SpectralArtifact::payloadBytes() const noexcept
    {
        constexpr uint64_t manifestAndAlignmentBytes = 512;
        return manifestAndAlignmentBytes
            + (uint64_t) magnitudes.size() * sizeof(float)
            + (uint64_t) phaseResiduals.size() * sizeof(float)
            + (uint64_t) peakAssignments.size()
            + (uint64_t) transientFrames.size()
            + (uint64_t) peakOffsets.size() * sizeof(uint32_t)
            + (uint64_t) peakBins.size() * sizeof(uint16_t);
    }

    std::string computeSpectralPayloadSha256(const SpectralArtifact& artifact)
    {
        juce::MemoryOutputStream stream;
        auto writeVector = [&stream](const auto& values)
        {
            if (!values.empty()) stream.write(values.data(), values.size() * sizeof(values.front()));
        };
        writeVector(artifact.magnitudes);
        writeVector(artifact.phaseResiduals);
        writeVector(artifact.peakAssignments);
        writeVector(artifact.transientFrames);
        writeVector(artifact.peakOffsets);
        writeVector(artifact.peakBins);
        return juce::SHA256(stream.getData(), stream.getDataSize()).toHexString().toStdString();
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

        size_t plane = 0;
        size_t stereoPlane = 0;
        if (!checkedProduct((size_t) artifact.frames, (size_t) artifact.bins, plane)
            || !checkedProduct(plane, 2u, stereoPlane))
            return fail("spectral.overflow", "spectral dimensions overflow");
        if (artifact.magnitudes.size() != stereoPlane || artifact.phaseResiduals.size() != stereoPlane
            || artifact.peakAssignments.size() != plane
            || artifact.transientFrames.size() != (size_t) artifact.frames
            || artifact.peakOffsets.size() != (size_t) artifact.frames + 1u)
            return fail("spectral.shape", "spectral payload planes are inconsistent");
        if (artifact.payloadBytes() > SpectralArtifact::maxPayloadBytes)
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
            const float residual = artifact.phaseResiduals[i];
            if (!std::isfinite(magnitude) || magnitude < 0.0f || magnitude > 4096.0f)
                return fail("spectral.magnitude", "magnitude is non-finite or outside its bounded range");
            if (!std::isfinite(residual) || residual < -pi || residual >= pi)
                return fail("spectral.phase", "phase residual is outside [-pi, pi)");
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
            }
            for (int bin = 0; bin < artifact.bins; ++bin)
            {
                const auto assignment = artifact.peakAssignments[(size_t) frame * artifact.bins + bin];
                if (end == begin || assignment >= end - begin)
                    return fail("spectral.peak-assignment", "peak assignment does not reference its frame");
            }
            if (artifact.transientFrames[(size_t) frame] > 1u)
                return fail("spectral.transient", "transient flags must be binary");
        }
        return { true, {}, {} };
    }
}
