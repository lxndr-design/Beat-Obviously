#pragma once

#include <juce_audio_basics/juce_audio_basics.h>
#include <juce_core/juce_core.h>

#include <atomic>

namespace beat
{
    struct RecordingCaptureStats
    {
        bool active { false };
        int channels { 0 };
        int recordedSamples { 0 };
        int capacitySamples { 0 };
        double sampleRate { 0.0 };
        bool overflowed { false };
    };

    class RecordingCapture
    {
    public:
        bool prepare(double sampleRate,
                     int channels,
                     double maxDurationSeconds,
                     juce::String* error = nullptr);

        void start() noexcept;
        RecordingCaptureStats stop() noexcept;
        void cancel() noexcept;
        void captureBlock(const float* const* inputChannels,
                          int numInputChannels,
                          int numSamples) noexcept;

        RecordingCaptureStats stats() const noexcept;
        bool writeToWav(const juce::File& outputFile,
                        juce::String* error = nullptr,
                        int bitDepth = 24) const;

    private:
        juce::AudioBuffer<float> buffer;
        double preparedSampleRate { 0.0 };
        int preparedChannels { 0 };
        int preparedCapacitySamples { 0 };
        std::atomic<int> recordedSamples { 0 };
        std::atomic<bool> active { false };
        std::atomic<bool> overflowed { false };
    };
}
