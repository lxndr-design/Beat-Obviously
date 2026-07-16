#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <cstdint>
#include <string>
#include <vector>

namespace beat
{
    struct SpectralArtifact
    {
        static constexpr uint32_t schemaVersion = 1;
        static constexpr uint32_t analysisVersion = 1;
        static constexpr int sampleRate = 48000;
        static constexpr int fftSize = 1024;
        static constexpr int hopSize = 256;
        static constexpr int binCount = fftSize / 2 + 1;
        static constexpr int maxFrames = 5625;
        // Three leading overlap frames and three trailing overlap positions fit
        // under maxFrames, yielding 29.984 s of fully reconstructed source.
        static constexpr int maxInputSamples = (maxFrames - 3) * hopSize;
        static constexpr uint64_t maxPayloadBytes = 48ull * 1024ull * 1024ull;

        uint32_t schema { schemaVersion };
        uint32_t algorithm { analysisVersion };
        int sourceSamples { 0 };
        int frames { 0 };
        int bins { binCount };
        int rootNote { 60 };
        uint32_t deterministicSeed { 0 };
        std::string windowId { "sqrt-periodic-hann-v1" };
        std::string sourcePcmSha256;
        std::string payloadSha256;
        double windowedPcmEnergy { 0.0 };
        double spectralEnergy { 0.0 };

        // Planar order: channel, frame, bin. Magnitudes and phase residuals
        // remain independent for L/R. Peak decisions and transients are shared.
        std::vector<float> magnitudes;
        std::vector<float> phaseResiduals;
        std::vector<uint8_t> peakAssignments;
        std::vector<uint8_t> transientFrames;
        std::vector<uint32_t> peakOffsets;
        std::vector<uint16_t> peakBins;

        uint64_t payloadBytes() const noexcept;
    };

    struct SpectralArtifactValidation
    {
        bool ok { false };
        std::string code;
        std::string message;
    };

    SpectralArtifactValidation validateSpectralArtifact(const SpectralArtifact&);
    std::string computeSpectralPayloadSha256(const SpectralArtifact&);
}
