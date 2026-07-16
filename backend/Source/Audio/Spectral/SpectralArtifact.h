#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>
#include <cstdint>
#include <optional>
#include <string>
#include <vector>

namespace beat
{
    struct SpectralArtifact
    {
        static constexpr uint32_t schemaVersion = 2;
        static constexpr uint32_t analysisVersion = 2;
        static constexpr int sampleRate = 48000;
        static constexpr int fftSize = 1024;
        static constexpr int hopSize = 256;
        static constexpr int binCount = fftSize / 2 + 1;
        // Exact v2 worst-case serialization measurement: 3,640 frames fit and
        // 3,641 exceed 48 MiB when every frame carries 255 peaks.
        static constexpr int maxFrames = 3640;
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

        static constexpr uint16_t noPreviousPeak = 0xffffu;

        // Planar order: channel, frame, bin. Magnitudes and relative phases
        // remain independent for L/R. Peak decisions and transients are shared.
        std::vector<float> magnitudes;
        std::vector<float> relativePhases;
        std::vector<uint8_t> peakAssignments;
        std::vector<uint8_t> transientFrames;
        std::vector<uint32_t> peakOffsets;
        std::vector<uint16_t> peakBins;
        std::vector<uint16_t> peakPreviousIndices;
        // Planar order: channel, global peak index. Unmatched peaks store an
        // absolute wrapped phase; matched peaks store wrapped phase evolution.
        std::vector<double> peakPhaseEvolution;

        uint64_t serializedBytes() const;
    };

    struct SpectralArtifactValidation
    {
        bool ok { false };
        std::string code;
        std::string message;
    };

    struct SpectralArtifactDecodeResult
    {
        std::optional<SpectralArtifact> artifact;
        std::string code;
        std::string message;
    };

    SpectralArtifactValidation validateSpectralArtifact(const SpectralArtifact&);
    std::string computeSpectralPayloadSha256(const SpectralArtifact&);
    juce::MemoryBlock serializeSpectralArtifact(const SpectralArtifact&);
    SpectralArtifactDecodeResult decodeSpectralArtifact(const void* data, size_t bytes);
}
