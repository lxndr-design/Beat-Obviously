#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_audio_formats/juce_audio_formats.h>
#include <juce_core/juce_core.h>

#include <limits>
#include <optional>
#include <vector>

namespace beat
{
    struct AudioWaveformChannel
    {
        std::vector<float> upper;
        std::vector<float> lower;
    };

    struct AudioWaveformSummary
    {
        AudioWaveformChannel left;
        AudioWaveformChannel right;
        double sampleRate { 0.0 };
        double durationSeconds { 0.0 };
        int64_t lengthInSamples { 0 };
        int channelCount { 0 };
        int bucketCount { 0 };
    };

    struct AudioFileAnalysis
    {
        double sampleRate { 0.0 };
        double durationSeconds { 0.0 };
        int64_t lengthInSamples { 0 };
        int channelCount { 0 };
        int bitDepth { 0 };

        float leftPeakDbFS { -std::numeric_limits<float>::infinity() };
        float rightPeakDbFS { -std::numeric_limits<float>::infinity() };
        float truePeakDbTP { -std::numeric_limits<float>::infinity() };
        float rmsDbFS { -std::numeric_limits<float>::infinity() };
        float crestFactorDb { -std::numeric_limits<float>::infinity() };
        float dcOffset { 0.0f };
        int64_t clippingCount { 0 };
        float clippingRatio { 0.0f };
        float stereoCorrelation { std::numeric_limits<float>::quiet_NaN() };
        float integratedLufs { -std::numeric_limits<float>::infinity() };
    };

    class AudioFileAnalyzer
    {
    public:
        static AudioFileAnalysis analyzeBuffer(const juce::AudioBuffer<float>& buffer, double sampleRate);
        static std::optional<AudioFileAnalysis> analyzeFile(const juce::File& file);
        static std::optional<AudioWaveformSummary> analyzeWaveformFile(const juce::File& file, int bucketCount);

    private:
        static float amplitudeToDb(float amplitude) noexcept;
    };
}
