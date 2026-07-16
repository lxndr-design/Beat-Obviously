#pragma once

#include "SpectralArtifact.h"
#include <atomic>
#include <optional>

namespace beat
{
    class SpectralAnalyzer
    {
    public:
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
            const SpectralArtifact& artifact);
        static double measureRawWolaErrorDbForTesting(const juce::AudioBuffer<float>& canonicalPcm);
    };
}
