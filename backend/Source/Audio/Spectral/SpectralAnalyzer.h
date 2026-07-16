#pragma once

#include "SpectralArtifact.h"
#include <atomic>
#include <optional>

namespace beat
{
    class SpectralAnalyzer
    {
    public:
        enum class ReconstructionRepresentation
        {
            peakPhaseV2,
            float32AllBinResiduals,
            float64AllBinResiduals
        };

        struct ReconstructionMetrics
        {
            double rmsError { 0.0 };
            double peakError { 0.0 };
            double errorDb { 0.0 };
        };

        struct RepresentationComparison
        {
            ReconstructionMetrics peakPhaseV2;
            ReconstructionMetrics float32AllBinResiduals;
            ReconstructionMetrics float64AllBinResiduals;
        };

        struct Result
        {
            std::optional<SpectralArtifact> artifact;
            std::string code;
            std::string message;
        };

        // Control/test thread only. Input must already be verified immutable PCM
        // at the canonical 48 kHz rate. No file or callback boundary exists here.
        static Result analyze(const juce::AudioBuffer<float>& canonicalPcm,
                              int rootNote = 60,
                              uint32_t deterministicSeed = 0,
                              const std::atomic<bool>* cancel = nullptr);

        static std::optional<juce::AudioBuffer<float>> reconstructForTesting(
            const SpectralArtifact& artifact,
            ReconstructionRepresentation representation = ReconstructionRepresentation::peakPhaseV2);
        static std::optional<RepresentationComparison> compareRepresentationsForTesting(
            const juce::AudioBuffer<float>& canonicalPcm);
        static ReconstructionMetrics measureReconstructionForTesting(
            const juce::AudioBuffer<float>& original,
            const juce::AudioBuffer<float>& reconstructed);
        static double measureRawWolaErrorDbForTesting(const juce::AudioBuffer<float>& canonicalPcm);
        static std::vector<uint16_t> detectSharedPeaksForTesting(const std::vector<float>& reference);
        static uint8_t assignPeakForTesting(int bin, const std::vector<uint16_t>& peaks);
        static std::vector<uint16_t> matchPeakPredecessorsForTesting(
            const std::vector<uint16_t>& previous,
            const std::vector<uint16_t>& current);
    };
}
