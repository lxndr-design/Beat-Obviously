#include "SpectralBenchmarkSource.h"

#include "SpectralAnalyzer.h"

#include <cmath>
#include <mutex>

namespace beat
{
    std::shared_ptr<const SpectralArtifact> sharedSpectralBenchmarkArtifact()
    {
        static std::once_flag once;
        static std::shared_ptr<const SpectralArtifact> artifact;
        std::call_once(once, []
        {
            constexpr int sampleRate = SpectralArtifact::sampleRate;
            constexpr int samples = sampleRate;
            juce::AudioBuffer<float> audio(2, samples);
            double phaseA = 0.0;
            double phaseB = 0.0;
            for (int sample = 0; sample < samples; ++sample)
            {
                const double time = (double) sample / sampleRate;
                const double position = (double) sample / (samples - 1);
                const double sweep = 110.0 + 330.0 * position * position;
                phaseA += juce::MathConstants<double>::twoPi * sweep / sampleRate;
                phaseB += juce::MathConstants<double>::twoPi * (220.0 + 55.0 * std::sin(
                    juce::MathConstants<double>::twoPi * 0.5 * time)) / sampleRate;
                const double transientPhase = std::fmod(time, 0.2);
                const double transient = transientPhase < 0.012
                    ? std::exp(-transientPhase * 260.0) : 0.0;
                const double motion = 0.5 + 0.5 * std::sin(
                    juce::MathConstants<double>::twoPi * 0.37 * time);
                const float left = (float) (0.22 * std::sin(phaseA)
                    + 0.12 * std::sin(phaseA * 2.0 + 0.25)
                    + 0.09 * std::sin(phaseB + motion * 0.6)
                    + transient * 0.16);
                const float right = (float) (0.20 * std::sin(phaseA + 0.38)
                    + 0.11 * std::sin(phaseA * 3.0 - 0.2)
                    + 0.10 * std::sin(phaseB - motion * 0.7)
                    - transient * 0.12);
                audio.setSample(0, sample, left);
                audio.setSample(1, sample, right);
            }
            auto analyzed = SpectralAnalyzer::analyze(audio, 45, 0xA37E4u);
            if (analyzed.artifact)
                artifact = std::make_shared<const SpectralArtifact>(
                    std::move(*analyzed.artifact));
        });
        return artifact;
    }
}
